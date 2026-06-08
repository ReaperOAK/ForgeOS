---
name: git-protocol
description: Dispatcher-claim protocol, scoped git rules, commit format, lease mechanism. Quick reference for git-based distributed locking.
user-invocable: false
metadata:
  version: '1.0.0'
  author: 'Vibecoding'
---

## Overview

Dispatcher-claim protocol, scoped git rules, commit format, lease mechanism. Quick reference for git-based distributed locking.


# Git Protocol Quick Reference

## Scoped Git (Non-Negotiable)
- **PROHIBITED**: `git add .`, `git add -A`, `git add --all`
- **REQUIRED**: Explicit file-by-file staging only
- **REQUIRED**: Commit message starts with `[TICKET-ID]`

## Two-Commit Protocol
1. **CLAIM** (Ticketer): `[TICKET-ID] CLAIM by AGENT on MACHINE (OPERATOR)`
2. **WORK** (Subagent): `[TICKET-ID] STAGE complete by AGENT on MACHINE`

## Lease
- Default: 30 minutes
- Expired lease → ticket reclaimable

## References
- [git-protocol.instructions.md](../../instructions/git-protocol.instructions.md)

## Rules

- Follow the conventions defined in this skill
- Apply these patterns consistently across all relevant code
