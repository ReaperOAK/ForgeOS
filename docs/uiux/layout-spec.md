---
title: ForgeOS Dashboard Layout Specification
ticket: FORGEOS-UID001
type: reference
author: UIDesigner
date: 2026-03-07T00:00:00Z
status: APPROVED
stitch_project_id: projects/17753507249462882723
---

# ForgeOS Dashboard Layout Specification

> **Ticket:** FORGEOS-UID001 | **Agent:** UIDesigner | **Date:** 2026-03-07

---

## 1. Overall Shell Architecture

The dashboard uses a top-bar navigation pattern (not sidebar-first) for maximum content width on the Kanban pipeline. A collapsible sidebar is available on mobile via hamburger menu.

```
┌────────────────────────────────────────────────────────────┐
│                    TOP BAR (56px)                           │
│  Logo  │  Pipeline │ Graph │ Claims │ Agents  │  Live │ 👤 │
├────────────────────────────────────────────────────────────┤
│                  FILTER BAR (48px)                          │
│  [Stage ▼] [Priority ▼] [Type ▼] [Assignee] [🔍 Search]  │
├────────────────────────────────────────────────────────────┤
│                                                            │
│                   MAIN CONTENT AREA                        │
│              (fills remaining viewport)                    │
│                                                            │
│    Kanban columns / Table / Graph / Agent cards             │
│                                                            │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

### Shell Dimensions

| Region | Height | Width | Position |
|--------|--------|-------|----------|
| Top Bar | 56px fixed | 100% | Sticky top, z-index: 20 |
| Filter Bar | 48px fixed | 100% | Sticky below top bar, z-index: 20 |
| Main Content | calc(100vh - 104px) | 100% | Scrollable, overflow-x: auto (for Kanban) |
| Slide-over Panel | 100vh | 480px (desktop), 100% (mobile) | Fixed right, z-index: 40 |

---

## 2. Responsive Breakpoints

### Breakpoint Definitions

| Name | Range | Grid Columns | Navigation | Kanban Layout |
|------|-------|-------------|------------|---------------|
| Mobile | < 768px | 1 | Hamburger sidebar | Vertical collapsible sections |
| Tablet | 768px – 1023px | 2 | Compressed tabs | Horizontal scroll, 4 visible columns |
| Laptop | 1024px – 1439px | 3–4 | Full tabs | Horizontal scroll, 8 visible columns |
| Desktop | ≥ 1440px | 6+ | Full tabs | All 11 columns visible |

### Responsive Behavior Matrix

| Element | Mobile (< 768px) | Tablet (768–1023px) | Desktop (≥ 1024px) |
|---------|-------------------|---------------------|---------------------|
| Top Bar | Logo + hamburger + Live dot | Logo + tabs (compressed) + Live | Logo + tabs + search + avatar + Live |
| Filter Bar | Hidden → tap to show | Single row, scrollable | Full row with all filters visible |
| Pipeline columns | Vertical stacked, collapsible | Horizontal scroll, 4 cols visible | Horizontal, 8-11 cols visible |
| Ticket cards | Full-width, 44px min touch height | 200px min-width | 180px min-width |
| Ticket Detail | Full-screen overlay | Slide-over 400px | Slide-over 480px |
| Claims table | Card list (stacked) | Horizontal scroll table | Full table visible |
| Agent Status | Stacked metric cards | 2-column grid | 6-column inline |
| Sidebar nav | Slide-in from left (280px) | N/A (uses tabs) | N/A (uses tabs) |

---

## 3. Navigation Architecture

### 3.1 Desktop/Tablet: Tab Navigation

```
┌──────────────────────────────────────────────────────────────┐
│ ForgeOS Dashboard    [Pipeline] [Graph] [Claims] [Agents]   │
│                                              🟢 Live  🔍  👤│
└──────────────────────────────────────────────────────────────┘
```

- **Tab bar**: Horizontal, inside top bar
- **Active indicator**: 2px bottom border in primary color
- **Keyboard shortcut**: `1`-`4` for tab switching
- **Route mapping**: Hash-based (`#/pipeline`, `#/graph`, `#/claims`, `#/agents`)

### 3.2 Mobile: Collapsible Sidebar Navigation

```
┌──────────────────────┐
│ ForgeOS Dashboard     │
│───────────────────────│
│ ▸ VIEWS              │  ← Collapsible section
│   ■ Pipeline          │  ← Active (accent bg)
│     Graph             │
│     Claims (1)        │  ← Badge for expired
│     Agents            │
│───────────────────────│
│ ▸ FILTERS            │  ← Collapsed by default
│   Stage: [All ▼]     │
│   Priority: [All ▼]  │
│───────────────────────│
│ ▸ QUICK FILTERS      │
│   🙋 My Tickets      │
│   🔴 Critical Only   │
│   ⚠️ Blocked         │
│───────────────────────│
│                       │
│ 👤 ReaperOAK         │
│ ⚙ Settings  ? Help   │
└──────────────────────┘
```

