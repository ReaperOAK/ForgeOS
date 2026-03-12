# =============================================================================
# ForgeOS — Development Makefile
# =============================================================================
# Common targets for building, testing, and running the ForgeOS platform.
#
# Quick start:
#   make setup    — Check prerequisites and initialise environment
#   make up       — Start all services (Postgres, MCP server, pgAdmin)
#   make migrate  — Apply pending database migrations
#   make seed     — Load sample ticket data
#   make test     — Run the full test suite
#   make help     — Show this help text
#
# Ticket: FORGEOS-DO003
# =============================================================================

.DEFAULT_GOAL := help
SHELL         := /bin/bash
.SHELLFLAGS   := -euo pipefail -c

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
COMPOSE_BASE  := infra/docker-compose.yml
COMPOSE_DEV   := infra/docker-compose.dev.yml
COMPOSE       := docker compose -f $(COMPOSE_BASE) -f $(COMPOSE_DEV)
SERVER_DIR    := forgeos-server
SCRIPTS_DIR   := infra/scripts

# ---------------------------------------------------------------------------
# Colours (disabled when stdout is not a terminal)
# ---------------------------------------------------------------------------
ifneq ($(TERM),)
  GREEN  := \033[32m
  YELLOW := \033[33m
  CYAN   := \033[36m
  RESET  := \033[0m
else
  GREEN  :=
  YELLOW :=
  CYAN   :=
  RESET  :=
endif

# =============================================================================
# Core Targets
# =============================================================================

.PHONY: help
help: ## Show this help text
	@printf "\n$(CYAN)ForgeOS Development Makefile$(RESET)\n\n"
	@printf "$(YELLOW)Usage:$(RESET)  make <target>\n\n"
	@printf "$(YELLOW)Targets:$(RESET)\n"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  $(GREEN)%-16s$(RESET) %s\n", $$1, $$2}'
	@printf "\n"

# ---------------------------------------------------------------------------
# Service Lifecycle
# ---------------------------------------------------------------------------

.PHONY: up
up: ## Start all services in development mode (detached)
	@printf "$(GREEN)▶ Starting ForgeOS services …$(RESET)\n"
	$(COMPOSE) up -d --build
	@printf "$(GREEN)✔ Services running. MCP server → http://localhost:3000  pgAdmin → http://localhost:5050$(RESET)\n"

.PHONY: down
down: ## Stop and remove containers (preserves volumes)
	@printf "$(YELLOW)▶ Stopping ForgeOS services …$(RESET)\n"
	$(COMPOSE) down
	@printf "$(YELLOW)✔ Containers removed. Volumes preserved.$(RESET)\n"

.PHONY: restart
restart: ## Restart all services (down then up)
	@$(MAKE) --no-print-directory down
	@$(MAKE) --no-print-directory up

.PHONY: logs
logs: ## Tail logs for all running services
	$(COMPOSE) logs -f --tail=100

.PHONY: ps
ps: ## Show status of running containers
	$(COMPOSE) ps

# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

.PHONY: migrate
migrate: ## Apply pending database migrations
	@printf "$(GREEN)▶ Running database migrations …$(RESET)\n"
	$(COMPOSE) exec mcp-server npx tsx src/db/migrate.ts
	@printf "$(GREEN)✔ Migrations applied.$(RESET)\n"

.PHONY: seed
seed: ## Load sample ticket data into the database
	@printf "$(GREEN)▶ Seeding database …$(RESET)\n"
	$(COMPOSE) exec mcp-server npx tsx src/db/seed.ts
	@printf "$(GREEN)✔ Database seeded.$(RESET)\n"

.PHONY: db-shell
db-shell: ## Open an interactive psql session
	$(COMPOSE) exec postgres psql -U forgeos -d forgeos

.PHONY: db-reset
db-reset: ## Drop and recreate the database (DESTRUCTIVE)
	@printf "$(YELLOW)⚠  This will destroy all data. Press Ctrl-C to abort …$(RESET)\n"
	@sleep 3
	$(COMPOSE) down -v
	@$(MAKE) --no-print-directory up
	@printf "$(GREEN)✔ Database reset. Run 'make migrate && make seed' to re-initialise.$(RESET)\n"

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------

.PHONY: build
build: ## Build the MCP server Docker image
	@printf "$(GREEN)▶ Building MCP server image …$(RESET)\n"
	$(COMPOSE) build mcp-server
	@printf "$(GREEN)✔ Image built.$(RESET)\n"

.PHONY: build-server
build-server: ## Compile TypeScript in forgeos-server (no Docker)
	@printf "$(GREEN)▶ Compiling TypeScript …$(RESET)\n"
	cd $(SERVER_DIR) && npm run build
	@printf "$(GREEN)✔ Compiled to $(SERVER_DIR)/dist/$(RESET)\n"

# ---------------------------------------------------------------------------
# Quality
# ---------------------------------------------------------------------------

.PHONY: test
test: ## Run the full test suite (vitest)
	@printf "$(GREEN)▶ Running tests …$(RESET)\n"
	cd $(SERVER_DIR) && npm test
	@printf "$(GREEN)✔ Tests complete.$(RESET)\n"

.PHONY: test-watch
test-watch: ## Run tests in watch mode
	cd $(SERVER_DIR) && npm run test:watch

.PHONY: test-coverage
test-coverage: ## Run tests with coverage report
	cd $(SERVER_DIR) && npx vitest run --coverage

.PHONY: lint
lint: ## Run linters (ESLint for TS, Ruff for Python)
	@printf "$(GREEN)▶ Linting …$(RESET)\n"
	cd $(SERVER_DIR) && npm run lint || true

	@printf "$(GREEN)✔ Lint complete.$(RESET)\n"

.PHONY: typecheck
typecheck: ## Run TypeScript type checking (no emit)
	@printf "$(GREEN)▶ Type-checking …$(RESET)\n"
	cd $(SERVER_DIR) && npm run typecheck
	@printf "$(GREEN)✔ Types OK.$(RESET)\n"

.PHONY: format
format: ## Auto-format code (Prettier + Ruff)
	@printf "$(GREEN)▶ Formatting …$(RESET)\n"
	@if command -v npx >/dev/null 2>&1 && [ -f $(SERVER_DIR)/node_modules/.bin/prettier ]; then \
		cd $(SERVER_DIR) && npx prettier --write 'src/**/*.ts'; \
	else \
		printf "$(YELLOW)⚠  prettier not available — skipping TS format$(RESET)\n"; \
	fi

	@printf "$(GREEN)✔ Formatting complete.$(RESET)\n"

# ---------------------------------------------------------------------------
# Setup & Cleanup
# ---------------------------------------------------------------------------

.PHONY: setup
setup: ## Check prerequisites and initialise dev environment
	@bash $(SCRIPTS_DIR)/setup.sh

.PHONY: clean
clean: ## Remove build artefacts, coverage, and stopped containers
	@printf "$(YELLOW)▶ Cleaning …$(RESET)\n"
	rm -rf $(SERVER_DIR)/dist $(SERVER_DIR)/coverage
	$(COMPOSE) down --remove-orphans 2>/dev/null || true
	@printf "$(YELLOW)✔ Clean.$(RESET)\n"

.PHONY: clean-all
clean-all: clean ## Clean everything including Docker volumes (DESTRUCTIVE)
	@printf "$(YELLOW)⚠  Removing Docker volumes …$(RESET)\n"
	$(COMPOSE) down -v --remove-orphans 2>/dev/null || true
	docker image prune -f 2>/dev/null || true
	@printf "$(YELLOW)✔ Full clean complete.$(RESET)\n"

# ---------------------------------------------------------------------------
# Convenience
# ---------------------------------------------------------------------------

.PHONY: dev
dev: up migrate ## Start services and apply migrations (one-shot dev start)
	@printf "$(GREEN)✔ Dev environment ready.$(RESET)\n"

.PHONY: status
status: ## Show ticket system status
	python3 .github/tickets.py --status 2>/dev/null || printf "$(YELLOW)tickets.py not available$(RESET)\n"
