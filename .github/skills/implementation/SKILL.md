---
name: 'implementation'
description: 'Implementation phase best practices including TDD, SOLID principles, clean code, and production-grade software construction guidelines.'
metadata:
  version: '2.0.0'
  author: 'Vibecoding'
  tags: ['implementation', 'tdd', 'solid', 'clean-code', 'best-practices']
  source: 'chunks/10._Implementation_Phase_Best_Practices_Guide'
  last-updated: '2026-04-10'
  last_reviewed: '2026-04-10'
---

## Overview

Implementation phase best practices including TDD workflow, SOLID principles,
error handling patterns, and production-grade TypeScript construction guidelines.

---

# Implementation Best Practices

## When to Use

- Writing new feature code in Backend or Frontend stages
- Refactoring existing code for clarity or performance
- Applying SOLID principles to class/module design
- Implementing error handling and logging

---

## 1. Procedure: TDD Red-Green-Refactor

Execute this cycle for every new function or method:

```
┌─────────────────────────────────────────┐
│  RED: Write a failing test              │
│  └─ Describe expected behavior          │
│  └─ Run: npx jest --watch              │
│  └─ Verify: test FAILS (red)           │
├─────────────────────────────────────────┤
│  GREEN: Write minimum code to pass      │
│  └─ No extra logic beyond test needs    │
│  └─ Run: npx jest --watch              │
│  └─ Verify: test PASSES (green)        │
├─────────────────────────────────────────┤
│  REFACTOR: Clean up while green         │
│  └─ Extract, rename, simplify           │
│  └─ Run: npx jest --coverage           │
│  └─ Verify: all tests still green       │
└─────────────────────────────────────────┘
```

### Example: TDD for a Service Method

```typescript
// Step 1 — RED: Write failing test
// src/services/orderService.test.ts
import { OrderService } from './orderService';

describe('OrderService.calculateTotal', () => {
  it('should sum line items with tax', () => {
    const service = new OrderService();
    const total = service.calculateTotal([
      { price: 10, quantity: 2 },
      { price: 5, quantity: 1 },
    ], 0.1);
    expect(total).toBe(27.5); // (20 + 5) * 1.1
  });
});

// Step 2 — GREEN: Minimum implementation
// src/services/orderService.ts
export class OrderService {
  calculateTotal(
    items: Array<{ price: number; quantity: number }>,
    taxRate: number,
  ): number {
    const subtotal = items.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0,
    );
    return subtotal * (1 + taxRate);
  }
}

// Step 3 — REFACTOR: Extract if needed (in this case, already clean)
```

---

## 2. SOLID Principles — Decision Guide

| Principle | Question to Ask | If YES |
|-----------|----------------|--------|
| **S**ingle Responsibility | Does this class have >1 reason to change? | Split into separate classes |
| **O**pen/Closed | Do I modify existing code to add a feature? | Use strategy pattern or polymorphism |
| **L**iskov Substitution | Does a subclass break parent behavior? | Fix the subclass contract |
| **I**nterface Segregation | Does a consumer use <50% of an interface? | Split into smaller interfaces |
| **D**ependency Inversion | Does high-level code import low-level modules? | Inject via constructor interface |

### Example: Dependency Injection

```typescript
// BAD — hard dependency
class UserService {
  private repo = new MongoUserRepo(); // tightly coupled
}

// GOOD — inject via constructor
interface UserRepository {
  findById(id: string): Promise<User | null>;
  save(user: User): Promise<void>;
}

class UserService {
  constructor(private readonly repo: UserRepository) {}

  async getUser(id: string): Promise<User> {
    const user = await this.repo.findById(id);
    if (!user) throw new UserNotFoundError(id);
    return user;
  }
}
```

---

## 3. Procedure: Error Handling

```
Step 1 — Define domain error classes (extend a base DomainError)
Step 2 — Throw domain errors in service/domain layer
Step 3 — Catch and translate in controller/route layer
Step 4 — Log with structured logger (never console.log)
Step 5 — Return appropriate HTTP status + generic message to client
```

### Example: Typed Domain Errors

```typescript
// src/errors/domain.ts
export abstract class DomainError extends Error {
  abstract readonly statusCode: number;
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class NotFoundError extends DomainError {
  readonly statusCode = 404;
  constructor(entity: string, id: string) {
    super(`${entity} with id ${id} not found`);
  }
}

export class ValidationError extends DomainError {
  readonly statusCode = 400;
}

// In error middleware:
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  if (err instanceof DomainError) {
    logger.warn({ err, path: req.path });
    return res.status(err.statusCode).json({ error: err.message });
  }
  logger.error({ err, path: req.path });
  return res.status(500).json({ error: 'Internal server error' });
});
```

---

## 4. Code Quality Checklist

Run before every commit:

| Check | Command | Pass Criterion |
|-------|---------|----------------|
| Type check | `npx tsc --noEmit` | Zero errors |
| Lint | `npx eslint .` | Zero errors, zero warnings |
| Format | `npx prettier --check .` | All files formatted |
| Tests | `npx jest --coverage` | All pass, ≥80% coverage |
| No `any` | `grep -r ': any' src/` | Zero matches |

---

## 5. Naming Conventions

| Construct | Convention | Example |
|-----------|-----------|---------|
| Class | PascalCase | `OrderService` |
| Interface | PascalCase (no `I` prefix) | `UserRepository` |
| Function | camelCase | `calculateTotal` |
| Constant | UPPER_SNAKE | `MAX_RETRY_COUNT` |
| File | camelCase matching export | `orderService.ts` |
| Test file | `*.test.ts` | `orderService.test.ts` |

---

## 6. Anti-Patterns

- Using `any` type — always use explicit types
- `console.log` — use structured logger with JSON output
- Swallowing errors with empty catch blocks
- God classes with >300 lines
- Functions with >5 parameters (use an options object)
- Mutable global state
- Business logic in route handlers (extract to service layer)

---

## Resources

See the `references/` directory for:
- TDD workflow guide (chunk-01 through chunk-03)
- SOLID principles reference
- Clean code checklist

## Rules

- Follow the conventions defined in this skill
- Apply these patterns consistently across all relevant code
