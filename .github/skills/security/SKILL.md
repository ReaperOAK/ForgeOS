---
name: 'security'
description: 'Security best practices including STRIDE threat modeling, OWASP Top 10, agentic guardrails, and vulnerability assessment guidelines.'
metadata:
  version: '2.0.0'
  author: 'Vibecoding'
  tags: ['security', 'owasp', 'stride', 'guardrails', 'vulnerability']
  source: 'chunks/Security.agent, chunks/security.agentic-guardrails'
  last-updated: '2026-04-10'
  last_reviewed: '2026-04-10'
---

## Overview

Security engineering practices for code review, threat modeling, and vulnerability
assessment. Covers STRIDE analysis, OWASP Top 10 mitigation, secrets management,
input validation, and agentic security guardrails.

---

# Security Engineering

## When to Use

- Performing security reviews on new or changed code
- Conducting STRIDE threat analysis for a new component
- Scanning for OWASP Top 10 vulnerabilities
- Implementing agentic security guardrails
- Reviewing dependency supply chain (SBOM)

---

## 1. Procedure: STRIDE Threat Analysis

Run this procedure for every new service, API endpoint, or data flow:

```
Step 1 — IDENTIFY: Draw the data flow diagram (DFD)
   └─ List: actors, processes, data stores, data flows, trust boundaries

Step 2 — CLASSIFY: For each element, check all 6 STRIDE categories:

   S — Spoofing       : Can an attacker impersonate a legitimate user/service?
   T — Tampering       : Can data be modified in transit or at rest?
   R — Repudiation     : Can a user deny performing an action without proof?
   I — Info Disclosure : Can sensitive data leak through logs, errors, or APIs?
   D — Denial of Service : Can the component be overwhelmed or crashed?
   E — Elevation       : Can a user gain unauthorized permissions?

Step 3 — RATE: Assign severity (Critical/High/Medium/Low) using:
   └─ Likelihood × Impact matrix

Step 4 — MITIGATE: For each threat, specify the control:
   └─ Authentication, encryption, rate limiting, input validation, logging, etc.

Step 5 — DOCUMENT: Write findings to docs/security/threat-model-{component}.md
```

### Example: STRIDE for a REST API Endpoint

| Category | Threat | Mitigation |
|----------|--------|------------|
| Spoofing | Forged JWT token | Validate JWT signature + expiry on every request |
| Tampering | Modified request body | Schema validation with Zod; reject unknown fields |
| Repudiation | User denies action | Structured audit log with user ID, timestamp, action |
| Info Disclosure | Stack trace in error | Return generic error; log details server-side only |
| DoS | Unbounded payload | Set `express.json({ limit: '100kb' })` + rate limiter |
| Elevation | Missing role check | Middleware enforces RBAC before handler executes |

---

## 2. OWASP Top 10 Checklist

Use this checklist during every security review:

| # | Risk | Check | Pass? |
|---|------|-------|-------|
| A01 | Broken Access Control | Every endpoint has authz middleware | [ ] |
| A02 | Cryptographic Failures | Secrets in env vars, not code; TLS enforced | [ ] |
| A03 | Injection | Parameterized queries; no string concatenation in SQL | [ ] |
| A04 | Insecure Design | Threat model exists for this component | [ ] |
| A05 | Security Misconfiguration | CORS, CSP, HSTS headers set correctly | [ ] |
| A06 | Vulnerable Components | `npm audit` returns 0 critical/high | [ ] |
| A07 | Auth Failures | Rate limiting on login; MFA available | [ ] |
| A08 | Data Integrity Failures | CI/CD pipeline has integrity checks | [ ] |
| A09 | Logging Failures | Security events logged; no PII in logs | [ ] |
| A10 | SSRF | User-supplied URLs validated against allowlist | [ ] |

---

## 3. Procedure: Input Validation

```
Step 1 — Define schema for every external input (request body, query params, headers)
Step 2 — Validate at system boundary using Zod or Joi
Step 3 — Reject unknown fields (strip or error)
Step 4 — Sanitize strings: trim whitespace, escape HTML if rendering
Step 5 — Log rejected inputs for monitoring (without logging sensitive values)
```

### Example: Zod Validation

```typescript
import { z } from 'zod';

const CreateUserSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  role: z.enum(['user', 'admin']).default('user'),
}).strict(); // reject unknown fields

// In route handler:
const result = CreateUserSchema.safeParse(req.body);
if (!result.success) {
  return res.status(400).json({ error: result.error.issues });
}
const validatedData = result.data;
```

---

## 4. Secrets Management Rules

| Rule | Implementation |
|------|---------------|
| Never hardcode secrets | Use `process.env.SECRET_NAME` |
| Never log secrets | Redact in structured logger |
| Rotate regularly | Automate via CI/CD secret rotation |
| Least privilege | Each service gets only its required secrets |
| Audit access | Log every secret access event |

---

## 5. Decision Tree: Is This Code Secure?

```
Does the code handle user input?
├─ YES → Is input validated against a schema?
│   ├─ NO → ADD VALIDATION (Zod/Joi at boundary)
│   └─ YES → Does it use parameterized queries for DB?
│       ├─ NO → FIX: Use parameterized queries
│       └─ YES → Are error messages generic (no stack traces)?
│           ├─ NO → FIX: Return generic errors to client
│           └─ YES → Does it have authz checks?
│               ├─ NO → ADD RBAC middleware
│               └─ YES → PASS ✓
└─ NO → Does it handle secrets or credentials?
    ├─ YES → Are they from environment variables?
    │   ├─ NO → FIX: Move to env vars
    │   └─ YES → PASS ✓
    └─ NO → PASS ✓ (low risk)
```

---

## 6. Anti-Patterns

- `eval()` or `new Function()` with user input
- String concatenation in SQL queries
- Disabling CORS for convenience (`origin: '*'` in production)
- Logging request bodies that may contain passwords
- Catching errors and returning raw error.message to client
- Hardcoded API keys in source files
- Missing rate limiting on authentication endpoints

---

## Resources

See the `references/` directory for:
- STRIDE threat modeling guide
- OWASP Top 10 reference
- Agentic guardrails checklist

## Rules

- Follow the conventions defined in this skill
- Apply these patterns consistently across all relevant code
