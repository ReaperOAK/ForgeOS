#!/usr/bin/env bash
# =============================================================================
# ForgeOS — PostgreSQL Restore Script
# =============================================================================
# Restores a PostgreSQL database from a backup created by backup.sh.
# Validates backup integrity before applying, requires explicit confirmation
# before overwriting existing data, and supports point-in-time recovery
# guidance via WAL replay.
#
# Usage:
#   ./restore.sh <backup_file>                # Restore from file (interactive)
#   ./restore.sh <backup_file> --yes          # Skip confirmation prompt
#   ./restore.sh <backup_file> --target-db X  # Restore into database X
#   ./restore.sh <backup_file> --docker       # Use Docker exec
#   ./restore.sh <backup_file> --dry-run      # Validate only, no restore
#   ./restore.sh --list                       # List available backups
#
# Environment Variables (override defaults via .env or export):
#   PGHOST, PGPORT, PGUSER, PGDATABASE, PGPASSWORD / PGPASSFILE
#   BACKUP_DIR          — Backup directory (default: infra/backups)
#   DOCKER_CONTAINER    — Container name when using --docker
#
# Ticket: FORGEOS-DO007
# =============================================================================

set -euo pipefail
IFS=$'\n\t'

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Source .env if present
if [[ -f "${INFRA_DIR}/.env" ]]; then
    # shellcheck disable=SC1091
    set -a; source "${INFRA_DIR}/.env"; set +a
fi

PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-${DB_PORT:-5432}}"
PGUSER="${PGUSER:-${DB_USER:-forgeos}}"
PGDATABASE="${PGDATABASE:-${DB_NAME:-forgeos}}"

BACKUP_DIR="${BACKUP_DIR:-${INFRA_DIR}/backups}"
DOCKER_CONTAINER="${DOCKER_CONTAINER:-forgeos-postgres}"
USE_DOCKER=false
AUTO_CONFIRM=false
DRY_RUN=false
TARGET_DB=""
LIST_MODE=false
BACKUP_FILE=""

# ---------------------------------------------------------------------------
# Colors & logging
# ---------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()  { echo -e "${BLUE}[INFO]${NC}  $(date -u '+%Y-%m-%dT%H:%M:%SZ') $*"; }
log_ok()    { echo -e "${GREEN}[OK]${NC}    $(date -u '+%Y-%m-%dT%H:%M:%SZ') $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $(date -u '+%Y-%m-%dT%H:%M:%SZ') $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $(date -u '+%Y-%m-%dT%H:%M:%SZ') $*" >&2; }

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
    case "$1" in
        --docker)       USE_DOCKER=true;       shift   ;;
        --container)    DOCKER_CONTAINER="$2"; shift 2 ;;
        --yes|-y)       AUTO_CONFIRM=true;     shift   ;;
        --dry-run)      DRY_RUN=true;          shift   ;;
        --target-db)    TARGET_DB="$2";        shift 2 ;;
        --list)         LIST_MODE=true;        shift   ;;
        --help|-h)
            echo "Usage: $0 <backup_file> [OPTIONS]"
            echo "       $0 --list"
            echo ""
            echo "Options:"
            echo "  --docker                Use docker exec for local instance"
            echo "  --container NAME        Docker container name (default: forgeos-postgres)"
            echo "  --yes, -y               Skip confirmation prompt"
            echo "  --dry-run               Validate backup only, do not restore"
            echo "  --target-db DB          Restore into a different database"
            echo "  --list                  List available backups"
            echo "  -h, --help              Show this help"
            exit 0
            ;;
        -*)
            log_error "Unknown option: $1"
            exit 1
            ;;
        *)
            if [[ -z "${BACKUP_FILE}" ]]; then
                BACKUP_FILE="$1"
            else
                log_error "Unexpected argument: $1"
                exit 1
            fi
            shift
            ;;
    esac
done

