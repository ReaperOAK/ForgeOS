---
name: ticket-system
description: File-based ticket state machine. Quick reference for ticket operations, stage directories, and tickets.py commands.
user-invocable: false
metadata:
  version: '1.0.0'
  author: 'Vibecoding'
---

## Overview

File-based ticket state machine. Quick reference for ticket operations, stage directories, and tickets.py commands.


# Ticket System Quick Reference

## State = Directory
Ticket state determined by directory under `ticket-state/`:
READY → ARCHITECT/RESEARCH/BACKEND/... → QA → SECURITY → CI → DOCS → VALIDATION → DONE

## tickets.py Commands
| Command | Purpose |
|---------|---------|
| `--sync` | Resolve deps, move unblocked to READY |
| `--status` | Dashboard view |
| `--claim <id> <agent> <machine> <operator>` | Claim ticket |
| `--advance <id> <agent>` | Move to next stage |
| `--rework <id> <agent> <reason>` | Send back for rework |

## References
- [ticket-system.instructions.md](../../instructions/ticket-system.instructions.md)

## Rules

- Follow the conventions defined in this skill
- Apply these patterns consistently across all relevant code
