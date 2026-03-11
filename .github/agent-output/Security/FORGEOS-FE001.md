# FORGEOS-FE001 — Security Review

**Ticket:** FORGEOS-FE001 — Scaffold Dashboard Web Application
**Agent:** Security Engineer
**Stage:** SECURITY
**Date:** 2026-03-11T10:10:00Z
**Verdict:** PASS (with documented risk acceptance)
**Confidence:** HIGH

---

## Scope

Files reviewed (read-only analysis — zero implementation modifications):

| File | Purpose |
|------|---------|
| `dashboard/package.json` | Dependency manifest |
| `dashboard/tsconfig.json` | TypeScript strict mode config |
| `dashboard/next.config.js` | Next.js configuration |
| `dashboard/tailwind.config.ts` | Tailwind CSS with CSS variable theme |
| `dashboard/src/app/layout.tsx` | Root layout with ThemeProvider + anti-flash inline script |
| `dashboard/src/app/page.tsx` | Dashboard overview — hardcoded metric cards |
| `dashboard/src/app/health/page.tsx` | Health check page — API client calls |
| `dashboard/src/styles/globals.css` | CSS custom properties for dark/light theme |
| `dashboard/src/lib/theme.tsx` | ThemeProvider context + localStorage persistence |
| `dashboard/src/lib/api-client.ts` | REST API client with timeout and health check |
| `dashboard/src/lib/types.ts` | TypeScript type definitions |
| `dashboard/src/components/DashboardShell.tsx` | Shell layout orchestrator |
| `dashboard/src/components/Sidebar.tsx` | Desktop sidebar with nav links |
| `dashboard/src/components/MobileSidebar.tsx` | Mobile modal sidebar |
| `dashboard/src/components/TopBar.tsx` | Top bar with breadcrumbs |
| `dashboard/src/components/Breadcrumb.tsx` | Breadcrumb navigation |
| `dashboard/src/components/MetricCard.tsx` | Metric display card |
| `dashboard/src/components/ThemeToggle.tsx` | Dark/light toggle switch |
| `dashboard/src/components/HealthStatusCard.tsx` | Service health indicator |
| `dashboard/.env` | Default dev environment variables |
| `dashboard/.gitignore` | VCS exclusion rules |

---

## 1. STRIDE Threat Model

### Trust Boundaries

| ID | Boundary | Components |
|----|----------|------------|
| TB-1 | Browser ↔ Next.js Client App | Client-side React rendering, localStorage |
| TB-2 | Next.js App ↔ ForgeOS API | HTTP fetch via `api-client.ts` to `NEXT_PUBLIC_API_URL` |
| TB-3 | Browser LocalStorage ↔ Theme System | Theme preference read/write |

### STRIDE Analysis per Boundary

#### TB-1: Browser ↔ Next.js Client App

| Threat | Score | Analysis |
|--------|-------|----------|
| **Spoofing** | Impact=1 × Likelihood=1 = **1** (LOW) | No authentication system — scaffold is a read-only dashboard shell with hardcoded data. No user identity to spoof. |
| **Tampering** | Impact=1 × Likelihood=2 = **2** (LOW) | Client-side state only (sidebar collapse, theme). No persistent data mutations. Tampering with localStorage affects only local UX. |
| **Repudiation** | Impact=1 × Likelihood=1 = **1** (LOW) | No user actions to repudiate. No logging system. No transactions. |
| **Information Disclosure** | Impact=1 × Likelihood=1 = **1** (LOW) | No sensitive data displayed. Metric values are hardcoded placeholders. No PII. |
| **Denial of Service** | Impact=2 × Likelihood=2 = **4** (LOW) | Client-side only. No server resources to exhaust in the scaffold. |
| **Elevation of Privilege** | Impact=1 × Likelihood=1 = **1** (LOW) | No privilege system. No admin/user roles. All routes are public. |

#### TB-2: Next.js App ↔ ForgeOS API

