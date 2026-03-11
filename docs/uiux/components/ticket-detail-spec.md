# Ticket Detail View — Component Specification

**Ticket:** FORGEOS-FE004
**Status:** APPROVED
**Date:** 2026-03-11
**Author:** UIDesigner

---

## Overview

The Ticket Detail View is a full-page view displaying comprehensive ticket information accessed via `/tickets/[id]`. It consists of three main components plus a 404 fallback.

## Page: `/tickets/[id]/page.tsx`

### Route
- **Path:** `/tickets/:id` (Next.js App Router dynamic segment)
- **Data Source:** `fetchTicket(id)` from `@/lib/api`
- **Error Handling:** Calls `notFound()` on 404 API response

### Layout
```
┌──────────────────────────────────────┐
│ ← Back to Pipeline                   │
├──────────────────────────────────────┤
│  FORGEOS-FE004          [high][READY]│
│  Implement Ticket Detail View        │
│  Description text...                 │
│                                      │
│  Type: frontend │ Stage: READY       │
│  Claimed: — │ Machine: — │ ...       │
│                                      │
│  Acceptance Criteria                 │
│  ○ Criterion 1                       │
│  ○ Criterion 2                       │
│                                      │
│  File Paths                          │
│  dashboard/src/app/tickets/...       │
│                                      │
│  [tag1] [tag2] [tag3]                │
├──────────────────────────────────────┤
│  [History] [Dependencies]            │
│ ─────────────────────────────────────│
│  (tab content area)                  │
└──────────────────────────────────────┘
```

### States
| State | Behavior |
|-------|----------|
| Loading | Skeleton placeholders with `animate-pulse` |
| Error | Error card with retry button |
| 404 | Next.js `notFound()` triggers `not-found.tsx` |
| Success | Full metadata + tabbed content |

---

## Component: `TicketMetadata`

### Props
```typescript
interface TicketMetadataProps {
    ticket: TicketDetail;
}
```

### Sections
1. **Header** — Ticket ID (monospace) + title + priority/status badges
2. **Description** — Optional description text
3. **Metadata Grid** — 2×4 responsive grid: Type, Stage, Claimed By, Machine, Operator, Lease Expiry, Rework Count, Created
4. **Acceptance Criteria** — Read-only checklist with dot markers
5. **File Paths** — Monospace list with `bg-surface-alt` background
6. **Tags** — Pill-shaped badges with border

### Design Tokens Used
- Priority badges: `bg-error`/`bg-warning`/`bg-info`/`bg-surface-alt`
- Status badges: mapped colors from design tokens
- Monospace text: `font-mono` (JetBrains Mono / Fira Code)
- Surface cards: `bg-surface`, `border-border`

### Accessibility
- `aria-label="Ticket metadata"` on section
- `role="list"` on criteria and file path lists
- Badge text is self-descriptive (no color-only meaning)

---

## Component: `HistoryTimeline`

### Props
```typescript
interface HistoryTimelineProps {
    ticketId: string;
}
```

### Data Source
- `fetchTicketHistory(ticketId)` — returns `EventHistory[]`
- Fetches on mount and when `ticketId` changes

### Display
- Vertical timeline with left border
- Each event: colored dot, event type label, relative timestamp
- Metadata row: agent name, machine, operator
- Stage transitions shown as `STAGE_A → STAGE_B`
- Expandable details section for event payload

### Event Type Colors
| Event | Dot Color |
|-------|-----------|
| CREATED | `bg-info` |
| CLAIMED | `bg-warning` |
| STAGE_ADVANCED | `bg-success` |
| STAGE_REJECTED | `bg-error` |
| COMPLETED | `bg-success` |
| ESCALATED | `bg-error` |
| Default | `bg-muted` |

### States
| State | Behavior |
|-------|----------|
| Loading | 3 skeleton rows with pulse animation |
| Error | Red alert banner with error message |
| Empty | "No history events recorded." text |
| Success | Full timeline |

### Accessibility
- `aria-label="Event timeline"` on ordered list
- `<time>` elements with `dateTime` attribute
- `title` on timestamps shows full date

---

## Component: `DependencyTree`

### Props
```typescript
interface DependencyTreeProps {
    ticket: TicketDetail;
}
```

### Sections
1. **Upstream Dependencies** (depends_on)
   - From `ticket.dependency_status` array
   - Each shows: status dot, ticket ID link, title, resolution status badge
   - Green dot = resolved, yellow dot = unresolved

2. **Downstream Dependents** (depended_by)
   - From `ticket.depends_on` as simple links
   - Each shows: neutral dot, ticket ID link

### Navigation
- All ticket IDs are clickable `<Link>` elements to `/tickets/:id`
- Hover: border transitions to `border-primary`

### States
| State | Behavior |
|-------|----------|
| No deps | "No dependencies for this ticket." text |
| With deps | Two sections with lists |

### Accessibility
- `aria-label` on both upstream/downstream lists
- Status dots have `aria-label` indicating resolved/unresolved
- Links use `href` for keyboard navigation

---

## 404 Page: `not-found.tsx`

- Large "404" heading
- "Ticket Not Found" message
- "Back to Pipeline" link button

---

## Responsive Behavior

| Breakpoint | Behavior |
|------------|----------|
| Mobile (<640px) | Metadata grid: 2 columns, full-width cards |
| Tablet (640–1024px) | Metadata grid: 4 columns |
| Desktop (>1024px) | Max-width 4xl container, 4-col grid |

---

## Design Token References

- **Colors:** primary, surface, surface-alt, border, error, warning, success, info, muted, foreground, inverse
- **Typography:** `font-mono` for IDs, paths, stage labels; `font-sans` for body text
- **Spacing:** `p-6` cards, `gap-4` grid, `space-y-6` sections
- **Borders:** `border-border` standard, `rounded-lg` cards
- **Transitions:** `transition-colors` on interactive elements

---

## Keyboard Navigation

- Tab order: Back link → metadata content → tab buttons → tab panel content
- Tab buttons: clickable, `aria-selected` indicates active
- All links and buttons receive visible focus via `focus-ring` utility
- Dependency links: standard link focus behavior
