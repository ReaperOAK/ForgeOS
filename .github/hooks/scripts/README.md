# Hook Scripts

This directory contains shell scripts invoked by VS Code agent lifecycle hooks defined in `../*.json`.

## Architecture

```
.github/hooks/
├── policy-enforcement.json    # Hook definitions (SessionStart, PreToolUse, Stop, SubagentStop)
├── auto-sync.json             # Auto-sync ticket state on SessionStart
└── scripts/
    ├── README.md              # This file
    ├── check-guardian-stop.sh  # STOP_ALL circuit breaker check
    ├── block-git-add-all.sh   # Block `git add .` / `-A` / `--all`
    ├── block-destructive-ops.sh # Block rm -rf, DROP TABLE, git reset --hard, etc.
    ├── verify-evidence.sh     # Verify agent output contains required evidence
    ├── verify-memory-gate.sh  # Verify activeContext.md entry before completion
    └── auto-sync-tickets.sh   # Run tickets.py --sync on session start
```

## Hook Lifecycle Events

| Event | When It Fires | Purpose |
|-------|---------------|---------|
| `SessionStart` | Agent session begins | Check guardian, sync tickets |
| `PreToolUse` | Before any tool call | Block prohibited commands |
| `PostToolUse` | After any tool call | Lint checks, validation |
| `SubagentStart` | Before subagent launch | Validate claim protocol |
| `SubagentStop` | After subagent completes | Memory gate enforcement |
| `Stop` | Agent session ends | Evidence rule verification |

## Status

All hooks are **enabled** (`"enabled": true`) as of TASK-VIB-002. The governance hooks enforce guardian STOP checks, git policy, destructive operation blocking, evidence verification, and memory gate checks at runtime.

## Adding New Hooks

1. Create a new shell script in this directory
2. Add a hook entry in `../policy-enforcement.json` under the appropriate lifecycle event
3. Test the hook manually, then set `"enabled": true`

## Script Contract

Each script must:
- Exit `0` on success (allow the action)
- Exit non-zero on policy violation (block the action)
- Write violation details to stderr for agent context