| Threat | Score | Analysis |
|--------|-------|----------|
| **Spoofing** | Impact=2 × Likelihood=2 = **4** (LOW) | API requests lack authentication headers. Acceptable for health check scaffold — auth is out of scope. |
| **Tampering** | Impact=1 × Likelihood=1 = **1** (LOW) | Read-only API calls (GET only). No write operations exposed. |
| **Repudiation** | Impact=1 × Likelihood=1 = **1** (LOW) | No user-initiated actions requiring audit trail. |
| **Information Disclosure** | Impact=2 × Likelihood=2 = **4** (LOW) | API exposes health status — non-sensitive operational data. Base URL exposed in client bundle (expected for `NEXT_PUBLIC_` vars). |
| **Denial of Service** | Impact=3 × Likelihood=2 = **6** (LOW) | No rate limiting on client-side API calls. "Check All" button could be spammed. Impact limited — targets own backend. |
| **Elevation of Privilege** | Impact=1 × Likelihood=1 = **1** (LOW) | No privileged operations available. |

#### TB-3: Browser LocalStorage ↔ Theme System

| Threat | Score | Analysis |
|--------|-------|----------|
| **Tampering** | Impact=1 × Likelihood=3 = **3** (LOW) | `localStorage.getItem('forgeos-theme')` value used in `setAttribute('data-theme', t)`. If tampered, worst case is broken CSS — `setAttribute` does not execute scripts. `theme.tsx` validates values (`=== 'dark' || === 'light'`), falling back to 'dark'. Inline script in `layout.tsx` does NOT validate — uses raw localStorage value in `setAttribute`. |

**Maximum STRIDE Score:** 6 (LOW). No score reaches Critical (≥20), High (≥15), or Medium (≥10) thresholds.

---

## 2. OWASP Top 10 Compliance

| Category | Status | Analysis |
|----------|--------|----------|
| **A01 — Broken Access Control** | N/A | No authentication or authorization system. All routes are public. Scaffold scope — auth will be added in a future ticket. |
| **A02 — Cryptographic Failures** | N/A | No cryptography used. No sensitive data stored. localStorage stores only theme preference string ('dark'/'light'). |
| **A03 — Injection** | PASS | `dangerouslySetInnerHTML` in `layout.tsx` uses a **hardcoded string literal** — no user input flows into the template. API client constructs URLs via `${this.baseUrl}${path}` where both values originate from code/env, not user input. No SQL, no command execution, no template injection vectors. |
| **A04 — Insecure Design** | PASS | Scaffold follows defense-in-depth patterns: TypeScript strict mode, typed interfaces, React's built-in XSS protection for JSX expressions. No abuse cases applicable at scaffold stage. |
| **A05 — Security Misconfiguration** | INFO | `reactStrictMode: true` correctly enabled. **No security headers configured** in `next.config.js` (CSP, X-Frame-Options, HSTS, X-Content-Type-Options, Referrer-Policy). Acceptable for development scaffold — tracked as SEC-FE001-001 below. |
| **A06 — Vulnerable Components** | INFO | `npm audit` reports 4 high-severity findings (see Dependency Audit section). All are mitigated by configuration or scope. Tracked as SEC-FE001-002. |
| **A07 — Auth Failures** | N/A | No authentication system present in scaffold. |
| **A08 — Data Integrity** | PASS | No deserialization of untrusted data. API responses are typed via TypeScript interfaces. No `eval()`, no dynamic imports from untrusted sources. |
| **A09 — Logging Failures** | PASS | Zero `console.log` calls in production code (verified by QA). No PII logged. No logging infrastructure — appropriate for scaffold. |
| **A10 — SSRF** | N/A | API client runs client-side (browser fetch). `NEXT_PUBLIC_API_URL` is a client-side env var exposed in the browser bundle — cannot be exploited for server-side request forgery. No server-side fetching in this scaffold. |

**OWASP Result:** 10/10 categories reviewed. 0 critical/high findings. 2 informational items tracked.

---

## 3. LLM Top 10

**N/A** — No AI/LLM features present in this scaffold ticket. The dashboard is a static UI shell with hardcoded data and a standard REST API client.

---

## 4. Dependency Audit

### npm audit Results

