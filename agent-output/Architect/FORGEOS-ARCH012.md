# FORGEOS-ARCH012 — ARCHITECT Stage Summary

**Agent:** Architect  
**Ticket:** FORGEOS-ARCH012 — Design Fitness Functions and Verification Plan  
**Stage:** ARCHITECT → DOCS  
**Date:** 2026-03-07  
**Confidence:** HIGH (87%)  

---

## Deliverables

| Artifact | Path | Status |
|----------|------|--------|
| Fitness Functions & Verification Plan | `docs/architecture/fitness-functions.md` | CREATED |

## Summary

Designed **18 fitness functions** covering all quality attributes from FORGEOS-ARCH011 (Quality Attributes & Performance Targets). The document provides:

### Acceptance Criteria Traceability

| AC | Status | Details |
|----|--------|---------|
| Claim latency fitness function | ✅ DONE | FF-01: k6 benchmark, p50/p95/p99 targets, 20%/50% regression thresholds, baseline management |
| Concurrent claim safety | ✅ DONE | FF-08: 20-agent and 50-agent test scenarios, exactly-1-winner assertion, SKIP LOCKED verification |
| State transition integrity | ✅ DONE | FF-09: fast-check property-based tests for S-1/S-2/S-3/I-3 invariants |
| Dependency resolution correctness | ✅ DONE | FF-10: linear chain, diamond, circular rejection, N-wide fan-out test scenarios |
| API response time under load | ✅ DONE | FF-12: 50 VUs, 10-min sustained mixed workload (60% reads, 30% claims, 10% advances) |
| Database query performance | ✅ DONE | FF-13: EXPLAIN ANALYZE on 5 critical query paths, index usage assertion, execution time budgets |
| Verification plan with test guidelines | ✅ DONE | §6: test organization, DB setup, naming conventions, helper patterns, devDependencies |
| CI/CD pipeline integration | ✅ DONE | §5: 4-tier pipeline (PR Gate, PR Extended, Nightly, Weekly) with GitHub Actions workflow |
| Zero-downtime migration | ✅ DONE | FF-11: 5-VU soak test during schema migration, < 0.1% error rate threshold |
| Verification tooling recommendations | ✅ DONE | §4 + ADR-012: k6 (load), fast-check (property), prom-client (metrics) with scored matrices |

### Key Architecture Decisions

1. **k6 over Locust/Artillery** — native threshold assertions, Go binary efficiency, JSON output for CI comparison (scored 57 vs 45 vs 34)
2. **fast-check over hypothesis** — TypeScript-native, seamless Vitest integration for property-based tests (scored 47 vs 30)
3. **prom-client over OpenTelemetry** — minimal overhead, simple API, appropriate for current scale (scored 46 vs 30)
4. **4-tier CI pipeline** — PR Gate (blocking correctness), PR Extended (advisory latency), Nightly (sustained load), Weekly (soak/migration)
5. **Baseline-driven regression** — 20% degradation warns, 50% fails; baseline updated nightly from main branch

### Context Map

- **Primary files:** 7 (pool.ts, migrations, tools/, config.ts, server.ts, vitest.config.ts, docker-compose.yml)
- **New files specified:** 9 test/benchmark files, 1 CI workflow, 1 baseline comparison script
- **Dependencies:** fast-check (new devDep), prom-client (new runtime dep), k6 (CI-only binary)

## Evidence

- All 18 fitness functions have defined thresholds, measurement tools, and CI frequency
- Every correctness invariant (C-1 through D-3) from FORGEOS-ARCH011 is covered
- All performance targets (§3.1) have corresponding latency fitness functions with regression thresholds
- ADR-012 provides scored evaluation matrices (3 candidates per tooling decision)
- DAG task graph identifies ~13 hour critical path with 5 parallel work groups