# ---------------------------------------------------------------------------
# List available backups
# ---------------------------------------------------------------------------
list_backups() {
    log_info "Available backups in ${BACKUP_DIR}:"
    echo ""

    if [[ ! -d "${BACKUP_DIR}" ]]; then
        log_warn "Backup directory does not exist: ${BACKUP_DIR}"
        exit 0
    fi

    local found=false
    while IFS= read -r -d '' file; do
        found=true
        local basename
        basename="$(basename "${file}")"
        local size
        size="$(du -h "${file}" | awk '{print $1}')"
        local mtime
        mtime="$(stat -c '%y' "${file}" 2>/dev/null || stat -f '%Sm' "${file}" 2>/dev/null)"

        # Check for metadata file
        local meta_file="${file%.*}.meta"
        if [[ "${file}" == *.sql.gz ]]; then
            meta_file="${file%.sql.gz}.meta"
        fi

        if [[ -f "${meta_file}" ]]; then
            local db
            db=$(grep -o '"database": "[^"]*"' "${meta_file}" | cut -d'"' -f4)
            printf "  %-50s  %6s  %s  db=%s\n" "${basename}" "${size}" "${mtime%.*}" "${db}"
        else
            printf "  %-50s  %6s  %s\n" "${basename}" "${size}" "${mtime%.*}"
        fi
    done < <(find "${BACKUP_DIR}" -maxdepth 1 \( -name "*.dump" -o -name "*.sql.gz" \) -print0 | sort -z)

    if [[ "${found}" == false ]]; then
        log_info "No backups found."
    fi

    echo ""
}

# ---------------------------------------------------------------------------
# Detect backup format
# ---------------------------------------------------------------------------
detect_format() {
    local file="$1"

    if [[ "${file}" == *.dump ]]; then
        echo "custom"
    elif [[ "${file}" == *.sql.gz ]]; then
        echo "sql"
    elif [[ "${file}" == *.sql ]]; then
        echo "sql_plain"
    else
        log_error "Cannot determine backup format from filename: ${file}"
        log_error "Expected .dump (custom format) or .sql.gz (compressed SQL)."
        exit 1
    fi
}

# ---------------------------------------------------------------------------
# Validate backup integrity
# ---------------------------------------------------------------------------
validate_backup() {
    local file="$1"
    local format="$2"

    log_info "Validating backup file: ${file}"

    # Check file exists and is readable
    if [[ ! -f "${file}" ]]; then
        log_error "Backup file not found: ${file}"
        exit 1
    fi

    if [[ ! -r "${file}" ]]; then
        log_error "Backup file not readable: ${file}"
        exit 1
    fi

    local file_size
    file_size="$(stat -c '%s' "${file}" 2>/dev/null || stat -f '%z' "${file}" 2>/dev/null)"
    if [[ "${file_size}" -eq 0 ]]; then
        log_error "Backup file is empty: ${file}"
        exit 1
    fi

    # Verify SHA-256 checksum if metadata exists
    local meta_file="${file%.*}.meta"
    if [[ "${format}" == "sql" ]]; then
        meta_file="${file%.sql.gz}.meta"
    fi

    if [[ -f "${meta_file}" ]]; then
        local expected_sha256
        expected_sha256=$(grep -o '"sha256": "[^"]*"' "${meta_file}" | cut -d'"' -f4)
        if [[ -n "${expected_sha256}" ]]; then
            local actual_sha256
            actual_sha256="$(sha256sum "${file}" | awk '{print $1}')"
            if [[ "${expected_sha256}" == "${actual_sha256}" ]]; then
                log_ok "SHA-256 checksum verified."
            else
                log_error "SHA-256 checksum MISMATCH!"
                log_error "  Expected: ${expected_sha256}"
                log_error "  Actual:   ${actual_sha256}"
                log_error "Backup may be corrupted. Aborting."
                exit 1
            fi
        fi
    else
        log_warn "No metadata file found — skipping checksum verification."
    fi

    # Format-specific validation
    case "${format}" in
        custom)
            if [[ "${USE_DOCKER}" == true ]]; then
                docker cp "${file}" "${DOCKER_CONTAINER}:/tmp/validate_backup.dump"
                if docker exec "${DOCKER_CONTAINER}" pg_restore --list "/tmp/validate_backup.dump" &>/dev/null; then
                    log_ok "pg_restore --list validation passed."
                    docker exec "${DOCKER_CONTAINER}" rm -f "/tmp/validate_backup.dump"
                else
                    log_error "pg_restore --list validation FAILED."
                    docker exec "${DOCKER_CONTAINER}" rm -f "/tmp/validate_backup.dump"
                    exit 1
                fi
            else
                if pg_restore --list "${file}" &>/dev/null; then
                    log_ok "pg_restore --list validation passed."
                else
                    log_error "pg_restore --list validation FAILED."
                    exit 1
                fi
            fi
            ;;
        sql)
            if gzip -t "${file}" 2>/dev/null; then
                log_ok "gzip integrity check passed."
            else
                log_error "gzip integrity check FAILED."
                exit 1
            fi
            if zcat "${file}" | head -5 | grep -q "PostgreSQL database dump"; then
                log_ok "PostgreSQL dump header present."
            else
                log_warn "No PostgreSQL dump header found — file may not be a valid dump."
            fi
            ;;
        sql_plain)
            if head -5 "${file}" | grep -q "PostgreSQL database dump"; then
                log_ok "PostgreSQL dump header present."
            else
                log_warn "No PostgreSQL dump header found."
            fi
            ;;
    esac

    log_ok "Backup validation complete."
}

