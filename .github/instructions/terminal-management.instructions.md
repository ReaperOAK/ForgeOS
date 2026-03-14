---
name: Terminal Management
applyTo: '**'
description: Terminal usage rules, MCP-first operations, tickets.py scoping, command safety, background process management.
---

# Terminal Management

## 1. MCP-First Principle

RULE: Agents use MCP tools for all ticket lifecycle operations.
RULE: Terminal commands are reserved for build, test, lint, git, and file operations.
PROHIBITED: Agents running `tickets.py` via terminal (except TODO and Validator — see Section 3).
REQUIRED: Use ForgeOS MCP Server tools for ticket operations:

| MCP Tool | Purpose |
|----------|---------|
| `tickets.next` | Find next available ticket for a stage |
| `tickets.claim` | Claim a ticket with lease |
| `tickets.complete` | Mark stage complete, advance ticket |
| `tickets.reject` | Reject ticket, trigger rework or escalation |
| `tickets.release` | Release a stale claim |
| `tickets.extend` | Extend claim lease duration |
| `tickets.graph` | Query dependency graph |
| `tickets.stats` | Get ticket statistics and status |
| `tickets.spawn` | Create child tickets |
| `tickets.update` | Update ticket metadata |

## 2. Allowed Terminal Commands (All Agents)

ALLOWED: Build commands (`npm run build`, `make`, `cargo build`, etc.)
ALLOWED: Test commands (`npm test`, `pytest`, `vitest`, etc.)
ALLOWED: Lint and type-check commands (`eslint`, `tsc --noEmit`, `mypy`, etc.)
ALLOWED: Git operations (`git add <file>`, `git commit`, `git push`, `git pull --rebase`)
ALLOWED: File inspection (`cat`, `ls`, `find`, `grep`, `head`, `tail`, `wc`)
ALLOWED: Package management (`npm install`, `pip install`, etc.)
ALLOWED: Code generation and formatting (`prettier`, `black`, etc.)

## 3. tickets.py CLI — Human Operators and Authorized Agents Only

RULE: `tickets.py` is a CLI tool for human operators managing the system.

### Authorized Callers

| Caller | Allowed Commands | Context |
|--------|-----------------|---------|
| Human operators | All commands | Direct CLI management |
| TODO agent | `--parse`, `--sync` | After L1→L2→L3 decomposition |
| Validator agent | `--sync`, `--advance` | Before final DONE commit |
| ForgeOS dispatcher | `--sync`, `--claim`, `--advance`, `--release-expired` | Dispatcher operations |

PROHIBITED: Any other agent executing `python3 .github/tickets.py`.
PROHIBITED: Agents using terminal to bypass MCP tool safety checks.

## 4. Command Safety Rules

PROHIBITED: `rm -rf` without explicit human approval.
PROHIBITED: `git add .` / `git add -A` / `git add --all` — explicit file staging only.
PROHIBITED: `git push --force` or `git reset --hard` — destructive git operations.
PROHIBITED: Running database migration commands without human approval.
PROHIBITED: `kill -9` on system processes.
PROHIBITED: Modifying `/etc/`, system configs, or files outside the repository.
PROHIBITED: Installing global packages without human approval.
PROHIBITED: Downloading or executing scripts from external URLs.

REQUIRED: Use explicit file paths in all `git add` commands.
REQUIRED: Verify command intent before executing destructive operations.
REQUIRED: Use `--dry-run` flags when available for irreversible commands.

## 5. Background Process Management

RULE: Long-running processes (servers, watchers) must use background execution.
RULE: Track background process IDs for cleanup.
RULE: Terminate background processes when no longer needed.
PROHIBITED: Leaving orphaned background processes after task completion.
PROHIBITED: Running interactive commands that block the terminal indefinitely.

## 6. Output Management

RULE: Pipe verbose commands through `head`, `tail`, or `grep` to limit output.
RULE: Use `--quiet` or `--silent` flags where available.
RULE: Redirect large outputs to files when processing is needed.
PROHIBITED: Running commands that produce unbounded output without limiting.

## 7. Environment Safety

PROHIBITED: Exporting secrets, tokens, or credentials in terminal commands.
PROHIBITED: Echoing or printing sensitive environment variables.
REQUIRED: Use `.env` files or secret management for credentials.
RULE: Terminal history may be logged — treat all commands as auditable.
