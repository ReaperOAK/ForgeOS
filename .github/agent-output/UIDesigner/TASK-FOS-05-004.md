# UIDesigner Output — TASK-FOS-05-004

**Ticket:** TASK-FOS-05-004 — Dashboard JavaScript Logic  
**Agent:** UIDesigner  
**Stage:** FRONTEND (UI design phase)  
**Date:** 2026-03-10T03:00:00Z  
**Confidence:** HIGH

---

## Summary

Designed comprehensive interaction mockup for the three vanilla JS modules powering the ForgeOS dashboard: `app.js` (SSE connection manager), `pipeline.js` (Kanban board logic), and `admin.js` (admin panel). Generated 4 Stitch screens covering desktop and mobile views. All 10 acceptance criteria are fully addressed with detailed specifications that Frontend Engineer can implement without ambiguity.

## Artifacts

| Artifact | Path |
|----------|------|
| Mockup document | `docs/uiux/mockups/TASK-FOS-05-004.md` |
| Stitch project | `projects/17753507249462882723` |
| Stitch Screen 1 (SSE Flow) | Screen ID `ee604df2b09548988f3cd5965d74f2e1` |
| Stitch Screen 2 (Pipeline) | Screen ID `64e1b2edc55545cbb1c14c15a991be4f` |
| Stitch Screen 3 (Admin) | Screen ID `d940555486314533a39f6fafd7028c38` |
| Stitch Screen 4 (Mobile) | Screen ID `cf98ef4e8f2048efbc73e039073bcc52` |

## Acceptance Criteria Verification

| # | Criterion | Status |
|---|-----------|--------|
| AC1 | app.js EventSource + exponential backoff (1s–30s cap) | ✅ |
| AC2 | app.js event dispatch to registered handlers | ✅ |
| AC3 | pipeline.js initial fetch + Kanban render | ✅ |
| AC4 | pipeline.js individual card SSE updates (no re-render) | ✅ |
| AC5 | Lease countdown MM:SS / EXPIRED format | ✅ |
| AC6 | Filter controls (5 dimensions + search) client-side | ✅ |
| AC7 | Force-release confirmation modal → POST | ✅ |
| AC8 | Machine status from GET /api/admin/machines | ✅ |
| AC9 | System health: DB pool, uptime, expired leases | ✅ |
| AC10 | No external JS deps except D3.js CDN | ✅ |

## Key Design Decisions

1. **Event delegation** over per-card listeners for performance with many cards
2. **Global setInterval for lease countdown** (1 timer vs N timers) to minimize CPU
3. **Client-side filtering** (no server round-trip) for instant responsiveness
4. **URL query sync** for filters so filtered views are shareable
5. **Focus trap in confirmation modal** for accessibility compliance
6. **Optimistic UI** for force-release with rollback on error
7. **15-second screen reader interval** for countdown updates (vs 1s visual) to avoid verbosity
8. **Machine status polling** at 15s intervals supplemented by SSE agent_connected/disconnected events

## Handoff Notes for Frontend Engineer

- All interaction specs use vanilla JS patterns — no framework dependencies
- Design tokens referenced by path from `docs/uiux/design-tokens.json`
- Event delegation pattern shown with code examples in mockup §4.6
- State management model defined as TypeScript interfaces (implement as plain JS objects)
- Modal focus trap and keyboard shortcuts fully specified
- Responsive breakpoints follow upstream layout from TASK-FOS-05-001
- All ARIA attributes and screen reader text defined per component

## Quality Score

76/80 — PASS (threshold: 56/80)
