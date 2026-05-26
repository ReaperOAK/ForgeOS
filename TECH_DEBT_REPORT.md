# Technical Debt Report

Date: 2026-04-14
Scope: MCP/Copilot orchestration debt blocking reliable operator experience

## High-Value Debt Items

| Severity | Debt | Why It Matters | Evidence |
|----------|------|----------------|----------|
| Critical | Dual control planes | Operators can follow the wrong system and still think they are “using ForgeOS” | `README.md`, `.github/instructions/ticket-system.instructions.md`, `docs/operations/mcp-cutover-guide.md` |
| Critical | Checked-in dev admin bearer | The workspace MCP path is insecure and brittle by default | `.vscode/mcp.json` |
| Critical | Mutation identity drift | MCP cannot be made mandatory safely while caller identity is ambiguous | `forgeos-server/src/tools/tickets-claim.ts` |
| High | Prompt pack drift | Copilot’s strongest operational hints still point to `tickets.py` | `.github/prompts/*.prompt.md` |
| High | Tool inventory drift | Docs and code disagree on what the MCP server exposes | `forgeos-server/README.md`, `forgeos-server/src/tools/index.ts` |
| High | Filesystem summary dependency | `tickets.payload` is not fully server-owned | `forgeos-server/src/tools/tickets-payload.ts` |
| High | Fallback path still active | Operators can fall back to legacy state without realizing it | SDK/client layers and hooks |
| Medium | Dispatch-owner ambiguity | The server is not obviously the only orchestrator | `docs/operations/mcp-cutover-guide.md`, runtime startup path |
| Medium | Legacy cutover docs hidden | Correct guidance exists but is not the default operator path | `docs/operations/mcp-cutover-guide.md` |

## Debt Buckets

### 1. Operational debt

- Repo root instructions and prompts still normalize legacy CLI behavior.
- The workspace gives operators both an MCP path and a filesystem path.

### 2. Security debt

- Hardcoded workspace bearer token.
- Ticket mutation actor identity not reliably derived from authentication.

### 3. Documentation debt

- Inconsistent tool counts and names.
- Migration/cutover docs are more accurate than onboarding docs, but less visible.

### 4. Architecture debt

- Payload still reaches into repo artifacts.
- Control-plane responsibilities are not cleanly separated.

## Debt Payoff Strategy

### Fast payoff

- Rewrite prompts, hooks, and core instructions
- Generate safe VS Code MCP config
- Add CI grep gate for operational legacy references

### Medium payoff

- Align SDK contracts with actual tool registration
- Generate README tool tables from `forgeos-server/src/tools/index.ts`
- Add a dedicated MCP doctor/smoke check

### Longer payoff

- Move upstream summary persistence into the server
- Retire `tickets.py` from daily operations
- Simplify orchestration ownership to one dispatch path

## Recommendation

Do not spend time on broad refactors until the control-plane debt is retired.

The highest leverage work is the work that makes Copilot unable to take the wrong path.

## Evidence

- `README.md`
- `.github/prompts/start.prompt.md`
- `.github/prompts/continue.prompt.md`
- `.github/prompts/takeover.prompt.md`
- `.vscode/mcp.json`
- `forgeos-server/README.md`
- `forgeos-server/src/tools/index.ts`
- `forgeos-server/src/tools/tickets-claim.ts`
- `forgeos-server/src/tools/tickets-payload.ts`