- **Width**: 280px
- **Backdrop**: Scrim overlay on main content
- **Collapse**: Chevron icons for section expand/collapse
- **Close**: Tap scrim or swipe left
- **Sections**: VIEWS, FILTERS, QUICK FILTERS — each independently collapsible

---

## 4. Component Hierarchy

### 4.1 Application Shell

```
App
├── TopBar
│   ├── Logo
│   ├── TabNavigation
│   │   ├── TabItem (Pipeline)
│   │   ├── TabItem (Graph)
│   │   ├── TabItem (Claims)
│   │   └── TabItem (Agents)
│   ├── ConnectionStatus (Live/Reconnecting/Disconnected)
│   ├── GlobalSearch
│   └── UserAvatar
├── FilterBar
│   ├── FilterDropdown (Stage)
│   ├── FilterDropdown (Priority)
│   ├── FilterDropdown (Type)
│   ├── FilterAutocomplete (Assignee)
│   ├── FilterDropdown (Tag)
│   ├── DateRangePicker
│   ├── SearchInput
│   └── ClearAllButton
├── MainContent
│   ├── PipelineView
│   │   ├── StageColumn (×11)
│   │   │   ├── ColumnHeader (name, count, avg time)
│   │   │   └── TicketCard (×N)
│   │   │       ├── TicketId
│   │   │       ├── TicketTitle
│   │   │       ├── PriorityBadge
│   │   │       ├── AgentLabel
│   │   │       ├── TimeInStage
│   │   │       ├── MachineBadge
│   │   │       └── ReworkBadge (conditional)
│   │   └── CompactRow (DOCS, VALIDATION, DONE, ESCALATED)
│   ├── GraphView
│   │   ├── D3ForceGraph
│   │   │   ├── TicketNode (×N)
│   │   │   └── DependencyEdge (×N)
│   │   ├── GraphControls (zoom, pan, reset)
│   │   └── NodeTooltip
│   ├── ClaimsView
│   │   ├── ViewToggle (Flat/Machine/Agent)
│   │   ├── ActionBar (Release All, Refresh)
│   │   └── ClaimsTable
│   │       ├── TableHeader (sortable columns)
│   │       └── ClaimRow (×N)
│   │           ├── TicketLink
│   │           ├── StatusDot
│   │           ├── LeaseCountdown
│   │           ├── MachinePill
│   │           └── ReleaseButton (conditional)
│   └── AgentStatusView
│       ├── SystemHealthPanel
│       │   ├── MetricCard (×6)
│       │   │   ├── MetricLabel
│       │   │   ├── MetricValue
│       │   │   └── MetricChart (optional sparkline/bar)
│       ├── AgentRegistryTable
│       │   ├── AgentRow (×N, expandable)
│       │   └── SessionMonitor (expanded child)
│       └── MachineSummaryPanel
├── TicketDetailSlideOver (conditional)
│   ├── DetailHeader (ID, title, badges)
│   ├── MetadataCard
│   ├── AcceptanceCriteriaList
│   ├── DependencySection
│   ├── FilePathsList
│   ├── HistoryTimeline
│   │   └── TimelineEvent (×N)
│   ├── AgentOutputRenderer
│   └── ActionBar (Release, Rework, Escalate, Copy, GitHub)
├── MobileSidebar (conditional, mobile only)
│   ├── SidebarHeader
│   ├── CollapsibleSection (Views)
│   ├── CollapsibleSection (Filters)
│   ├── CollapsibleSection (Quick Filters)
│   └── UserSection
├── ToastContainer
│   └── Toast (×N)
└── SSEConnectionManager (invisible)
```

### 4.2 Shared Components

| Component | Used In | Variants |
|-----------|---------|----------|
| Badge | Pipeline, Claims, Detail | priority, stage, type, machine, rework |
| StatusDot | Claims, Agents, Connection | active (green), expiring (yellow pulsing), expired (red), idle (gray), stale (orange) |
| SortableColumnHeader | Claims, Agents | ascending (▲), descending (▼), neutral |
| Tooltip | Graph, Pipeline, Agents | light, dark |
| CountdownTimer | Claims, Detail | normal (green), warning (yellow < 10min), expired (red) |
| EmptyState | All views | icon + message + call-to-action |
| LoadingSkeleton | All views | card, row, text, metric |
| ErrorBanner | Top-level | disconnected (red), reconnecting (yellow) |

---

## 5. Spacing System

Based on a 4px grid. All spacing uses multiples of 4px.

