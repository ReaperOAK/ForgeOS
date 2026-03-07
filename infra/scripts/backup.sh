#!/usr/bin/env bash
# =============================================================================
# ForgeOS — PostgreSQL Backup Script
# =============================================================================
# Creates timestamped pg_dump backups with compression, rotation, and
# integrity verification. Works with both Docker Compose and remote
# PostgreSQL instances.
#
# Usage:
#   ./backup.sh                      # Backup with defaults
#   ./backup.sh --format custom      # Custom-format dump (recommended)
#   ./backup.sh --format sql         # Plain SQL dump
#   ./backup.sh --retention 14       # Keep 14 days of backups
#   ./backup.sh --verify             # Verify backup after creation
#   ./backup.sh --docker             # Use Docker exec for local instance
#
# Environment Variables (override defaults via .env or export):
#   PGHOST, PGPORT, PGUSER, PGDATABASE, PGPASSWORD / PGPASSFILE
#   BACKUP_DIR          — Target directory for backup files
#   BACKUP_RETENTION    — Days to keep old backups (default: 7)
#   BACKUP_FORMAT       — "custom" or "sql" (default: custom)
#   BACKUP_COMPRESSION  — Compression level 0-9 (default: 6)
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

# Source .env if present (never committed — contains secrets)
if [[ -f "${INFRA_DIR}/.env" ]]; then
    # shellcheck disable=SC1091
    set -a; source "${INFRA_DIR}/.env"; set +a
fi

PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-${DB_PORT:-5432}}"
PGUSER="${PGUSER:-${DB_USER:-forgeos}}"
PGDATABASE="${PGDATABASE:-${DB_NAME:-forgeos}}"

BACKUP_DIR="${BACKUP_DIR:-${INFRA_DIR}/backups}"
BACKUP_RETENTION="${BACKUP_RETENTION:-7}"
BACKUP_FORMAT="${BACKUP_FORMAT:-custom}"
BACKUP_COMPRESSION="${BACKUP_COMPRESSION:-6}"
DOCKER_CONTAINER="${DOCKER_CONTAINER:-forgeos-postgres}"
USE_DOCKER=false
VERIFY_AFTER=false

TIMESTAMP="$(date -u '+%Y%m%dT%H%M%SZ')"

# ---------------------------------------------------------------------------
# Colors & logging
# ---------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info()  { echo -e "${BLUE}[INFO]${NC}  $(date -u '+%Y-%m-%dT%H:%M:%SZ') $*"; }
log_ok()    { echo -e "${GREEN}[OK]${NC}    $(date -u '+%Y-%m-%dT%H:%M:%SZ') $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $(date -u '+%Y-%m-%dT%H:%M:%SZ') $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $(date -u '+%Y-%m-%dT%H:%M:%SZ') $*" >&2; }

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
    case "$1" in
        --format)       BACKUP_FORMAT="$2";       shift 2 ;;
        --retention)    BACKUP_RETENTION="$2";    shift 2 ;;
        --compression)  BACKUP_COMPRESSION="$2";  shift 2 ;;
        --dir)          BACKUP_DIR="$2";          shift 2 ;;
        --docker)       USE_DOCKER=true;          shift   ;;
        --container)    DOCKER_CONTAINER="$2";    shift 2 ;;
        --verify)       VERIFY_AFTER=true;        shift   ;;
        --help|-h)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --format custom|sql     Dump format (default: custom)"
            echo "  --retention DAYS        Days to keep old backups (default: 7)"
            echo "  --compression 0-9       Compression level (default: 6)"
            echo "  --dir PATH              Backup directory"
            echo "  --docker                Use docker exec for local instance"
            echo "  --container NAME        Docker container name (default: forgeos-postgres)"
            echo "  --verify                Verify backup integrity after creation"
            echo "  -h, --help              Show this help"
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            exit 1
            ;;
    esac
done

# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------
validate_format() {
    case "${BACKUP_FORMAT}" in
        custom|sql) ;;
        *)
            log_error "Invalid backup format '${BACKUP_FORMAT}'. Use 'custom' or 'sql'."
            exit 1
            ;;
    esac
}

validate_compression() {
    if ! [[ "${BACKUP_COMPRESSION}" =~ ^[0-9]$ ]]; then
        log_error "Compression level must be 0-9, got '${BACKUP_COMPRESSION}'."
        exit 1
    fi
}

