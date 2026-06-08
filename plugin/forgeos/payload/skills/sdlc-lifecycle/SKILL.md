---
name: sdlc-lifecycle
description: Stage-based pipeline, Definition of Done, rework rules. Quick reference for the 14-stage SDLC process.
user-invocable: false
metadata:
  version: '1.0.0'
  author: 'Vibecoding'
---

## Overview

Stage-based pipeline, Definition of Done, rework rules. Quick reference for the 14-stage SDLC process.


# SDLC Lifecycle Quick Reference

## Pipeline
```
READY > RESEARCH > PM > ARCHITECT > DevOps > BACKEND > UIDesigner > FRONTEND > QA > SECURITY > CI > DOCS > VALIDATION > DONE
```

## Definition of Done (11 Items)
1. Code implemented (all acceptance criteria)
2. Tests written (≥80% coverage)
3. Lint passes (zero errors/warnings)
4. Type checks pass
5. CI passes
6. Docs updated
7. Reviewed by Validator
8. No console errors
9. No unhandled promises
10. No TODO comments
11. UI designs exist (if applicable)

## Rework
- Max 3 rework attempts per ticket
- After 3 → ESCALATED to human

## References
- [sdlc.instructions.md](../../instructions/sdlc.instructions.md)

## Rules

- Follow the conventions defined in this skill
- Apply these patterns consistently across all relevant code
