---
name: 'ai-safety'
description: 'AI prompt engineering and safety best practices including guardrails, injection prevention, output validation, and responsible AI usage guidelines.'
metadata:
  version: '1.0.0'
  author: 'Vibecoding'
  tags: ['ai-safety', 'prompt-engineering', 'guardrails', 'security']
  source: 'chunks/ai-prompt-engineering-safety-best-practices.instructions'
  last-updated: '2026-02-26'
---

## Overview

AI prompt engineering and safety best practices including guardrails, injection prevention, output validation, and responsible AI usage guidelines.


# AI Safety & Prompt Engineering

## When to Use
- Designing prompts for AI agents
- Implementing guardrails for AI systems
- Validating AI output for safety
- Preventing prompt injection attacks

## Key Principles
1. **Input Validation** — Sanitize all user inputs before passing to AI
2. **Output Filtering** — Validate AI responses against safety policies
3. **Least Privilege** — Grant AI agents only necessary permissions
4. **Human Oversight** — Require human approval for critical operations

## Resources
See the `references/` directory for:
- Prompt engineering guidelines
- Safety guardrail patterns
- Injection prevention techniques

## Rules

- Follow the conventions defined in this skill
- Apply these patterns consistently across all relevant code
