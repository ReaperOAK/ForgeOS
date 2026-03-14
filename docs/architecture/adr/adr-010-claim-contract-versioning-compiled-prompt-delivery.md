---
title: "ADR-010: Versioned Claim Contract for Compiled Prompt Delivery"
ticket: CTO-prompt-compiler-architecture
type: architecture
author: Architect
date: 2026-03-14T00:00:00Z
status: PROPOSED
tags: [architecture, adr, claim-contract, mcp, compatibility]
---

# ADR-010: Versioned Claim Contract for Compiled Prompt Delivery

> **Ticket:** CTO-prompt-compiler-architecture | **Agent:** Architect | **Date:** 2026-03-14  
> **Confidence:** HIGH (88%) | **Status:** PROPOSED

## 1. Status

**PROPOSED** - 2026-03-14

## 2. Context

`tickets.claim` currently returns `compiled_prompt` and alias `system_directive`. Prompt-authoritative execution requires explicit freshness and canonical raw context delivery, but existing clients depend on current fields.

Existing anchors:

- `forgeos-server/src/tools/tickets-claim.ts`
- `forgeos-server/src/types/index.ts`

## 3. Alternatives Evaluated

### 3.1 Replace Contract In-Place (Breaking)

- Pros: clean final shape
- Cons: breaks existing clients and SDK compatibility

### 3.2 Keep Current Fields Only

- Pros: no migration effort
- Cons: cannot communicate freshness or raw payload context contract

### 3.3 Versioned Additive Contract (Chosen)

- Pros: backward compatible, supports gradual adoption, clear deprecation path
- Cons: temporary duplication of fields during migration window

## 4. Decision

Adopt additive versioned claim contract:

- Keep existing fields: `compiled_prompt`, `system_directive`
- Add canonical fields:
  - `raw_payload`
  - `prompt_packet.version`
  - `prompt_packet.compiled_at`
  - `prompt_packet.context_hash`
  - `prompt_packet.freshness_status`
  - `prompt_packet.stale_reason`

Contract rules:

- `system_directive` remains alias to `compiled_prompt` during migration.
- Documentation marks alias as deprecated with planned removal milestone.
- Claim remains atomic for locking; freshness evaluation is part of claim response assembly.

## 5. Consequences

### Positive

- Enables prompt-authoritative clients immediately without breaking legacy clients.
- Standardizes payload across IDE and non-IDE consumers.
- Supports strict/permissive stale policies with explicit status signaling.

### Negative

- Larger claim response payload.
- Temporary maintenance burden for dual fields.

### Risks

- Client confusion if both old and new fields are interpreted inconsistently.

Mitigation: contract documentation, SDK wrappers, and compatibility tests.

## 6. Verification

- Backward compatibility test: existing clients still parse `system_directive`.
- New contract test: freshness metadata present in all successful claims.
- Migration test: dual-field behavior remains equivalent until deprecation cutoff.