```
4 high severity vulnerabilities

1. glob 10.2.0-10.4.5 (GHSA-5j98-mcp5-4vw2)
   - Severity: HIGH | CWE-78 (Command Injection)
   - Scope: devDependency only (eslint-config-next → @next/eslint-plugin-next → glob)
   - Exploitability: Requires running glob CLI with -c/--cmd flag. Project does not invoke glob CLI.
   - Production impact: NONE — dev tooling only, never reaches production bundle.
   - Fix: npm audit fix --force (upgrades eslint-config-next to 16.x — breaking change)

2. next 10.0.0-15.5.9 — DoS via Image Optimizer (GHSA-9g9p-9gw9-jx7f)
   - Severity: HIGH | CWE-400 (Resource Exhaustion)
   - Scope: Production dependency
   - Exploitability: Requires `remotePatterns` configuration in next.config.js. NOT CONFIGURED in this scaffold.
   - Production impact: NOT EXPLOITABLE in current configuration.

3. next 10.0.0-15.5.9 — HTTP deserialization DoS (GHSA-h25m-26qc-wcjf)
   - Severity: HIGH | CWE-502 (Deserialization)
   - Scope: Production dependency
   - Exploitability: Requires "insecure React Server Components" usage patterns.
   - Production impact: LIMITED — scaffold uses simple client components. No custom RSC serialization.

4. (Duplicate — eslint-config-next depends on @next/eslint-plugin-next which depends on glob)
```

### SBOM Summary

| Metric | Value |
|--------|-------|
| Direct dependencies | 4 (next, react, react-dom, lucide-react) |
| Direct devDependencies | 16 |
| Total transitive packages | ~1,684 |
| Critical CVEs | 0 |
| High CVEs | 4 (mitigated — see above) |
| Medium CVEs | 0 |
| Low CVEs | 0 |
| License concerns | None (MIT, ISC, Apache-2.0, BSD) |

### Risk Acceptance for Dependency Findings

All 4 HIGH findings are accepted with documented justification:
- **glob CVE (1 finding):** Dev-only dependency, never in production. Command injection requires CLI invocation not present in project.
- **next CVEs (2 findings, counted as 3 with transitive):** Current stable Next.js 14.x is in the affected range. Fix requires breaking upgrade to Next.js 16.x. Neither vulnerability is exploitable in the current scaffold configuration (no `remotePatterns`, no custom RSC serialization).
- **Upgrade path:** Track in risk register for resolution when Next.js 16 is adopted project-wide.

---

## 5. Secret Scanning

| Check | Result |
|-------|--------|
| Hardcoded API keys | NONE found |
| Hardcoded passwords | NONE found |
| Hardcoded tokens | NONE found |
| Private keys | NONE found |
| AWS credentials | NONE found |
| `.env` contents | `NEXT_PUBLIC_API_URL=http://localhost:3000` — public client-side var, non-sensitive |
| `.env` in VCS | YES — `.env` is tracked. Contains only public dev defaults. `.env.local` is gitignored for actual overrides. Acceptable pattern. |

**Secret scan: CLEAN**

---

## 6. Auth/AuthZ Review

N/A — No authentication or authorization system in this scaffold. All routes are public. Auth middleware will be implemented in a future ticket. No protected resources exist.

---

## 7. Input Validation

| Vector | Status | Analysis |
|--------|--------|----------|
| User text input | N/A | No text input fields in scaffold |
| URL parameters | SAFE | `usePathname()` reads browser URL via Next.js router — framework-sanitized |
| API responses | SAFE | Typed via TypeScript interfaces. `response.json()` parsed by browser — no custom deserialization |
| localStorage | SAFE | `theme.tsx` validates: `stored === 'dark' \|\| stored === 'light'`, defaults to 'dark' |
| `dangerouslySetInnerHTML` | LOW RISK | Hardcoded inline script in `layout.tsx`. No user input concatenated. Content is a static IIFE reading localStorage and calling `setAttribute`. See SEC-FE001-003 below. |

---

## 8. Data Classification

| Data Element | Classification | Storage | Encryption |
|--------------|---------------|---------|------------|
| Theme preference | Non-sensitive | Browser localStorage | N/A |
| Metric values | Non-sensitive | Hardcoded in JSX | N/A |
| API base URL | Non-sensitive (public) | `.env` + client bundle | N/A |
| Health status | Non-sensitive (operational) | In-memory (client) | N/A |

No PII. No credentials. No sensitive business data.

---

## 9. API Security

| Control | Status | Analysis |
|---------|--------|----------|
| Authentication | N/A | No auth headers on API calls — health check is public. |
| Rate limiting | NOT PRESENT | Client-side "Check All" can be spammed. Impact: own backend only. |
| CORS | N/A | CORS is a server-side config — not controlled by this frontend scaffold. |
| Request timeout | PRESENT | 10-second `AbortController` timeout in `api-client.ts`. |
| Error handling | PRESENT | Try/catch/finally pattern. Errors surfaced as typed `ApiError` objects. |

