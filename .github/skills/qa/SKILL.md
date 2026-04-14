---
name: 'qa'
description: 'Quality assurance best practices including test coverage, mutation testing, E2E testing, and comprehensive QA strategy guidelines.'
metadata:
  version: '2.0.0'
  author: 'Vibecoding'
  tags: ['qa', 'testing', 'coverage', 'mutation-testing', 'e2e', 'playwright', 'unit-test']
  source: 'chunks/11._QA_Best_Practices_and_Strategy_Guide, chunks/QA.agent'
  last-updated: '2026-04-10'
  last_reviewed: '2026-04-10'
---

## Overview

Quality assurance and testing best practices covering the full test pyramid — unit,
integration, E2E, and mutation testing. Includes procedures for writing tests,
achieving coverage targets, and validating user flows with Playwright.

---

# Quality Assurance & Testing

## When to Use

- Writing unit, integration, or E2E tests for new or changed code
- Achieving test coverage targets (≥80% for new code)
- Implementing E2E test suites with Playwright
- Performing mutation testing to verify test quality
- Following TDD red-green-refactor cycle

---

## 1. Test Pyramid

| Layer | Proportion | Tool | Scope |
|-------|-----------|------|-------|
| Unit | 70% | Jest | Single function/method in isolation |
| Integration | 20% | Jest + supertest | Component interactions, API endpoints |
| E2E | 10% | Playwright | Complete user flows in real browser |

---

## 2. Procedure: Write a Unit Test (TDD)

Follow red-green-refactor for every new function:

```
Step 1 — RED: Write a failing test
   └─ Name: should [expected behavior] when [condition]
   └─ Arrange: set up inputs and mocks
   └─ Act: call the function under test
   └─ Assert: verify the expected outcome

Step 2 — GREEN: Write minimum code to pass
   └─ No extra logic beyond what the test demands
   └─ Run: npx jest --testPathPattern=<file> --watch

Step 3 — REFACTOR: Clean up while tests stay green
   └─ Extract helpers, rename variables, remove duplication
   └─ Run full suite: npx jest --coverage
```

### Example: Unit Test (TypeScript + Jest)

```typescript
// src/utils/calculateDiscount.test.ts
import { calculateDiscount } from './calculateDiscount';

describe('calculateDiscount', () => {
  it('should return 0 when price is 0', () => {
    expect(calculateDiscount(0, 10)).toBe(0);
  });

  it('should apply percentage discount correctly', () => {
    expect(calculateDiscount(100, 25)).toBe(75);
  });

  it('should throw when discount exceeds 100%', () => {
    expect(() => calculateDiscount(100, 150)).toThrow('Invalid discount');
  });

  it('should handle fractional amounts', () => {
    expect(calculateDiscount(99.99, 10)).toBeCloseTo(89.991);
  });
});
```

---

## 3. Procedure: Write an Integration Test

```
Step 1 — Set up test database/service (use testcontainers or in-memory)
Step 2 — Seed known test data
Step 3 — Call the real endpoint/service method
Step 4 — Assert response status, body shape, and side effects
Step 5 — Clean up test data (use afterEach/afterAll)
```

### Example: API Integration Test

```typescript
// src/routes/users.integration.test.ts
import request from 'supertest';
import { createApp } from '../app';

describe('POST /api/users', () => {
  const app = createApp();

  it('should create a user and return 201', async () => {
    const res = await request(app)
      .post('/api/users')
      .send({ name: 'Alice', email: 'alice@example.com' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      id: expect.any(String),
      name: 'Alice',
      email: 'alice@example.com',
    });
  });

  it('should return 400 for missing email', async () => {
    const res = await request(app)
      .post('/api/users')
      .send({ name: 'Bob' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('email');
  });
});
```

---

## 4. Procedure: Write an E2E Test (Playwright)

```
Step 1 — Identify the critical user flow to test
Step 2 — Start from a clean state (logout, clear data)
Step 3 — Use role-based locators (getByRole, getByLabel) — never CSS selectors
Step 4 — Assert visible outcomes, not implementation details
Step 5 — Run: npx playwright test --project=chromium
```

### Example: E2E Login Flow

```typescript
// e2e/login.spec.ts
import { test, expect } from '@playwright/test';

test('user can log in and see dashboard', async ({ page }) => {
  await page.goto('/login');

  await page.getByLabel('Email').fill('alice@example.com');
  await page.getByLabel('Password').fill('securePass123');
  await page.getByRole('button', { name: 'Sign In' }).click();

  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByText('Welcome, Alice')).toBeVisible();
});
```

---

## 5. Coverage Requirements

| Metric | Target | Tool |
|--------|--------|------|
| Line coverage | ≥80% new code | `jest --coverage` |
| Branch coverage | ≥75% new code | `jest --coverage` |
| Mutation score | ≥60% | Stryker (`npx stryker run`) |

### Decision Tree: Is Coverage Sufficient?

```
Is line coverage ≥ 80%?
├─ NO → Write more unit tests for uncovered lines
└─ YES → Is branch coverage ≥ 75%?
    ├─ NO → Add tests for untested if/else/switch branches
    └─ YES → Is mutation score ≥ 60%?
        ├─ NO → Strengthen assertions; add edge case tests
        └─ YES → Coverage is sufficient ✓
```

---

## 6. Test Naming Convention

Use the pattern: `should [expected behavior] when [condition]`

| Good | Bad |
|------|-----|
| `should return 404 when user not found` | `test user 404` |
| `should hash password before saving` | `password test` |
| `should emit event when order completes` | `order event works` |

---

## 7. What to Test — Decision Tree

```
Is it a public API (exported function, endpoint, component)?
├─ YES → Unit test required
│   └─ Does it have branching logic?
│       ├─ YES → Test each branch
│       └─ NO → Test happy path + one error case
└─ NO → Is it a critical internal function?
    ├─ YES → Unit test recommended
    └─ NO → Skip (tested via integration)
```

---

## 8. Anti-Patterns to Avoid

- Testing implementation details (private methods, internal state)
- Snapshot tests for dynamic data
- Tests that depend on execution order
- Mocking what you don't own (mock adapters, not libraries)
- Tests with no assertions
- Ignoring flaky tests instead of fixing root cause

---

## Resources

See the `references/` directory for:
- QA strategy guide (chunk-01 through chunk-04)
- Playwright testing patterns
- Mutation testing with Stryker

## Rules

- Follow the conventions defined in this skill
- Apply these patterns consistently across all relevant code
