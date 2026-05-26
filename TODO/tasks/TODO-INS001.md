## TODO-INS001: One-click installer for ForgeOS `.github` assets and optional local MCP dev setup

**ticket_id**: TODO-INS001
**title**: One-click installer to add `.github` assets and optional local MCP dev setup to an existing repo
**type**: infra
**priority**: P0
**estimated_effort**: M
**file_paths**: TODO/tasks/TODO-INS001.md, scripts/install-forgeos.sh, scripts/install-forgeos.ps1, scripts/README-install.md, .github/templates/installer/, docs/operations/onboarding.md
**depends_on**: TASK-COP-MCP002, TASK-COP-MCP006

### Description

Create a cross-platform, repository-local installer that: (1) injects necessary `.github` agent/instruction/prompt assets (from a vetted template), (2) optionally bootstraps a local dev MCP environment (docker-compose minimal), and (3) validates the installation via the MCP Doctor smoke checks.

Installer must be idempotent, safe (no committed secrets), and provide a dry-run mode similar to `scripts/sync-vibecoding.sh`.

### Acceptance Criteria (Given / When / Then style)
- Given an existing repository, when the operator runs `./scripts/install-forgeos.sh --repo . --dry-run`, then the script shows the list of files it will create/modify and exits with code 0.
- Given `--apply`, when the operator runs the installer, then `.github/agents/`, `.github/instructions/`, and a minimal `.github/workflows/forgeos-mcp-validate.yml` are created or updated from the template, with no checked-in secrets.
- Given `--with-local-mcp`, when the operator runs the installer, then a minimal docker-compose stack is created under `.dev/forgeos-mcp/compose.yml` and `make dev-up` instructions are added to `scripts/README-install.md`.
- Given completion, the installer runs the MCP Doctor smoke-check (if the local MCP was requested) and reports pass/fail with remediation hints.

### Implementation Notes
- The installer must not add any real credentials; instead provide clear guidance and an interactive prompt to inject local credentials into `.env.local` which must be gitignored.
- Provide both sh (Linux/mac) and PowerShell scripts for cross-platform support.
- Document manual rollback steps.
