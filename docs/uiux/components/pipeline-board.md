---
title: Pipeline Board Component Specification
ticket: FORGEOS-UID002
author: UIDesigner
date: 2026-03-10T00:00:00Z
components:
  - StageColumn
  - PipelineBoard
  - FilterBar (extended)
  - MetadataPanel
  - HistoryTimeline
  - DependencyTree
---

# Pipeline Board Component Specification

> **Ticket:** FORGEOS-UID002 | **Agent:** UIDesigner
> This document defines composite components for the Pipeline (Kanban) view.

---

## 1. PipelineBoard (Container)

### Description

Top-level container that renders 11 StageColumns in a horizontal scrollable grid plus a compact summary row for overflow stages. Receives ticket data from SSE stream and distributes to child columns.

### Props

| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `tickets` | `TicketData[]` | yes | — | Full ticket list from server |
| `filters` | `FilterState` | no | `{}` | Active filter criteria |
| `selectedTicketId` | `string \| null` | no | `null` | Currently selected ticket (for detail panel) |
| `onTicketSelect` | `(ticketId: string) => void` | no | — | Ticket card click handler |
| `isLoading` | `boolean` | no | `false` | Initial data loading state |
| `isConnected` | `boolean` | no | `true` | SSE connection status |

### FilterState Type

```typescript
interface FilterState {
  stage?: string;
  priority?: 'critical' | 'high' | 'medium' | 'low';
  type?: 'backend' | 'frontend' | 'fullstack' | 'infra' | 'security' | 'docs' | 'research' | 'architecture';
  assignee?: string;
  search?: string;
}
```

### States

| State | Visual |
|-------|--------|
| Loading | 11 skeleton columns with 2-3 skeleton cards each |
| Connected | Live data, columns populated, subtle green connection dot |
| Disconnected | Yellow banner: "Reconnecting..." with spinner |
| Error | Red banner: "Failed to load pipeline. [Retry]" |
| Empty (filtered) | All columns empty, centered message: "No tickets match current filters" |
| Empty (no data) | All columns empty, centered message: "No tickets in system" |

### Layout

```
Main Grid (Desktop):
  - Top row: 8 columns (READY through SECURITY)
    - CSS: grid-template-columns: repeat(8, minmax(180px, 1fr))
    - Horizontal overflow: scroll
  - Bottom row: 4 compact columns (CI, DOCS, VALIDATION, DONE)
    - CSS: grid-template-columns: repeat(4, minmax(200px, 1fr))
    - Height: 60px with count only

Mobile:
  - Vertical stack with accordion sections
  - No grid; block-level sections

Tablet:
  - Single scrollable row of all columns
  - Snap scroll on swipe
```

### Keyboard Navigation (Board Level)

| Key | Action |
|-----|--------|
| Arrow Left | Focus previous stage column header |
| Arrow Right | Focus next stage column header |
| Arrow Down | Enter column, focus first ticket card |
| Escape | Exit column, return focus to column header |
| Home | Focus first column (READY) |
| End | Focus last column (DONE) |

---

## 2. StageColumn