---

## 10. SARIF Findings

```json
{
  "$schema": "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json",
  "version": "2.1.0",
  "runs": [
    {
      "tool": {
        "driver": {
          "name": "ForgeOS Security Engineer",
          "version": "1.0.0",
          "rules": [
            {
              "id": "SEC-FE001-001",
              "name": "MissingSecurityHeaders",
              "shortDescription": { "text": "Security headers not configured in next.config.js" },
              "defaultConfiguration": { "level": "warning" },
              "properties": { "cwe": "CWE-693", "owasp": "A05" }
            },
            {
              "id": "SEC-FE001-002",
              "name": "VulnerableDependency",
              "shortDescription": { "text": "npm audit reports HIGH severity CVEs in next and glob" },
              "defaultConfiguration": { "level": "warning" },
              "properties": { "cwe": "CWE-1395", "owasp": "A06" }
            },
            {
              "id": "SEC-FE001-003",
              "name": "DangerouslySetInnerHTML",
              "shortDescription": { "text": "dangerouslySetInnerHTML used in layout.tsx" },
              "defaultConfiguration": { "level": "note" },
              "properties": { "cwe": "CWE-79", "owasp": "A03" }
            },
            {
              "id": "SEC-FE001-004",
              "name": "EnvFileTrackedInVCS",
              "shortDescription": { "text": ".env file committed to version control" },
              "defaultConfiguration": { "level": "note" },
              "properties": { "cwe": "CWE-540" }
            }
          ]
        }
      },
      "results": [
        {
          "ruleId": "SEC-FE001-001",
          "level": "warning",
          "message": { "text": "next.config.js does not configure security headers (Content-Security-Policy, X-Frame-Options, X-Content-Type-Options, Strict-Transport-Security, Referrer-Policy, Permissions-Policy). Recommended: add headers array to next.config.js before production deployment." },
          "locations": [{ "physicalLocation": { "artifactLocation": { "uri": "dashboard/next.config.js" }, "region": { "startLine": 2 } } }],
          "properties": { "severity": "MEDIUM", "stride": "Information Disclosure", "risk_accepted": true, "accept_reason": "Development scaffold — security headers will be added in a dedicated hardening ticket before production." }
        },
        {
          "ruleId": "SEC-FE001-002",
          "level": "warning",
          "message": { "text": "4 HIGH severity npm audit findings: glob CLI command injection (devDependency only, unexploitable), next DoS via Image Optimizer (remotePatterns not configured), next HTTP deserialization DoS (RSC patterns not used). None are exploitable in current configuration." },
          "locations": [{ "physicalLocation": { "artifactLocation": { "uri": "dashboard/package.json" }, "region": { "startLine": 15 } } }],
          "properties": { "severity": "MEDIUM (downgraded from HIGH — mitigated)", "risk_accepted": true, "accept_reason": "Vulnerabilities exist in version range but are not exploitable in current scaffold config. No non-breaking fix available. Track for upgrade to Next.js 16 when adopted." }
        },
        {
          "ruleId": "SEC-FE001-003",
          "level": "note",
          "message": { "text": "dangerouslySetInnerHTML used in layout.tsx for anti-flash theme script. Content is a hardcoded string literal IIFE — no user input. Reads localStorage('forgeos-theme') and calls setAttribute('data-theme', value). setAttribute() does not execute scripts. Inline script does not validate localStorage value (theme.tsx does validate). Accepted pattern for theme anti-flash." },
          "locations": [{ "physicalLocation": { "artifactLocation": { "uri": "dashboard/src/app/layout.tsx" }, "region": { "startLine": 20, "endLine": 23 } } }],
          "properties": { "severity": "LOW", "risk_accepted": true, "accept_reason": "Standard anti-flash pattern. Hardcoded content. setAttribute is not an XSS vector. theme.tsx performs validation for runtime usage." }
        },
        {
          "ruleId": "SEC-FE001-004",
          "level": "note",
          "message": { "text": ".env file is tracked in git. Contains NEXT_PUBLIC_API_URL=http://localhost:3000 — a public client-side variable, non-sensitive. .env.local is properly gitignored for actual overrides/secrets." },
          "locations": [{ "physicalLocation": { "artifactLocation": { "uri": "dashboard/.env" }, "region": { "startLine": 1 } } }],
          "properties": { "severity": "LOW", "risk_accepted": true, "accept_reason": "Content is non-sensitive default dev config. .env.local excluded from VCS for overrides." }
        }
      ]
    }
  ]
}
```

