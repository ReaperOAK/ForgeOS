# TASK-COP-MCP002 — Backend Summary

**Ticket:** TASK-COP-MCP002  
**Title:** Replace Checked-In Workspace Bearer With Safe Local Setup  
**Agent:** Backend  
**Completed:** 2026-05-10  

## Artifacts
- `.vscode/mcp.json` — replaced hardcoded token with `${FORGEOS_ADMIN_TOKEN}` reference
- `.env.example` — created with `FORGEOS_ADMIN_TOKEN=forgeos_admin_CHANGE_ME`

## Changes Made

### 1. `.vscode/mcp.json`
Replaced:
```json
"Authorization": "Bearer forgeos_admin_CHANGE_ME"
```
With:
```json
"Authorization": "Bearer ${FORGEOS_ADMIN_TOKEN}"
```

### 2. `.env.example` (new file)
Created with:
```
FORGEOS_ADMIN_TOKEN=forgeos_admin_CHANGE_ME
```

## Acceptance Criteria Verification
- [x] `.vscode/mcp.json` uses env variable reference instead of hardcoded token
- [x] `.env.example` documents the required env var
- [x] No plaintext admin tokens remain in workspace files (only in docs/tests referencing the default value)

## Notes
- The `.env` files in `infra/` and `forgeos-server/` already exist with actual tokens — they are gitignored
- Documentation files referencing `forgeos_admin_CHANGE_ME` are informational (explaining the default)
- Test files using the default value are testing the config fallback behavior

---

## Follow-up Work (2026-05-26)

### Objective (TICKET COMPLETION)
Document the complete setup flow and add credential generation to setup.sh.

### Additional Files Modified

| File | Change |
|------|--------|
| `README.md` | Added **VS Code MCP Setup (Safe)** section — 5-step flow: `make setup` → token generation → server start → VS Code config → verification |
| `forgeos-server/README.md` | Rewrote VS Code Setup section with secure env-var pattern, security notes, and verification step |
| `infra/scripts/setup.sh` | Added Credential Generation block — creates `.env`, replaces placeholder with `openssl rand -hex 32` (python3 fallback), updates next-steps banner |
| `.github/memory-bank/activeContext.md` | Added memory gate entry for TASK-COP-MCP002 |

### How setup.sh Generates Credentials
1. Checks if `${REPO_ROOT}/.env` exists; if not, copies `.env.example` or creates minimal `.env`
2. Greps for `FORGEOS_ADMIN_TOKEN=forgeos_admin_CHANGE_ME` — the default placeholder
3. If found, runs `openssl rand -hex 32` (primary) or `python3 -c "import secrets; print(secrets.token_hex(32))"` (fallback)
4. Uses `sed -i` (GNU/Linux) or `sed -i ''` (macOS) to replace the placeholder inline
5. If neither openssl nor python3 is available, keeps the placeholder with a warning

### Commit
`139752ac` — `[TASK-COP-MCP002] WORK by Backend on ticketer-local (reaperoak)`

### Confidence
HIGH — documentation and config changes; no runtime tests applicable.