| Token | Value | Usage |
|-------|-------|-------|
| `xs` | 4px | Badge padding, icon-text gap, tight inline spacing |
| `sm` | 8px | Card internal spacing between elements, compact list gaps |
| `md` | 16px | Standard content padding, card padding, column gaps |
| `lg` | 24px | Section spacing, filter bar padding, panel margins |
| `xl` | 32px | Large section separation, main content horizontal padding |
| `2xl` | 48px | Page-level vertical margins |
| `3xl` | 64px | Maximum spacing (rarely used) |

### Grid System

| Context | Column Gap | Row Gap |
|---------|-----------|---------|
| Kanban columns | 8px (sm) | — |
| Ticket cards stack | — | 8px (sm) |
| Metric cards row | 16px (md) | — |
| Filter dropdowns | 12px | — |
| Table rows | — | 0 (border-separated) |

---

## 6. Widget Grid Layout

### 6.1 Pipeline Kanban Board

```
Desktop (≥ 1440px): All 11 columns + compact bottom row
┌─────┬─────┬─────┬─────┬─────┬─────┬─────┬─────┐
│READY│ARCHI│RESE │BACK │FRON │ QA  │SECU │ CI  │  ← Scrollable if needed
└─────┴─────┴─────┴─────┴─────┴─────┴─────┴─────┘
┌───────────┬──────────┬──────────┬──────────────┐
│   DOCS    │VALIDATION│   DONE   │  ESCALATED   │  ← Compact summary row
└───────────┴──────────┴──────────┴──────────────┘
```

- **Column width**: `minmax(180px, 1fr)` — flexible, minimum 180px
- **Column height**: `calc(100vh - 104px - 60px)` — fill viewport minus bars and bottom row
- **Scroll**: Vertical scroll per column (overflow-y: auto)
- **Bottom row**: Fixed 60px height, 4 equal-width summary cells

### 6.2 System Health Metric Cards

```
Desktop: 6 cards in a single row
┌──────┬──────┬──────┬──────┬──────┬──────┐
│Uptime│  DB  │ Pool │Active│ SSE  │Events│
└──────┴──────┴──────┴──────┴──────┴──────┘

Tablet: 3 × 2 grid
┌──────┬──────┬──────┐
│Uptime│  DB  │ Pool │
├──────┼──────┼──────┤
│Active│ SSE  │Events│
└──────┴──────┴──────┘

Mobile: Stacked (1 column)
┌──────────────────────┐
│ Uptime               │
├──────────────────────┤
│ DB                   │
├──────────────────────┤
│ Pool                 │
├──────────────────────┤
│ Active │ SSE │Events │  ← 3 mini cards in a row
└──────────────────────┘
```

### 6.3 Dashboard Widget Drag Handles (Future Enhancement)

> **Note:** Drag-and-drop for ticket stage transitions is explicitly NOT supported (per PRD §3.5). Dashboard widget rearrangement is a P3 future enhancement.

When implemented, drag handles would use:
- **Handle icon**: 6-dot grid icon (`⠿`) in top-left corner of each widget
- **Grab cursor**: `cursor: grab` on hover, `cursor: grabbing` during drag
- **Drop zone**: Highlighted with dashed primary border
- **Grid snap**: Widgets snap to the 4px grid
- **Persistence**: Layout saves to localStorage

---

## 7. Ticket Card Specification

### Layout (Desktop)

```
┌─── 3px priority-colored left border ──────────────────┐
│                                                        │
│  FORGEOS-BK-007                          [pop-os]     │
│  Implement Ticket Claim with SKIP LO...               │
│                                                        │
│  [Critical]  Backend              2h 15m   [R1]       │
│                                                        │
└────────────────────────────────────────────────────────┘
```

| Element | Style | Position |
|---------|-------|----------|
| Priority border | 3px solid, left edge | Left |
| Ticket ID | `mono`, `sm`, primary color | Top-left |
| Machine badge | `xs` pill, machine palette color | Top-right |
| Title | `sans`, `sm` to `base`, text color, 1-2 lines max | Below ID |
| Priority badge | `xs` pill, priority color bg, inverse text | Bottom-left |
| Agent name | `sans`, `xs`, muted text | Bottom-center |
| Time in stage | `mono`, `xs`, muted (turns error if threshold) | Bottom-right |
| Rework badge | `xs` pill, warning color | Far bottom-right, conditional |

### Dimensions

| Property | Desktop | Tablet | Mobile |
|----------|---------|--------|--------|
| Width | minmax(180px, 1fr) | minmax(200px, 1fr) | 100% |
| Min height | 88px | 96px | 56px |
| Padding | 12px | 12px | 12px 16px |
| Border radius | 8px (lg) | 8px (lg) | 8px (lg) |
| Margin bottom | 8px (sm) | 8px (sm) | 8px (sm) |

---

## 8. Accessibility Specifications

### Color Contrast (WCAG AA)