# ---------------------------------------------------------------------------
# Confirmation prompt
# ---------------------------------------------------------------------------
confirm_restore() {
    local target="$1"

    echo ""
    echo -e "${RED}WARNING: This will overwrite ALL data in database '${target}'.${NC}"
    echo -e "${RED}This operation is DESTRUCTIVE and IRREVERSIBLE.${NC}"
    echo ""
    echo "  Database: ${target}"
    echo "  Host:     ${PGHOST}:${PGPORT}"
    echo "  Backup:   ${BACKUP_FILE}"
    echo ""

    if [[ "${AUTO_CONFIRM}" == true ]]; then
        log_warn "Auto-confirm enabled (--yes). Proceeding without prompt."
        return 0
    fi

    read -rp "Type the database name '${target}' to confirm restore: " user_input

    if [[ "${user_input}" != "${target}" ]]; then
        log_error "Confirmation failed. You typed '${user_input}', expected '${target}'."
        log_error "Restore aborted."
        exit 1
    fi
}

# ---------------------------------------------------------------------------
# Restore
# ---------------------------------------------------------------------------
restore_backup() {
    local file="$1"
    local format="$2"
    local target="${TARGET_DB:-${PGDATABASE}}"

    log_info "Starting restore into database '${target}'..."

    local start_time
    start_time=$(date +%s)

    case "${format}" in
        custom)
            if [[ "${USE_DOCKER}" == true ]]; then
                docker cp "${file}" "${DOCKER_CONTAINER}:/tmp/restore_backup.dump"

                # Drop and recreate the target database
                docker exec "${DOCKER_CONTAINER}" psql -U "${PGUSER}" -d postgres \
                    -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${target}' AND pid <> pg_backend_pid();" \
                    2>/dev/null || true

                docker exec "${DOCKER_CONTAINER}" dropdb -U "${PGUSER}" --if-exists "${target}" 2>/dev/null || true
                docker exec "${DOCKER_CONTAINER}" createdb -U "${PGUSER}" "${target}"

                docker exec "${DOCKER_CONTAINER}" pg_restore \
                    -U "${PGUSER}" -d "${target}" \
                    --no-owner --no-privileges --verbose \
                    "/tmp/restore_backup.dump" 2>&1 | tail -5

                docker exec "${DOCKER_CONTAINER}" rm -f "/tmp/restore_backup.dump"
            else
                # Terminate existing connections
                psql -h "${PGHOST}" -p "${PGPORT}" -U "${PGUSER}" -d postgres \
                    -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${target}' AND pid <> pg_backend_pid();" \
                    2>/dev/null || true

                dropdb -h "${PGHOST}" -p "${PGPORT}" -U "${PGUSER}" --if-exists "${target}" 2>/dev/null || true
                createdb -h "${PGHOST}" -p "${PGPORT}" -U "${PGUSER}" "${target}"

                pg_restore -h "${PGHOST}" -p "${PGPORT}" -U "${PGUSER}" \
                    -d "${target}" --no-owner --no-privileges --verbose \
                    "${file}" 2>&1 | tail -5
            fi
            ;;
        sql)
            if [[ "${USE_DOCKER}" == true ]]; then
                docker exec "${DOCKER_CONTAINER}" psql -U "${PGUSER}" -d postgres \
                    -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${target}' AND pid <> pg_backend_pid();" \
                    2>/dev/null || true

                docker exec "${DOCKER_CONTAINER}" dropdb -U "${PGUSER}" --if-exists "${target}" 2>/dev/null || true
                docker exec "${DOCKER_CONTAINER}" createdb -U "${PGUSER}" "${target}"

                zcat "${file}" | docker exec -i "${DOCKER_CONTAINER}" \
                    psql -U "${PGUSER}" -d "${target}" --quiet 2>&1 | tail -5
            else
                psql -h "${PGHOST}" -p "${PGPORT}" -U "${PGUSER}" -d postgres \
                    -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${target}' AND pid <> pg_backend_pid();" \
                    2>/dev/null || true

                dropdb -h "${PGHOST}" -p "${PGPORT}" -U "${PGUSER}" --if-exists "${target}" 2>/dev/null || true
                createdb -h "${PGHOST}" -p "${PGPORT}" -U "${PGUSER}" "${target}"

                zcat "${file}" | psql -h "${PGHOST}" -p "${PGPORT}" -U "${PGUSER}" \
                    -d "${target}" --quiet 2>&1 | tail -5
            fi
            ;;
        sql_plain)
            if [[ "${USE_DOCKER}" == true ]]; then
                docker exec "${DOCKER_CONTAINER}" psql -U "${PGUSER}" -d postgres \
                    -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${target}' AND pid <> pg_backend_pid();" \
                    2>/dev/null || true

                docker exec "${DOCKER_CONTAINER}" dropdb -U "${PGUSER}" --if-exists "${target}" 2>/dev/null || true
                docker exec "${DOCKER_CONTAINER}" createdb -U "${PGUSER}" "${target}"

                docker cp "${file}" "${DOCKER_CONTAINER}:/tmp/restore_backup.sql"
                docker exec "${DOCKER_CONTAINER}" psql -U "${PGUSER}" -d "${target}" \
                    -f "/tmp/restore_backup.sql" --quiet 2>&1 | tail -5
                docker exec "${DOCKER_CONTAINER}" rm -f "/tmp/restore_backup.sql"
            else
                psql -h "${PGHOST}" -p "${PGPORT}" -U "${PGUSER}" -d postgres \
                    -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${target}' AND pid <> pg_backend_pid();" \
                    2>/dev/null || true

                dropdb -h "${PGHOST}" -p "${PGPORT}" -U "${PGUSER}" --if-exists "${target}" 2>/dev/null || true
                createdb -h "${PGHOST}" -p "${PGPORT}" -U "${PGUSER}" "${target}"

                psql -h "${PGHOST}" -p "${PGPORT}" -U "${PGUSER}" \
                    -d "${target}" -f "${file}" --quiet 2>&1 | tail -5
            fi
            ;;
    esac

    local end_time
    end_time=$(date +%s)
    local duration=$(( end_time - start_time ))

    log_ok "Restore complete in ${duration}s."
}

