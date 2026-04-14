---
name: Agent Definition Rules
applyTo: '.github/agents/**'
description: Meta-rules for writing and modifying agent definition files. Loaded only when agents work on agent definitions.
---

# Agent Definition Rules

## 1. Required Frontmatter Fields

RULE: Every `.agent.md` file must include these YAML frontmatter fields:
- `name`: Agent display name (PascalCase)
- `description`: One-line role description
- `user-invocable`: `true` for user-facing agents, `false` for dispatch-only
- `tools`: Array of tool references available to this agent
- `model`: Preferred LLM model specification
- `argument-hint`: User-facing prompt hint text

## 2. Optional Frontmatter Fields

ALLOWED: `handoffs` — Array of handoff definitions with `label`, `agent`, `prompt`, `send`
ALLOWED: `disable-model-invocation` — Set to `true` for orchestrator agents

## 3. Tool Loadout Structure

RULE: Tools array uses VS Code tool reference format.
RULE: Built-in tools: `vscode`, `execute`, `read`, `agent`, `edit`, `search`, `web`, `browser`, `todo`
RULE: MCP tools use namespace format: `'namespace/tool-name/*'`
RULE: Extension tools use publisher format: `vscode.extension-name/toolName`

## 4. Body Structure

RULE: Agent body follows this section order:
1. Role description and responsibilities
2. Stage ownership
3. Write scope (file paths this agent may modify)
4. Forbidden actions
5. Tool loadout details (if needed beyond frontmatter)
6. References section

## 5. Reference Format

RULE: References section uses Markdown links for auto-inclusion:
```markdown
## References
- [core.instructions.md](../instructions/core.instructions.md)
- [sdlc.instructions.md](../instructions/sdlc.instructions.md)
```
RULE: Links must be relative paths from the agent file location.

## 6. Handoff Format

RULE: Handoffs define agent-to-agent transitions:
```yaml
handoffs:
  - label: 'Human-readable action name'
    agent: 'TargetAgentName'
    prompt: 'Context message for the target agent'
    send: false
```
RULE: `send: false` means handoff must be triggered explicitly, not auto-sent.
