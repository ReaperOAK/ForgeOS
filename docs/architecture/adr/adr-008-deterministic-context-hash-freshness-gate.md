---
title: "ADR-008: Deterministic Context Hash and Freshness Gate"
ticket: CTO-prompt-compiler-architecture
type: architecture
author: Architect
date: 2026-03-14T00:00:00Z
status: PROPOSED
tags: [architecture, adr, prompt-compiler, freshness, determinism]
---

# ADR-008: Deterministic Context Hash and Freshness Gate

> **Ticket:** CTO-prompt-compiler-architecture | **Agent:** Architect | **Date:** 2026-03-14  
> **Confidence:** HIGH (90%) | **Status:** PROPOSED

## 1. Status

**PROPOSED** - 2026-03-14

## 2. Context

ForgeOS claim flow can return `compiled_prompt` if present, but does not guarantee freshness against repository, cognition, or memory changes. This allows stale packet delivery and nondeterministic behavior across runs.

Existing anchors:

- `forgeos-server/src/services/compiler.ts` stores prompt content and provider metadata.
- `forgeos-server/src/tools/tickets-claim.ts` returns `compiled_prompt` and `system_directive` with no hash-based freshness check.
- `forgeos-server/src/db/migrations/007-compiled-prompt.sql` has prompt columns but no freshness hash field.

## 3. Alternatives Evaluated

### 3.1 Presence-Only Validation

Deliver prompt when non-null.

- Pros: zero extra compute
- Cons: cannot detect stale context; violates deterministic freshness objective

### 3.2 Timestamp TTL Freshness

Treat prompt as fresh if generated recently.

- Pros: simple
- Cons: false fresh and false stale outcomes; time is not semantic context

### 3.3 Deterministic Hash Freshness (Chosen)

Compute canonical `context_hash` and compare at claim time.

- Pros: semantic freshness guarantee; deterministic invalidation behavior
- Cons: requires canonical version providers and additional metadata handling

## 4. Decision

Adopt deterministic hash-based freshness gate using canonical material:

```text
repo_commit=<sha>|graph_version=<version>|memory_snapshot=<version>|packet_schema=v1|template_version=<id>
```

`context_hash = SHA-256(canonical_material)`

Claim behavior:

- `fresh`: stored hash equals current hash
- `stale`: stored hash differs current hash
- `missing`: no compiled packet

Claim response includes `freshness_status` and `stale_reason`. Recompile trigger is issued on stale/missing.

## 5. Consequences

### Positive

- Eliminates silent stale packet delivery.
- Creates deterministic and testable freshness behavior.
- Supports portable IDE execution with explicit confidence state.

### Negative

- Additional claim-path compute for hash assembly.
- Requires stable version sources from memory and cognition providers.

### Risks

- Canonicalization bugs can cause false stale/fresh.
- Volatile inputs may create noisy invalidations.

Mitigation: strict canonical serializer and determinism regression tests.

## 6. Verification

- Determinism: 100 repeated hash calculations for same input produce identical hash.
- Sensitivity: changing any one context component changes hash.
- Claim conformance: every successful claim returns freshness metadata.
