# Security Audit Summary

Date: 2026-04-14
Verdict: `NO-GO` for mandatory ForgeOS MCP use in VS Code GitHub Copilot until P0 fixes land

## Executive Summary

ForgeOS MCP can be used in a trusted local development setup, but it is not yet safe to make mandatory as the always-on Copilot control plane.

The main reason is not transport or PostgreSQL. It is identity handling.

The authenticated HTTP principal and the mutation actor used by ticket lifecycle tools are not consistently the same thing.

## Critical Findings

### 1. Caller-supplied identity still influences ticket mutation behavior

- `forgeos-server/src/tools/tickets-claim.ts` accepts `agent_name` as an input and auto-registers unknown agents.
- This creates both spoofing and audit-integrity risk.

### 2. Workspace MCP config ships a development admin bearer

- `.vscode/mcp.json` hardcodes `forgeos_admin_CHANGE_ME`.
- This is acceptable for a local throwaway demo, but not for a repo path that is supposed to become the default Copilot operating mode.

## High Findings

### 3. Mutation handlers are not yet trustworthy enough for enforced MCP-only operation

- Prior audit evidence indicates update/complete paths do not always prove “current authenticated caller owns this action” the way the contract implies.

### 4. Public and semi-public surfaces still expose too much operational context

- Public readiness and event surfaces are useful operationally, but the surrounding API and dashboard exposure model needs a stricter boundary before MCP becomes mandatory.

## Required P0 Security Work

1. Bind every ticket mutation to authenticated request identity
2. Remove runtime auto-registration and wildcard permission minting from mutation handlers
3. Replace the checked-in workspace bearer with generated or prompted local config
4. Add negative tests for impersonation, cross-claim mutation, and accidental admin usage

## Required P1 Security Work

1. Tighten CORS and public endpoint exposure model
2. Separate admin bootstrap from day-to-day Copilot operator credentials
3. Audit all `tickets.*` handlers for actor provenance consistency

## Readiness Decision

### Safe today

- Local development by a single trusted operator who understands the repo’s current risks

### Not safe today

- Declaring ForgeOS MCP mandatory for all Copilot-driven ticket operations
- Shipping the current `.vscode/mcp.json` as the normative team path

## Evidence

- `.vscode/mcp.json`
- `forgeos-server/src/tools/tickets-claim.ts`
- `forgeos-server/src/tools/tickets-complete.ts`
- `forgeos-server/src/tools/tickets-update.ts`
- `forgeos-server/src/tools/tickets-release.ts`
- `forgeos-server/src/middleware/auth.ts`
- `forgeos-server/README.md`
- `.github/memory-bank/riskRegister.md`