| Element | Foreground | Background | Ratio | Status |
|---------|-----------|------------|-------|--------|
| Primary text (dark) | #F8FAFC | #0F172A | 15.4:1 | ✅ Pass |
| Primary text (dark) | #F8FAFC | #1E293B | 11.1:1 | ✅ Pass |
| Muted text (dark) | #94A3B8 | #0F172A | 5.6:1 | ✅ Pass |
| Muted text (dark) | #94A3B8 | #1E293B | 4.1:1 | ✅ Pass (large text) |
| Cyan accent (dark) | #06B6D4 | #0F172A | 7.3:1 | ✅ Pass |
| Primary text (light) | #0F172A | #FFFFFF | 15.4:1 | ✅ Pass |
| Muted text (light) | #64748B | #FFFFFF | 4.6:1 | ✅ Pass |
| Blue primary (light) | #2563EB | #FFFFFF | 4.6:1 | ✅ Pass |
| Error red (dark) | #EF4444 | #0F172A | 4.7:1 | ✅ Pass |
| Success green (dark) | #16A34A | #0F172A | 4.5:1 | ✅ Pass |

### Focus Indicators

| Element | Focus Style |
|---------|-------------|
| Tabs | 2px solid primary outline, 2px offset |
| Buttons | 2px solid primary outline, 2px offset |
| Ticket cards | 2px solid primary outline, visible ring |
| Table rows | Background highlight + 2px left border accent |
| Inputs/dropdowns | 2px solid primary outline |
| Links | Underline + outline on focus-visible |

### Keyboard Navigation

| Shortcut | Action |
|----------|--------|
| `1` – `4` | Switch between Pipeline/Graph/Claims/Agents tabs |
| `/` | Focus search input |
| `Escape` | Close slide-over panel, dismiss modal, clear search |
| `?` | Toggle keyboard shortcut help overlay |
| `Tab` | Navigate between interactive elements |
| `Enter` / `Space` | Activate focused element |
| `Arrow Up/Down` | Navigate within table rows or card lists |
| `Arrow Left/Right` | Navigate between Kanban columns |

### Touch Targets (Mobile)

| Element | Minimum Size |
|---------|-------------|
| Navigation items | 44px × 44px |
| Ticket cards | 44px min height |
| Filter dropdowns | 44px height |
| Action buttons | 44px × 44px |
| Close button (×) | 44px × 44px |
| Hamburger menu | 44px × 44px |

### Screen Reader

| Region | ARIA |
|--------|------|
| Top bar | `role="banner"`, `aria-label="Main navigation"` |
| Tab nav | `role="tablist"`, each tab `role="tab"`, panels `role="tabpanel"` |
| Filter bar | `role="search"` |
| Pipeline columns | `role="list"`, cards `role="listitem"` |
| Claims table | `role="table"`, `role="row"`, `role="cell"` |
| Slide-over | `role="dialog"`, `aria-modal="true"`, `aria-labelledby` |
| Connection status | `aria-live="polite"` |
| SSE updates | `aria-live="polite"` for ticket movements |
| Countdown timers | `aria-label="Lease remaining: X minutes"` |

---

## 9. Connection Status Banner

```
Connected:
┌──────────────────────────────────────────────┐
│                              🟢 Live          │  ← Small dot in top bar
└──────────────────────────────────────────────┘

Reconnecting:
┌──────────────────────────────────────────────┐
│ 🟡 Reconnecting... (retry in 5s)            │  ← Yellow banner below top bar
└──────────────────────────────────────────────┘

Disconnected (> 30s):
┌──────────────────────────────────────────────┐
│ 🔴 Connection lost. Data may be stale. [Retry] │  ← Red banner, full width
└──────────────────────────────────────────────┘
```

---

## 10. Stitch Screen Inventory

| # | Screen Name | Stitch Screen ID | Device | Theme | Route |
|---|-------------|-----------------|--------|-------|-------|
| 1 | Pipeline Overview (Dark) | 2a7507e640a74e44ad3f90cfa3db630b | Desktop | Dark | `#/pipeline` |
| 2 | Ticket Detail Panel | 98bb7e4e7a2e4f0586ac68d02e33ba1c | Desktop | Dark | `#/pipeline?ticket={id}` |
| 3 | Claims Monitor | fde941cfc5b3406b846023d3b9318a64 | Desktop | Dark | `#/claims` |
| 4 | Agent Status | b3f69e414d644a75ad34d36e1cde8559 | Desktop | Dark | `#/agents` |
| 5 | Mobile Navigation | 7bce4b6c4db247ebaf897318d4c36d39 | Mobile | Dark | `#/pipeline` (mobile) |
| 6 | Pipeline Overview (Light) | 252c1278fad04ee39fd210f630cc4319 | Desktop | Light | `#/pipeline` (light) |
