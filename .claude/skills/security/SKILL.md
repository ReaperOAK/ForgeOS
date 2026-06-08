---
name: 'security'
description: 'Security best practices including STRIDE threat modeling, OWASP Top 10, agentic guardrails, and vulnerability assessment guidelines.'
metadata:
  version: '1.0.0'
  author: 'Vibecoding'
  tags: ['security', 'owasp', 'stride', 'guardrails', 'vulnerability']
  source: 'chunks/Security.agent, chunks/security.agentic-guardrails'
  last-updated: '2026-02-26'
---

## Overview

Security best practices including STRIDE threat modeling, OWASP Top 10, agentic guardrails, and vulnerability assessment guidelines.


# Securitying

## When to Use
- Performing security reviews on code
- Conducting STRIDE threat analysis
- Scanning for OWASP Top 10 vulnerabilities
- Implementing agentic security guardrails

## Key Practices
1. **STRIDE Analysis** — Spoofing, Tampering, Repudiation, Information Disclosure, Denial of Service, Elevation of Privilege
2. **OWASP Top 10** — Injection, Broken Auth, Sensitive Data, XXE, Broken Access, Security Misconfiguration, XSS, Insecure Deserialization, Vulnerable Components, Insufficient Logging
3. **Secrets Management** — Never hardcode, use environment variables or secret managers
4. **Input Validation** — Sanitize all user inputs, validate against schemas

## Resources
See the `references/` directory for:
- STRIDE threat modeling guide
- OWASP Top 10 reference
- Agentic guardrails checklist

## Rules

- Follow the conventions defined in this skill
- Apply these patterns consistently across all relevant code
