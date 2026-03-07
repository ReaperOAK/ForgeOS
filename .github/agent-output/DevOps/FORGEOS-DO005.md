# FORGEOS-DO005 — DevOps BACKEND Summary

## Ticket
**ID:** FORGEOS-DO005
**Title:** Create GitHub Actions CI Workflow for MCP Server
**Stage:** BACKEND → QA

## What Was Done

Created `.github/workflows/mcp-server-ci.yml` — a comprehensive CI pipeline for both the TypeScript forgeos-server and the Python mcp-server.

### Workflow Structure (6 parallel jobs)

| Job | Target | Timeout | Description |
|-----|--------|---------|-------------|
| `ts-lint-typecheck` | forgeos-server | 5 min | ESLint + `tsc --noEmit` |
| `ts-test` | forgeos-server | 8 min | Vitest + coverage, PostgreSQL 17 service |
| `py-lint-typecheck` | mcp-server | 5 min | ruff check + ruff format --check + pyright strict |
| `py-test` | mcp-server | 8 min | pytest + coverage, PostgreSQL 17 service |
| `docker-build` | forgeos-server | 8 min | Docker Buildx + GHA cache, no push |
| `ci-gate` | all | 1 min | Aggregates all job results; fails if any upstream failed |

### Key Design Decisions

1. **pyright over mypy** — The project's `pyproject.toml` configures `[tool.pyright]` with `typeCheckingMode = "strict"`. Used pyright to match existing project configuration rather than introducing a competing type checker.
2. **Path filtering** — Triggers only on changes to `forgeos-server/**`, `mcp-server/**`, or the workflow itself; avoids wasteful CI runs on doc-only changes.
3. **Concurrency control** — `cancel-in-progress: true` ensures stacked pushes don't waste runner time.
4. **PostgreSQL service containers** — `postgres:17-alpine` with health checks (`pg_isready`) and 15s start period; credentials are CI-only test values (no secrets).
5. **Docker layer caching** — GitHub Actions cache (`type=gha`) for Buildx to keep image build fast.
6. **CI gate job** — Single required status check for branch protection; depends on all upstream jobs with `if: always()` to report even partial failures.
7. **Coverage artifacts** — Uploaded on every run (7-day retention) for downstream analysis.

### Acceptance Criteria Mapping

| Criterion | Status |
|-----------|--------|
| Workflow triggers on push to main and pull request events | ✅ Configured with path filters |
| PostgreSQL service container starts and is available for tests | ✅ postgres:17-alpine with health checks |
| Linting step runs ruff and fails the build on violations | ✅ `ruff check` + `ruff format --check` |
| Type checking step runs pyright in strict mode | ✅ pyright (project-configured strict mode) |
| Unit tests run with pytest and report coverage | ✅ pytest --cov with XML + terminal output |
| Workflow completes within 10 minutes | ✅ Individual job timeouts: 1–8 min, parallel execution |
| Workflow status badge can be embedded in README | ✅ Standard GH Actions badge URL available |

### Status Badge (for README)

```markdown
![MCP Server CI](https://github.com/<owner>/<repo>/actions/workflows/mcp-server-ci.yml/badge.svg)
```

### Branch Protection Recommendation

Configure `ci-gate` as the single required status check for the `main` branch. This gates merges on all lint, type check, test, and Docker build jobs.

## Artifacts

- `.github/workflows/mcp-server-ci.yml` (created)

## Confidence

**HIGH** — Workflow follows GitHub Actions best practices, uses explicit image tags (postgres:17-alpine, node:22, python:3.12), non-secret CI credentials, proper caching, and matches the project's actual tooling configuration.