---

## 11. Positive Security Observations

- **TypeScript strict mode** enforced (`strict: true` in tsconfig.json) — prevents type coercion vulnerabilities.
- **React JSX auto-escaping** — all dynamic content rendered via JSX expressions is HTML-escaped by default. No raw HTML rendering except the documented hardcoded inline script.
- **`reactStrictMode: true`** enabled in next.config.js — catches unsafe lifecycle patterns.
- **AbortController timeout** on API requests (10s) — prevents hung connections.
- **No console.log in production code** — no accidental data leakage via browser console.
- **No PII anywhere** — dashboard displays only operational metrics.
- **Theme validation** in `theme.tsx` — stored value checked against explicit literal types before use.
- **Focus management** — MobileSidebar correctly manages focus trap and Escape key dismissal.
- **ARIA accessibility** — comprehensive `aria-label`, `aria-current`, `role` attributes reduce UI spoofing risk.
- **No external script loading** — all code is self-contained, no CDN dependencies.
- **Minimal dependency surface** — only 4 production dependencies (next, react, react-dom, lucide-react).

---

## 12. Recommendations (Non-Blocking)

1. **Add security headers** in `next.config.js` before production:
   ```js
   headers: async () => [{
     source: '/(.*)',
     headers: [
       { key: 'X-Frame-Options', value: 'DENY' },
       { key: 'X-Content-Type-Options', value: 'nosniff' },
       { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
       { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
       { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'" },
     ],
   }]
   ```

2. **Upgrade Next.js** to 16.x when project-wide adoption is planned, resolving npm audit findings.

3. **Add `.env` to `.gitignore`** and rename the committed file to `.env.example` to follow Git best practices for environment files.

4. **Validate localStorage value** in the inline anti-flash script (layout.tsx) to match `theme.tsx` behavior:
   ```js
   if(t!=='dark'&&t!=='light')t='dark';
   ```

5. **Add rate limiting consideration** for health check page's "Check All" button (client-side debounce).

---

## 13. Verdict

### **PASS**

**Justification:**
- Zero critical findings.
- Zero exploitable high findings. All 4 npm audit HIGH items are mitigated:
  - `glob` CVE: devDependency only, CLI flag required, not invoked.
  - `next` CVEs: Configuration prerequisites not met (no `remotePatterns`, no custom RSC serialization).
- 2 MEDIUM findings documented with risk acceptance (missing security headers, dependency versions).
- 2 LOW findings documented (dangerouslySetInnerHTML with hardcoded content, .env in VCS with public data only).
- STRIDE maximum score: 6 (below MEDIUM threshold of 10).
- OWASP Top 10: 10/10 categories reviewed, all clear or N/A.
- Secret scan: CLEAN.
- No PII, no credentials, no sensitive data.

**Risk Accepted Items:**
| ID | Severity | Description | Accept Reason |
|----|----------|-------------|---------------|
| SEC-FE001-001 | MEDIUM | Missing security headers | Dev scaffold — hardening ticket before prod |
| SEC-FE001-002 | MEDIUM (downgraded) | npm audit HIGH CVEs | Not exploitable in current config, no non-breaking fix |
| SEC-FE001-003 | LOW | dangerouslySetInnerHTML | Hardcoded content, no user input, standard pattern |
| SEC-FE001-004 | LOW | .env tracked in VCS | Contains only public non-sensitive defaults |

**Confidence:** HIGH — Full code review of all 20 files, STRIDE on all 3 trust boundaries, OWASP 10/10, dependency audit, secret scan, input validation review.

---

## Evidence

- **STRIDE threat model:** 3 trust boundaries analyzed, max score 6 (LOW)
- **OWASP Top 10:** 10/10 categories reviewed
- **LLM Top 10:** N/A (no AI features)
- **npm audit:** 4 HIGH (mitigated), 0 critical
- **SBOM:** 4 direct + 16 dev dependencies, ~1,684 total transitive
- **Secret scan:** CLEAN
- **SARIF findings:** 4 rules, 4 results (0 error, 2 warning, 2 note)
- **Files reviewed:** 20 source files + 2 config files
