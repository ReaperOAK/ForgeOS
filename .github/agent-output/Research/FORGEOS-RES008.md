# FORGEOS-RES008 — Research Summary

> **Agent:** Research Analyst | **Stage:** RESEARCH  
> **Date:** 2026-03-06 | **Confidence:** HIGH (85%)  
> **Machine:** pop-os | **Operator:** reaperoak

## Research Question

Is event sourcing in PostgreSQL feasible for ForgeOS's ticket lifecycle, and should ForgeOS adopt full event sourcing or enhance its existing hybrid model?

## Key Findings

1. **ForgeOS already has a mature hybrid model** — mutable `tickets` table + append-only `events` table + LISTEN/NOTIFY trigger
2. **Full event sourcing is overkill** — ForgeOS's 13 event types and ≤100K ticket scale don't justify the complexity of projection management, snapshots, and eventual consistency handling
3. **Enhanced hybrid is the best path** — adding `sequence_number`, `aggregate_version`, immutability triggers, and a replay function provides 95% of ES benefits at 20% of the complexity

## Recommendation: Enhanced Hybrid Model

### Priority 1 (Implement Now)
- Add `sequence_number BIGSERIAL` for global monotonic ordering
- Add `aggregate_version INTEGER` with unique constraint per ticket
- Add immutability triggers to prevent UPDATE/DELETE on events
- Update stored functions to populate `aggregate_version`

### Priority 2 (Implement Next)
- Add `replay_ticket_state()` diagnostic function for time-travel debugging
- Add `verify_ticket_integrity()` to compare mutable state vs replayed state
- Add event-based NOTIFY trigger on events table

### Priority 3 (Future)
- Add `correlation_id`/`causation_id` when webhook processor is built
- Plan monthly partitioning when events exceed 1M rows

## What NOT to Do
- Do NOT adopt full event sourcing
- Do NOT normalize event payloads (keep JSONB)
- Do NOT implement snapshots (mutable table IS the snapshot)
- Do NOT use external event stores (EventStoreDB, Kafka)

## Storage Projections
- 1K tickets: ~18 MB
- 10K tickets: ~180 MB
- 100K tickets: ~1.8 GB (partition at this point)

## Artifacts
- Research report: `docs/research/pg-event-sourcing.md`

## Bayesian Update
- **Prior:** 75% — Hybrid likely sufficient; full ES probably overkill
- **Posterior:** 85% — Evidence confirms hybrid superiority at ForgeOS scale (+10%)

## Next Stage
DOCS — Documentation Specialist should review and integrate findings.
