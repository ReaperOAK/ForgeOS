# =============================================================================
# ForgeOS Infrastructure — Makefile
# =============================================================================
# Convenience targets for infrastructure operations.
#
# Usage:
#   make backup                              # Backup (Docker mode, with verify)
#   make backup-sql                          # Backup as compressed SQL
#   make backup-remote                       # Backup from remote host
#   make restore FILE=<path>                 # Restore from backup file
#   make restore-list                        # List available backups
#   make restore-dry-run FILE=<path>         # Validate backup without restoring
#
# Ticket: FORGEOS-DO007
# =============================================================================

SHELL := /bin/bash
.DEFAULT_GOAL := help

SCRIPTS_DIR := $(CURDIR)/scripts
BACKUP_SCRIPT := $(SCRIPTS_DIR)/backup.sh
RESTORE_SCRIPT := $(SCRIPTS_DIR)/restore.sh

# Configurable defaults
BACKUP_FORMAT ?= custom
BACKUP_RETENTION ?= 7
DOCKER_CONTAINER ?= forgeos-postgres

# ---------------------------------------------------------------------------
# Backup targets
# ---------------------------------------------------------------------------

.PHONY: backup
backup: ## Create a database backup (Docker mode, custom format, with verification)
	@$(BACKUP_SCRIPT) --docker --format $(BACKUP_FORMAT) --retention $(BACKUP_RETENTION) --verify

.PHONY: backup-sql
backup-sql: ## Create a plain SQL backup (Docker mode, gzipped)
	@$(BACKUP_SCRIPT) --docker --format sql --retention $(BACKUP_RETENTION) --verify

.PHONY: backup-remote
backup-remote: ## Create a backup from a remote PostgreSQL instance
	@$(BACKUP_SCRIPT) --format $(BACKUP_FORMAT) --retention $(BACKUP_RETENTION) --verify

.PHONY: backup-no-verify
backup-no-verify: ## Create a backup without verification step
	@$(BACKUP_SCRIPT) --docker --format $(BACKUP_FORMAT) --retention $(BACKUP_RETENTION)

# ---------------------------------------------------------------------------
# Restore targets
# ---------------------------------------------------------------------------

.PHONY: restore
restore: ## Restore from a backup file (requires FILE=<path>)
ifndef FILE
	$(error FILE is required. Usage: make restore FILE=path/to/backup.dump)
endif
	@$(RESTORE_SCRIPT) $(FILE) --docker

.PHONY: restore-list
restore-list: ## List available backups
	@$(RESTORE_SCRIPT) --list

.PHONY: restore-dry-run
restore-dry-run: ## Validate a backup without restoring (requires FILE=<path>)
ifndef FILE
	$(error FILE is required. Usage: make restore-dry-run FILE=path/to/backup.dump)
endif
	@$(RESTORE_SCRIPT) $(FILE) --docker --dry-run

.PHONY: restore-auto
restore-auto: ## Restore without interactive confirmation (requires FILE=<path>)
ifndef FILE
	$(error FILE is required. Usage: make restore-auto FILE=path/to/backup.dump)
endif
	@$(RESTORE_SCRIPT) $(FILE) --docker --yes

# ---------------------------------------------------------------------------
# Help
# ---------------------------------------------------------------------------

.PHONY: help
help: ## Show this help
	@echo "ForgeOS Infrastructure Targets:"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'
	@echo ""