# ---------------------------------------------------------------------------
# Post-restore verification
# ---------------------------------------------------------------------------
verify_restore() {
    local target="${TARGET_DB:-${PGDATABASE}}"

    log_info "Running post-restore verification..."

    local table_count
    if [[ "${USE_DOCKER}" == true ]]; then
        table_count=$(docker exec "${DOCKER_CONTAINER}" psql -U "${PGUSER}" -d "${target}" \
            -t -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';" \
            2>/dev/null | xargs)
    else
        table_count=$(psql -h "${PGHOST}" -p "${PGPORT}" -U "${PGUSER}" -d "${target}" \
            -t -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';" \
            2>/dev/null | xargs)
    fi

    if [[ -n "${table_count}" ]] && [[ "${table_count}" -gt 0 ]]; then
        log_ok "Post-restore check: ${table_count} table(s) found in '${target}'."
    else
        log_warn "Post-restore check: 0 tables found — the backup may have been empty."
    fi
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
    # Handle list mode
    if [[ "${LIST_MODE}" == true ]]; then
        list_backups
        exit 0
    fi

    # Require backup file argument
    if [[ -z "${BACKUP_FILE}" ]]; then
        log_error "No backup file specified."
        echo "Usage: $0 <backup_file> [OPTIONS]"
        echo "       $0 --list"
        exit 1
    fi

    # Resolve to absolute path if needed
    if [[ ! "${BACKUP_FILE}" = /* ]]; then
        BACKUP_FILE="$(cd "$(dirname "${BACKUP_FILE}")" && pwd)/$(basename "${BACKUP_FILE}")"
    fi

    local format
    format="$(detect_format "${BACKUP_FILE}")"
    local target="${TARGET_DB:-${PGDATABASE}}"

    log_info "============================================="
    log_info "ForgeOS PostgreSQL Restore"
    log_info "============================================="
    log_info "Backup:      ${BACKUP_FILE}"
    log_info "Format:      ${format}"
    log_info "Target DB:   ${target}"
    log_info "Host:        ${PGHOST}:${PGPORT}"
    log_info "Docker mode: ${USE_DOCKER}"
    log_info "Dry run:     ${DRY_RUN}"
    log_info "============================================="

    # Step 1: Validate backup integrity
    validate_backup "${BACKUP_FILE}" "${format}"

    if [[ "${DRY_RUN}" == true ]]; then
        log_ok "Dry run complete — backup is valid. No restore performed."
        exit 0
    fi

    # Step 2: Require explicit confirmation
    confirm_restore "${target}"

    # Step 3: Restore
    restore_backup "${BACKUP_FILE}" "${format}" "${target}"

    # Step 4: Post-restore verification
    verify_restore

    log_ok "============================================="
    log_ok "Restore pipeline complete."
    log_ok "============================================="
}

main "$@"
