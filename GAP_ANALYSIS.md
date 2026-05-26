# Gap Analysis

Date: 2026-04-14
Scope: ForgeOS MCP effectiveness and VS Code GitHub Copilot adoption

## Summary

The primary gap is not missing MCP capability. It is missing MCP authority.

ForgeOS MCP already exposes enough functionality to be the main Copilot control plane, but the repository still trains operators and agents to treat the legacy filesystem flow as normal.

## Gaps By Area

| Area | Desired State | Current State | Impact | Existing Backlog | New Work Needed |
|------|---------------|---------------|--------|------------------|-----------------|
| Operator prompts | MCP-only instructions | `/start`, `/continue`, `/takeover`, `/stop` still call `tickets.py` | Copilot bypasses ForgeOS MCP | Partial cutover tickets exist | Yes |
| Core instructions | `tickets.payload` and `tickets.*` are canonical | Filesystem ticket state and summaries still treated as truth | Split-brain boot sequence | Yes (`TASK-INT-BE005`, `TASK-INT-BE010`) | Yes |
| VS Code setup | Safe, generated, verifiable MCP config | Checked-in config with dev bearer | Fragile and insecure onboarding | No clear ticket found | Yes |
| Identity model | Authenticated principal drives mutations | Callers can influence agent identity | Unsafe to mandate MCP | Related security risk exists | Yes |
| Tool documentation | README generated from registered tools | Documented tool names drift from code | MCP appears unreliable | No clear ticket found | Yes |
| Client/SDK contract | SDK matches current tool names | Legacy names like `tickets.status` and heartbeat-style wrappers still exist | Client confusion and fallback | No clear ticket found | Yes |
| Context delivery | Server-owned payload and summaries | `tickets.payload` still reads filesystem summaries | Partial cutover | Yes (`TASK-INT-BE013`) | Yes |
| Dispatch ownership | One dispatch owner | Server tools exist, legacy dispatch model remains | No enforceable control plane | No decisive ticket found | Yes |
| CI enforcement | Legacy path regressions blocked | No hard gate against reintroducing `tickets.py` operator flow | Backslide likely | No clear ticket found | Yes |

## Existing Backlog Worth Reusing

The repository already contains useful cutover tickets and they should be reused instead of duplicated where possible.

- `.github/ticket-state/READY/TASK-INT-BE005.json`
  - Rewrites `agent-behavior.instructions.md` toward MCP payload context.
- `.github/tickets/TASK-INT-BE010.json`
  - Updates `agents.md` toward MCP-only architecture.
- `.github/tickets/TASK-INT-BE012.json`
  - Implements `tickets.list` as a replacement for directory scans.
- `.github/tickets/TASK-INT-BE013.json`
  - Implements `tickets.payload` as the canonical context delivery mechanism.

These help, but they do not cover the whole VS Code/Copilot operator experience.

## Missing Workstreams

### Workstream 1: MCP-first Copilot operator surface

Missing:

- Rewrite prompt packs to use MCP tools only
- Rewrite hook behavior away from `tickets.py --sync`
- Add a root quick start for Copilot operators

### Workstream 2: MCP trust and identity hardening

Missing:

- Bind mutation handlers to authenticated principal
- Remove caller-supplied agent spoofing paths
- Replace checked-in admin bearer with generated or prompted config

### Workstream 3: Contract and discoverability

Missing:

- Generate docs from tool registry
- Align SDKs with current tool names
- Add `mcp-doctor` or equivalent verification path

### Workstream 4: Complete the cutover

Missing:

- Decide where dispatch actually lives
- Remove default filesystem fallbacks
- Move upstream summary storage into the control plane
- Gate future drift in CI

## Recommendation

Treat the next phase as stabilization, not feature delivery.

### Execute first

1. Instruction and prompt rewrite
2. Auth and identity hardening
3. VS Code config generation and doctor flow
4. Contract alignment and CI guardrails

### Execute after that

1. Payload artifact ownership refactor
2. Dispatch-owner simplification
3. Legacy archive/deprecation

## Evidence

- `.github/prompts/start.prompt.md`
- `.github/prompts/continue.prompt.md`
- `.github/prompts/takeover.prompt.md`
- `.github/prompts/stop.prompt.md`
- `.github/instructions/core.instructions.md`
- `.github/instructions/agent-behavior.instructions.md`
- `.vscode/mcp.json`
- `forgeos-server/src/tools/index.ts`
- `forgeos-server/README.md`
- `.github/ticket-state/READY/TASK-INT-BE005.json`
- `.github/tickets/TASK-INT-BE010.json`