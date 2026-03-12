# FORGEOS-FE010 — UIDesigner Summary

**Ticket:** FORGEOS-FE010 — Implement Multi-Machine Status View
**Agent:** UIDesigner
**Machine:** reaperoak-dev
**Date:** 2026-03-12T00:00:00Z
**Status:** COMPLETE
**Confidence:** HIGH

---

## Objective

Design UI mockups and component specifications for the Multi-Machine Status View page. This page displays a responsive grid of machine cards showing hostname, online/offline status, last heartbeat, and running agents.

## Artifacts Produced

| Artifact | Path |
|----------|------|
| Mockup specification | `docs/uiux/mockups/FORGEOS-FE010.md` |
| Stitch project ID | `.github/stitch-project-id.txt` |

### Stitch Screens Generated

| Screen | Stitch ID | Device |
|--------|-----------|--------|
| Desktop grid (3 columns) | `6d9a71c227074afeb76b30b1233d9ef0` | Desktop |
| Mobile layout (1 column) | `1eae570cc6494ff89fc8138eb5a2ed33` | Mobile |
| Empty state | `5e96f12325bb4249bd4b26481cbe041d` | Desktop |

Project: `projects/17753507249462882723`

## Acceptance Criteria Verification

| # | Criterion | Status |
|---|-----------|--------|
| 1 | Machine cards display hostname, status indicator (green/gray), and last heartbeat | PASS — Specified in MachineCard props and visual structure |
| 2 | Each card shows running agents with claimed tickets | PASS — AgentList component with AgentInfo type |
| 3 | Status determined by heartbeat recency (10 min threshold) | PASS — Logic specified in implementation notes |
| 4 | Responsive grid (3/2/1 columns) | PASS — Desktop/tablet/mobile layouts with Stitch mockups |
| 5 | Clicking agent name navigates to claims view | PASS — Link to `/claims?agent={name}` specified |
| 6 | Real-time updates for online/offline changes | PASS — WebSocket flow diagram in mockup |
| 7 | Empty state when no machines active | PASS — Dedicated empty state screen and spec |

## Component Inventory

| Component | File | Purpose |
|-----------|------|---------|
| MachinesPage | `dashboard/src/app/machines/page.tsx` | Page component with grid layout and empty state |
| MachineCard | `dashboard/src/components/machines/MachineCard.tsx` | Individual machine status card |
| AgentList | `dashboard/src/components/machines/AgentList.tsx` | Agent-to-ticket list within a card |

## Design Decisions

1. **Reused existing design tokens** — No new tokens needed; `success`, `secondary`, `surface`, `primary` cover all states
2. **Followed ConnectionStatusIndicator pattern** for status dots (w-2.5 h-2.5 rounded-full)
3. **Followed MetricCard/HealthStatusCard patterns** for card structure (bg-surface border border-border rounded-lg)
4. **Added "Machines" nav item** recommendation for Sidebar.tsx with `Monitor` lucide icon
5. **Agent links navigate to claims view** filtered by agent name, matching existing routing pattern

## Accessibility

- All contrast ratios meet WCAG AA (4.5:1 minimum)
- Status conveyed by color AND text (not color-only)
- Focus indicators on all interactive elements
- Touch targets ≥44px on mobile
- ARIA labels on cards and agent links
- Reduced motion support

## Next Stage

Ready for **FRONTEND** implementation. Frontend Engineer should:
1. Create the three component files per the specification
2. Add "Machines" nav item to Sidebar.tsx
3. Wire up WebSocket data source for real-time updates
4. Implement the 10-minute heartbeat threshold logic