check_connectivity() {
    if [[ "${USE_DOCKER}" == true ]]; then
        if ! docker inspect "${DOCKER_CONTAINER}" &>/dev/null; then
            log_error "Docker container '${DOCKER_CONTAINER}' not found or not running."
            exit 1
        fi
        # Verify PostgreSQL is accepting connections inside the container
        if ! docker exec "${DOCKER_CONTAINER}" pg_isready -U "${PGUSER}" -d "${PGDATABASE}" &>/dev/null; then
            log_error "PostgreSQL is not ready inside container '${DOCKER_CONTAINER}'."
            exit 1
        fi
    else
        if ! command -v pg_dump &>/dev/null; then
            log_error "pg_dump not found. Install postgresql-client or use --docker mode."
            exit 1
        fi
        if ! pg_isready -h "${PGHOST}" -p "${PGPORT}" -U "${PGUSER}" -d "${PGDATABASE}" &>/dev/null; then
            log_error "Cannot connect to PostgreSQL at ${PGHOST}:${PGPORT}."
            exit 1
        fi
    fi
}

# ---------------------------------------------------------------------------
# Backup
# ---------------------------------------------------------------------------
create_backup() {
    local ext
    local dump_opts=()

    case "${BACKUP_FORMAT}" in
        custom)
            ext="dump"
            dump_opts+=("--format=custom" "--compress=${BACKUP_COMPRESSION}")
            ;;
        sql)
            ext="sql.gz"
            dump_opts+=("--format=plain")
            ;;
    esac

    local backup_file="${BACKUP_DIR}/${PGDATABASE}_${TIMESTAMP}.${ext}"
    local metadata_file="${BACKUP_DIR}/${PGDATABASE}_${TIMESTAMP}.meta"

    mkdir -p "${BACKUP_DIR}"

    log_info "Starting ${BACKUP_FORMAT} backup of '${PGDATABASE}'..."
    log_info "Target: ${backup_file}"

    local start_time
    start_time=$(date +%s)

    if [[ "${USE_DOCKER}" == true ]]; then
        if [[ "${BACKUP_FORMAT}" == "sql" ]]; then
            docker exec "${DOCKER_CONTAINER}" \
                pg_dump -U "${PGUSER}" -d "${PGDATABASE}" "${dump_opts[@]}" \
                | gzip -"${BACKUP_COMPRESSION}" > "${backup_file}"
        else
            docker exec "${DOCKER_CONTAINER}" \
                pg_dump -U "${PGUSER}" -d "${PGDATABASE}" "${dump_opts[@]}" \
                > "${backup_file}"
        fi
    else
        if [[ "${BACKUP_FORMAT}" == "sql" ]]; then
            pg_dump -h "${PGHOST}" -p "${PGPORT}" -U "${PGUSER}" \
                -d "${PGDATABASE}" "${dump_opts[@]}" \
                | gzip -"${BACKUP_COMPRESSION}" > "${backup_file}"
        else
            pg_dump -h "${PGHOST}" -p "${PGPORT}" -U "${PGUSER}" \
                -d "${PGDATABASE}" "${dump_opts[@]}" \
                -f "${backup_file}"
        fi
    fi

    local end_time
    end_time=$(date +%s)
    local duration=$(( end_time - start_time ))

    # Generate checksums for integrity verification
    local checksum
    checksum="$(sha256sum "${backup_file}" | awk '{print $1}')"

    local file_size
    file_size="$(du -h "${backup_file}" | awk '{print $1}')"

    # Write metadata file
    cat > "${metadata_file}" <<EOF
{
  "database": "${PGDATABASE}",
  "host": "${PGHOST}",
  "port": ${PGPORT},
  "user": "${PGUSER}",
  "timestamp": "${TIMESTAMP}",
  "format": "${BACKUP_FORMAT}",
  "compression_level": ${BACKUP_COMPRESSION},
  "file": "$(basename "${backup_file}")",
  "size": "${file_size}",
  "sha256": "${checksum}",
  "duration_seconds": ${duration},
  "docker_mode": ${USE_DOCKER},
  "pg_version": "$(get_pg_version)"
}
EOF

    log_ok "Backup complete: ${backup_file} (${file_size}, ${duration}s)"
    log_info "Checksum (SHA-256): ${checksum}"

    echo "${backup_file}"
}

