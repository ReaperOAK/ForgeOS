---
name: 'sdlc'
description: 'Software Development Lifecycle enforcement including stage transitions, Definition of Done validation, rework rules, and lifecycle governance.'
metadata:
  version: '1.0.0'
  author: 'Vibecoding'
  tags: ['sdlc', 'lifecycle', 'governance', 'definition-of-done']
  source: 'chunks/sdlc-enforcement, chunks/Validator.agent'
  last-updated: '2026-02-26'
---

## Overview

Software Development Lifecycle enforcement including stage transitions, Definition of Done validation, rework rules, and lifecycle governance.


# SDLC Enforcement

## When to Use
- Validating ticket stage transitions
- Enforcing Definition of Done (DoD)
- Managing rework cycles
- Governing the SDLC pipeline

## Definition of Done (10 Items)
1. All acceptance criteria implemented
2. Tests written (≥80% coverage for new code)
3. Lint passes (zero errors, zero warnings)
4. Type checks pass
5. CI passes
6. Docs updated (JSDoc/TSDoc, README if applicable)
7. Validator independently reviewed
8. No console errors (structured logger only)
9. No unhandled promises
10. No TODO comments in code

## Rework Rules
- Maximum 3 combined rework attempts per ticket
- After 3 reworks → ESCALATED to human
- Rework re-enters at implementation stage with rejection evidence

## Resources
See the `references/` directory for:
- Stage transition guards
- DoD validation checklist
- Rework handling procedures

## Rules

- Follow the conventions defined in this skill
- Apply these patterns consistently across all relevant code