Full specification in [FORGEOS-UID002 Mockup §3.2](../../uiux/mockups/FORGEOS-UID002.md#32-stagecolumn).

### Summary

- 3px top accent border in stage-specific color
- Header: stage name (weight 600), count badge (primary bg), average time (mono)
- Scrollable card area with TicketCard children
- Empty state with centered message
- Collapsed/expanded toggle for mobile accordion
- Compact mode (60px) for bottom row stages

### Integration Notes

```typescript
// Each column groups tickets by stage
const stageTickets = allTickets.filter(t => t.stage === column.stage);

// Apply global filters
const filteredTickets = applyFilters(stageTickets, filters);

// Sort within column: critical first, then by time-in-stage descending
const sortedTickets = filteredTickets.sort((a, b) => {
  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  return priorityOrder[a.priority] - priorityOrder[b.priority]
    || b.timeInStageMs - a.timeInStageMs;
});
```

---

## 3. FilterBar (Extended for Pipeline)

Extends the base FilterBar from FORGEOS-UID001 with pipeline-specific filters.

### Additional Filter Controls

| Control | Type | Options | URL Param |
|---------|------|---------|-----------|
| Stage | Dropdown | All 11 SDLC stages + "All" | `?stage=` |
| Priority | Dropdown | Critical, High, Medium, Low, All | `?priority=` |
| Type | Dropdown | backend, frontend, fullstack, infra, security, docs, research, architecture, All | `?type=` |
| Assignee | Text input | Free text, autocomplete from agent list | `?assignee=` |
| Search | Text input | Searches ticket ID and title | `?search=` |
| Clear | Button | Resets all filters | Removes all params |

### Filter Persistence

Filters sync to URL query parameters for shareability. On page load, filters are restored from URL.

### Filter Interaction

```
┌─────────────────────────────────────────────────────────────┐
│ [All Stages ▼]  [All Priorities ▼]  [All Types ▼]          │
│ [Assignee...🔍]  [Search tickets...🔍]          [Clear ✕]  │
└─────────────────────────────────────────────────────────────┘
```

Each dropdown: dark surface background, primary accent on selected, chevron indicator, max 12 visible items with scroll.

### Design Token References

| Element | Token |
|---------|-------|
| Bar background | `themes.dark.colors.surface` (`#1E293B`) |
| Bar height | 48px |
| Dropdown background | `themes.dark.colors.background` (`#0F172A`) |
| Dropdown hover | `themes.dark.colors.surfaceHover` |
| Selected option | `themes.dark.colors.primary` (`#06B6D4`) |
| Input text | `themes.dark.colors.text` (`#F8FAFC`) |
| Placeholder text | `themes.dark.colors.textMuted` (`#94A3B8`) |
| Clear button | `themes.dark.colors.textMuted`, hover `#F8FAFC` |

---

## 4. MetadataPanel

Full specification in [FORGEOS-UID002 Mockup §3.3](../../uiux/mockups/FORGEOS-UID002.md#33-metadatapanel).

### Summary

- Displayed in Overview tab of Ticket Detail slide-over
- Three sections: Metadata fields, Acceptance Criteria checklist, Description
- Metadata as key-value pairs with type/priority/stage badges
- AC displayed as checkbox list with progress counter
- Read-only in all states (no editing from dashboard)

### Design Token References

| Element | Token |
|---------|-------|
| Section header | `typography.fontSize.sm`, `themes.dark.colors.textMuted` |
| Field label | `typography.fontSize.xs`, `themes.dark.colors.textMuted` |
| Field value | `typography.fontSize.sm`, `themes.dark.colors.text` |
| Divider | `themes.dark.colors.border` (`#334155`) |
| AC checked | `themes.dark.colors.success` (`#16A34A`) icon |
| AC unchecked | `themes.dark.colors.textMuted` icon |
| AC progress | `typography.fontSize.xs`, `themes.dark.colors.primary` |

---

## 5. HistoryTimeline

Full specification in [FORGEOS-UID002 Mockup §3.4](../../uiux/mockups/FORGEOS-UID002.md#34-historytimeline).

### Summary

- Vertical timeline with event cards and colored dots
- Newest events at top
- Filterable by agent and event type
- Each event shows: type badge, timestamp, agent badge, machine pill, details text
- Timeline line: 2px vertical in border color

### Integration Notes

```typescript
// Events come from ticket.history array
interface TicketHistory {
  history: Array<{
    timestamp: string;
    event: string;
    agent: string;
    machine_id?: string;
    details: string;
  }>;
}

// Already sorted newest-first by server
// Client applies optional agent/event filters
```

### Design Token References

| Element | Token |
|---------|-------|
| Timeline line | `themes.dark.colors.border` (`#334155`) |
| Event dot | Event-specific color (see mockup §3.4 mapping) |
| Event card bg | `themes.dark.colors.surface` (`#1E293B`) |
| Event card border | `themes.dark.colors.border` (`#334155`) |
| Event card hover | `themes.dark.colors.surfaceHover` |
| Timestamp text | `typography.fontFamily.mono`, `typography.fontSize.xs` |
| Details text | `typography.fontSize.sm`, `themes.dark.colors.textMuted` |

---

## 6. DependencyTree

Full specification in [FORGEOS-UID002 Mockup §3.5](../../uiux/mockups/FORGEOS-UID002.md#35-dependencytree).

### Summary

- Two sections: "Depends On" (upstream) and "Blocks" (downstream)
- Each dependency shows: status icon, ticket ID (link), title (truncated), stage badge
- Optional visual graph (desktop only) showing dependency chain
- Clickable ticket IDs navigate to that ticket's detail panel

### Integration Notes

```typescript
// Dependencies come from ticket JSON
interface TicketDependencies {
  depends_on: string[];   // ticket IDs
  // depended_by is computed server-side via reverse lookup
}

// Resolve each dependency to get stage and title
// Status derived: DONE = resolved, READY = waiting, else = blocked
```

### Design Token References

| Element | Token |
|---------|-------|
| Section header | `typography.fontSize.sm`, weight 600 |
| Resolved icon | `themes.dark.stage.done` (`#22C55E`) |
| Waiting icon | `themes.dark.colors.primary` (`#06B6D4`) |
| Blocked icon | `themes.dark.colors.error` (`#EF4444`) |
| Ticket ID link | `themes.dark.colors.primary`, hover underline |
| Graph node border | Stage-specific color from `themes.dark.stage.*` |
| Graph edge line | `themes.dark.colors.border` (`#334155`), 2px |
| Current node glow | `themes.dark.colors.primary` with 4px box-shadow |

---

## 7. Ticket Detail Slide-Over (Enhanced)

Extends the TicketDetailSlideOver from FORGEOS-UID001 with tabbed content.

### Tab Configuration

| Tab | Label | ARIA Label | Default Content |
|-----|-------|------------|-----------------|
| Overview | Overview | "Ticket overview" | MetadataPanel |
| History | History | "Ticket history timeline" | HistoryTimeline |
| Dependencies | Dependencies | "Ticket dependencies" | DependencyTree |
| Files | Files | "Associated files" | FilePathList |

### Tab Implementation

```
Tab Bar:
  role="tablist"
  aria-label="Ticket detail tabs"

Each Tab:
  role="tab"
  aria-selected="true|false"
  aria-controls="tabpanel-{id}"
  tabindex="0|-1"

Tab Panel:
  role="tabpanel"
  aria-labelledby="tab-{id}"
  tabindex="0"
```

### Tab Keyboard Navigation

| Key | Action |
|-----|--------|
| Arrow Left | Focus previous tab |
| Arrow Right | Focus next tab |
| Enter / Space | Activate focused tab |
| Home | Focus first tab |
| End | Focus last tab |

### Panel Header Layout

```
┌──────────────────────────────────────────┐
│ ✕                                         │
│ FORGEOS-BK-007                            │  ← Ticket ID (primary color, mono)
│ Implement Ticket Claim with SKIP LOCKED   │  ← Title (text color, weight 600)
│                                           │
│ [Critical]  [backend]  [QA]               │  ← Priority, Type, Stage badges
│ ● Backend  [pop-os]                       │  ← Claim indicator, agent, machine
│ ⏱ 18m 32s remaining                      │  ← Countdown timer (if lease active)
│                                           │
│ [Overview] [History] [Dependencies] [Files]│  ← Tab bar
│ ──────────────────────────────────────────│
│                                           │
│             {Tab Content}                 │  ← Scrollable tab panel
│                                           │
│ ──────────────────────────────────────────│
│ [Release Claim]  [Send to Rework]  [📋]  │  ← Action buttons
└──────────────────────────────────────────┘
```

### Dimensions

| Property | Desktop | Tablet | Mobile |
|----------|---------|--------|--------|
| Panel width | 480px | 360px | 100vw |
| Animation | Slide from right, 200ms ease | Slide from right | Slide from bottom |
| Header height | ~180px | ~180px | ~160px |
| Tab bar height | 40px | 40px | 40px |
| Action bar height | 56px | 56px | 56px |
| Content area | `calc(100vh - header - tabbar - actionbar)` | same | same |
| Scrim overlay | `rgba(15, 23, 42, 0.6)` click-to-close | same | none (full screen) |

---

## 8. FilePathList Component

### Description

Simple list of file paths associated with the ticket, displayed in the Files tab.

### Props

| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `filePaths` | `string[]` | yes | — | Array of file paths from ticket JSON |
| `onCopy` | `(path: string) => void` | no | — | Copy single path to clipboard |

### Layout

```
┌──────────────────────────────────────────┐
│  ASSOCIATED FILES                   (5)  │
│  ────────────────────────────────────    │
│  📄 src/api/tickets.ts            [📋]  │
│  📄 src/api/claims.ts             [📋]  │
│  📄 src/db/ticket-queries.ts      [📋]  │
│  📄 src/__tests__/tickets.test.ts [📋]  │
│  📄 src/__tests__/claims.test.ts  [📋]  │
└──────────────────────────────────────────┘
```

### States

| State | Description | Visual |
|-------|-------------|--------|
| Default | File paths listed | Monospace text, copy button on hover |
| Empty | No file_paths in ticket | "No files associated" muted text |
| Copied | After copy click | Toast: "Path copied to clipboard" |

### Accessibility

| Aspect | Requirement |
|--------|-------------|
| ARIA Role | `role="list"` with `aria-label="Associated file paths"` |
| Copy Button | `aria-label="Copy path {filename}"` |
| Keyboard | Tab through items, Enter to copy |

---

## References

- **Mockup Document:** [FORGEOS-UID002.md](../../uiux/mockups/FORGEOS-UID002.md)
- **Design Tokens:** [design-tokens.json](../../uiux/design-tokens.json)
- **Layout Spec:** [layout-spec.md](../../uiux/layout-spec.md)
- **Upstream Specs:** [FORGEOS-UID001.md](../../uiux/mockups/FORGEOS-UID001.md)
