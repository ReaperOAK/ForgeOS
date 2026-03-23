# TASK-PC-BE-001 - Security Review (SECURITY Stage)

## Findings (Ordered by Severity)
1. No critical or high security findings in scope.
2. Moderate dependency advisory remains outside direct ticket code paths:
   - `GHSA-v8w9-8mx6-g223` (`hono` prototype pollution in `parseBody({ dot: true })`), severity `moderate`, fix available.
   - This ticket does not introduce `hono` request parsing behavior; tracked as non-blocking residual risk.

## Scope Reviewed
- `forgeos-server/src/services/compiler.ts`
- `forgeos-server/src/services/compiler.test.ts`
- `forgeos-server/src/db/migrate.ts`
- `forgeos-server/src/db/migrations/008-prompt-compiler-foundation.sql`
- `forgeos-server/src/types/index.ts`

## Focused Risk Review
- Injection vectors:
  - `compileAndStoreTicketPrompt` uses parameterized SQL placeholders (`$1..$15`) for DB writes.
  - `runMigrationRollback` uses parameterized delete query and validates migration name to basename + `.sql` + migrations-root containment.
  - `codeSearchSymbols` and `memorySearchLessons` calls are parameterized in their handlers (no string SQL interpolation).
- Unsafe parsing/deserialization assumptions:
  - Tool outputs are parsed via `safeJsonObject`; malformed JSON degrades to `{}` rather than throwing.
  - `compiler.test.ts` includes malformed JSON fallback coverage.
  - Residual risk is correctness/observability (silent fallback), not direct RCE/injection.
- Secrets leakage:
  - No hardcoded credentials, private keys, or tokens in reviewed scope.
  - `GEMINI_API_KEY` is read from environment only.
- Unhandled failure paths:
  - Gemini generation failures are caught and fallback provider path is used.
  - Migration apply/rollback wraps transactional operations with rollback-on-error and structured logging.

## STRIDE Threat Model (Scope Components)

### Compiler service (`src/services/compiler.ts`)
Trust boundaries: ticket/memory/code tool responses -> compiler -> model provider -> DB update.
- Spoofing: Low (2x1=2) - internal service invocation only.
- Tampering: Medium-Low (3x2=6) - untrusted tool text is parsed; malformed content falls back safely.
- Repudiation: Low (2x1=2) - structured logging exists for compile success/failure.
- Information Disclosure: Low (2x2=4) - env-based key usage, no key logging observed.
- Denial of Service: Medium-Low (3x2=6) - external model failure handled by fallback path.
- Elevation of Privilege: Low (2x1=2) - no direct privilege mutation pathways.

### Migration runner (`src/db/migrate.ts`, `008-prompt-compiler-foundation.sql`)
Trust boundaries: migration filename input -> filesystem -> SQL execution.
- Spoofing: Low (1x1=1)
- Tampering: Low (2x2=4) - traversal and extension checks prevent path escape.
- Repudiation: Low (2x1=2) - apply/rollback events logged.
- Information Disclosure: Low (1x1=1)
- Denial of Service: Low (2x2=4) - invalid inputs fail fast.
- Elevation of Privilege: Low (2x2=4) - no dynamic SQL from user input.

## OWASP Top 10 / LLM Top 10 Snapshot
- A01 Broken Access Control: No new authz boundary in reviewed scope.
- A02 Cryptographic Failures: SHA-256 hash use is for integrity metadata, acceptable.
- A03 Injection: No direct SQL/code injection paths found.
- A04 Insecure Design: Defensive fallback and migration path validation present.
- A05 Security Misconfiguration: No insecure defaults introduced in scoped files.
- A06 Vulnerable Components: 0 high/critical; 1 moderate (`hono`) advisory.
- A07 Auth Failures: Not applicable in this scope.
- A08 Data Integrity: Migration checksum verification and metadata consistency updates present.
- A09 Logging/Monitoring: Error paths log structured context.
- A10 SSRF: No URL-fetch surface in scoped changes.
- LLM01 Prompt Injection: Prompt text synthesis uses controlled system instruction; input is treated as context data.
- LLM02 Insecure Output Handling: Compiled output stored as data, not executed as code.
- LLM06 Sensitive Info Disclosure: No secret emission paths found in reviewed code.
- LLM08 Excessive Agency: No autonomous destructive action capability added.

## Practical Checks Executed
- `npx vitest run src/services/compiler.test.ts src/__tests__/db/migrate.test.ts`
  - PASS: 22/22 tests.
- `npm audit --audit-level=high --json`
  - PASS gate: 0 high, 0 critical; 1 moderate advisory.
- Scoped secret scan on reviewed files (`rg` high-signal patterns)
  - PASS: no hardcoded secrets or key material.

## Verdict
PASS

## Confidence
HIGH
