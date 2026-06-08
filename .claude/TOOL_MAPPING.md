# Tool Loadout Mapping — Copilot MCP → Claude Code

The agent definitions in `.github/agents/*.agent.md` declare an **Assigned Tool
Loadout** using GitHub Copilot / VS Code MCP namespaces (e.g. `oraios/serena/*`,
`memory/*`). Those exact tool names do **not** exist in Claude Code. This table
is the canonical translation every Claude subagent uses to honour its loadout.

The principle from `AGENTS.md` still holds: **use only the tools your loadout
maps to.** Do not browse the full tool list; do not invent tool names.

## Universal tools (every agent)

| Copilot / MCP namespace            | Claude Code equivalent                                   |
|------------------------------------|----------------------------------------------------------|
| `memory/*` (knowledge graph)       | File-based memory bank at `.github/memory-bank/` via Read/Write/Edit |
| `oraios/serena/*` (LSP nav + edit) | `Read`, `Grep`, `Glob` to navigate; `Edit` for surgical edits |
| `execute/*`, `vscode/*` (terminal) | `Bash`                                                   |
| `tavily/*` (web search)            | `WebSearch`, `WebFetch`                                  |
| `github/*` (VCS / PRs / issues)    | `Bash` with the `gh` CLI and `git`                       |
| `sequentialthinking/*`             | Think step-by-step before acting (native reasoning)      |
| `read`, `edit`, `search`, `web`    | `Read` / `Edit`,`Write` / `Grep`,`Glob` / `WebFetch`,`WebSearch` |
| `todo`                             | `TodoWrite`                                              |
| `agent`, `runSubagent`             | `Task` tool (`subagent_type` = the lowercase agent name) |

## Role-specific tools

These map to optional MCP servers. If the server is configured in a project or
user `.mcp.json`, use it directly (Claude exposes MCP tools as `mcp__<server>__<tool>`,
discoverable via ToolSearch). If it is **not** configured, fall back to the
listed alternative and note the substitution in your evidence/summary.

| Copilot namespace                         | If MCP configured            | Fallback                                    |
|-------------------------------------------|------------------------------|---------------------------------------------|
| `mongodb/*`                               | mongodb MCP                  | `Bash` (`mongosh`, migration scripts)       |
| `microsoft-docs/*`, `io.github.upstash/context7/*` | docs MCP            | `WebSearch` / `WebFetch`                     |
| `com.figma.mcp/*`                         | figma MCP                    | `WebFetch` on shared Figma links            |
| `stitch/*`                                | stitch MCP                   | describe specs in markdown; `WebFetch`      |
| `playwright/*`, `browser/*`               | playwright MCP               | `Bash` (`npx playwright test`)              |
| `firecrawl/*`                             | firecrawl MCP                | `WebFetch` / `WebSearch`                     |
| `terraform/*`                             | terraform MCP                | `Bash` (`terraform plan/validate`)          |
| `sentry/*`                                | sentry MCP                   | `WebFetch` on Sentry API / dashboard        |
| `markitdown/*`                            | markitdown MCP               | `Bash` / `Read`                              |
| `renderMermaidDiagram`                    | —                            | write Mermaid fenced blocks into markdown   |

## Notes

- **Serena's symbol-level edits** have no direct Claude equivalent — use `Grep`/`Glob`
  to locate symbols, then `Edit` with a unique surrounding-context string. For large
  files, read only the relevant range (`Read` with `offset`/`limit`).
- **Scoped git is non-negotiable:** stage explicit files only. `git add .` / `-A` /
  `--all` are blocked by a PreToolUse hook and a `deny` permission rule.
- To wire up the optional MCP servers, add an `.mcp.json` at the repo root (or use
  `claude mcp add`). See `.claude/README.md`.
