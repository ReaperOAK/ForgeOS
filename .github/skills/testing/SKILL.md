---
name: 'testing'
description: 'Testing best practices including unit testing, integration testing, E2E testing with Playwright, and test writing guidelines for TypeScript.'
metadata:
  version: '1.0.0'
  author: 'Vibecoding'
  tags: ['testing', 'playwright', 'unit-test', 'integration', 'e2e']
  source: 'chunks/11._QA_Best_Practices_and_Strategy_Guide, chunks/QA.agent'
  last-updated: '2026-02-26'
---

## Overview

Testing best practices including unit testing, integration testing, E2E testing with Playwright, and test writing guidelines for TypeScript.


# Testing Best Practices

## When to Use
- Writing unit tests for new code
- Creating integration tests for APIs
- Setting up E2E tests with Playwright
- Following TDD red-green-refactor cycle

## Test Types
1. **Unit Tests** — Test individual functions/methods in isolation
2. **Integration Tests** — Test component interactions and API endpoints
3. **E2E Tests** — Test complete user flows with Playwright
4. **Mutation Tests** — Verify test quality by introducing mutations

## Key Practices
- Arrange-Act-Assert pattern
- Test edge cases and error scenarios
- Mock external dependencies
- Descriptive test names: `should [expected behavior] when [condition]`

## Resources
See the `../qa/references/` directory for:
- QA Best Practices and Strategy Guide (chunks 1-4)
- QA Agent reference (chunks 1-2)
- Playwright testing guide
- Test writing guidelines

## Rules

- Follow the conventions defined in this skill
- Apply these patterns consistently across all relevant code