get_pg_version() {
    if [[ "${USE_DOCKER}" == true ]]; then
        docker exec "${DOCKER_CONTAINER}" psql -U "${PGUSER}" -d "${PGDATABASE}" \
            -t -c "SELECT version();" 2>/dev/null | head -1 | xargs || echo "unknown"
    else
        psql -h "${PGHOST}" -p "${PGPORT}" -U "${PGUSER}" -d "${PGDATABASE}" \
            -t -c "SELECT version();" 2>/dev/null | head -1 | xargs || echo "unknown"
    fi
}

# ---------------------------------------------------------------------------
# Verification
# ---------------------------------------------------------------------------
verify_backup() {
    local backup_file="$1"

    log_info "Verifying backup integrity..."

    case "${BACKUP_FORMAT}" in
        custom)
            if [[ "${USE_DOCKER}" == true ]]; then
                # Copy file into container for verification
                docker cp "${backup_file}" "${DOCKER_CONTAINER}:/tmp/verify_backup.dump"
                if docker exec "${DOCKER_CONTAINER}" pg_restore --list "/tmp/verify_backup.dump" &>/dev/null; then
                    log_ok "Backup verification passed (pg_restore --list succeeded)."
                    docker exec "${DOCKER_CONTAINER}" rm -f "/tmp/verify_backup.dump"
                else
                    log_error "Backup verification FAILED — pg_restore --list returned errors."
                    docker exec "${DOCKER_CONTAINER}" rm -f "/tmp/verify_backup.dump"
                    return 1
                fi
            else
                if pg_restore --list "${backup_file}" &>/dev/null; then
                    log_ok "Backup verification passed (pg_restore --list succeeded)."
                else
                    log_error "Backup verification FAILED — pg_restore --list returned errors."
                    return 1
                fi
            fi
            ;;
        sql)
            # For SQL dumps, verify the gzip integrity and check for expected markers
            if gzip -t "${backup_file}" 2>/dev/null; then
                log_ok "Backup verification passed (gzip integrity OK)."
            else
                log_error "Backup verification FAILED — gzip integrity check failed."
                return 1
            fi
            # Check for PostgreSQL dump header
            if zcat "${backup_file}" | head -5 | grep -q "PostgreSQL database dump"; then
                log_ok "Backup contains valid PostgreSQL dump header."
            else
                log_warn "Backup does not contain expected PostgreSQL dump header."
            fi
            ;;
    esac
}

# ---------------------------------------------------------------------------
# Rotation — purge backups older than retention policy
# ---------------------------------------------------------------------------
rotate_backups() {
    log_info "Rotating backups older than ${BACKUP_RETENTION} days..."

    local count
    count=$(find "${BACKUP_DIR}" -maxdepth 1 -name "${PGDATABASE}_*.dump" -o -name "${PGDATABASE}_*.sql.gz" -o -name "${PGDATABASE}_*.meta" -mtime +"${BACKUP_RETENTION}" 2>/dev/null | wc -l)

    if [[ "${count}" -gt 0 ]]; then
        find "${BACKUP_DIR}" -maxdepth 1 \
            \( -name "${PGDATABASE}_*.dump" -o -name "${PGDATABASE}_*.sql.gz" -o -name "${PGDATABASE}_*.meta" \) \
            -mtime +"${BACKUP_RETENTION}" \
            -delete

        log_ok "Removed ${count} expired backup file(s)."
    else
        log_info "No expired backups found."
    fi

    # List remaining backups
    local remaining
    remaining=$(find "${BACKUP_DIR}" -maxdepth 1 \( -name "*.dump" -o -name "*.sql.gz" \) 2>/dev/null | wc -l)
    log_info "Backups on disk: ${remaining}"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
    log_info "============================================="
    log_info "ForgeOS PostgreSQL Backup"
    log_info "============================================="
    log_info "Database:    ${PGDATABASE}"
    log_info "Host:        ${PGHOST}:${PGPORT}"
    log_info "Format:      ${BACKUP_FORMAT}"
    log_info "Compression: ${BACKUP_COMPRESSION}"
    log_info "Retention:   ${BACKUP_RETENTION} days"
    log_info "Docker mode: ${USE_DOCKER}"
    log_info "============================================="

    validate_format
    validate_compression
    check_connectivity

    local backup_file
    backup_file="$(create_backup)"

    if [[ "${VERIFY_AFTER}" == true ]]; then
        verify_backup "${backup_file}"
    fi

    rotate_backups

    log_ok "============================================="
    log_ok "Backup pipeline complete."
    log_ok "============================================="
}

main "$@"
