<!-- last_reviewed: 2026-03-10T00:00:00Z -->
<!-- reviewed_by: Documentation -->
<!-- diataxis: reference -->
<!-- audience: developer -->

# Dashboard JavaScript Architecture

Reference documentation for the ForgeOS real-time dashboard client-side
JavaScript. The dashboard is served at `http://localhost:3011/dashboard` and
renders a live Kanban board backed by Server-Sent Events.

## Module Overview

The dashboard uses two vanilla JavaScript modules with no framework
dependencies (except D3.js for the graph view, loaded via CDN).

| Module | File | Lines | Responsibility |
|--------|------|-------|----------------|
| **App** | `forgeos-server/src/dashboard/js/app.js` | ~2 400 | Core application shell — SSE connection, handler dispatch, REST API, filters, rendering, keyboard navigation, theme, slide-over detail panel, auth, claims monitor, operator workbench, machine status |
| **Pipeline** | `forgeos-server/src/dashboard/js/pipeline.js` | ~800 | Kanban pipeline board — initial fetch, granular card rendering, SSE event handling, lease countdown timers, client-side filtering, event delegation |

### Load Order

1. `app.js` runs on `DOMContentLoaded`, calls `init()`, and exposes
   `window.ForgeOS` with shared utilities, constants, and state.
2. `pipeline.js` wraps all logic in an IIFE. It polls for `window.ForgeOS`
   (50 ms interval) and calls `initPipeline()` once available.
3. Pipeline registers itself as an SSE handler via
   `ForgeOS.registerHandler('pipeline', { handleEvent })`.

## Shared API — `window.ForgeOS`

The `init()` function in `app.js` publishes the following surface on
`window.ForgeOS` for use by pipeline.js and future modules:

### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `registerHandler` | `(name: string, handler: { handleEvent(type, data) })` | Register an SSE event handler |
| `unregisterHandler` | `(name: string)` | Remove a registered handler |
| `getConnectionState` | `() => string` | Return `'connected'`, `'reconnecting'`, or `'disconnected'` |
| `reconnect` | `()` | Manually trigger SSE reconnect |
| `announce` | `(msg: string)` | Announce to ARIA live region |
| `escapeHtml` | `(str: string) => string` | HTML-escape a string |
| `formatDuration` | `(ms: number) => string` | Human-friendly duration |
| `formatRelativeTime` | `(iso: string) => string` | Relative time (e.g. "5m ago") |
| `formatLeaseRemaining` | `(iso: string) => string` | Lease remaining or "Expired" |
| `formatTimestamp` | `(iso: string) => string` | Locale-formatted timestamp |
| `formatLeaseCountdown` | `(sec: number) => string` | MM:SS countdown string |
| `getLeaseUrgency` | `(sec: number) => string` | Urgency level from seconds |
| `getClaimStatus` | `(ticket) => string` | Claim status code |
| `debounce` | `(fn, ms) => Function` | Debounce wrapper |
| `fetchJSON` | `(url: string) => Promise` | Fetch + JSON parse with error handling |
| `getMachineColor` | `(hostname: string) => string` | Deterministic colour for a machine |
| `hashString` | `(str: string) => number` | 32-bit string hash |
| `showToast` | `(msg: string)` | Show temporary toast notification |
| `openTicketDetail` | `(ticketId: string)` | Open the slide-over detail panel |
| `openConfirmationModal` | `(title, desc, callback)` | Open confirmation dialog |

### Constants

| Name | Type | Description |
|------|------|-------------|
| `STAGES_MAIN` | `string[]` | Primary pipeline stages (READY through CI) |
| `STAGES_BOTTOM` | `string[]` | Bottom-row stages (DOCS, VALIDATION, DONE, ESCALATED) |
| `ALL_STAGES` | `string[]` | Concatenation of main + bottom |
| `TYPE_COLORS` | `Record<string, string>` | Ticket type to CSS colour mapping |
| `TYPE_LABELS` | `Record<string, string>` | Ticket type to short display label |
| `PRIORITY_ORDER` | `Record<string, number>` | Priority name to sort weight |
| `MACHINE_PALETTE` | `string[]` | 8-colour palette for machine badges |

### State

`ForgeOS.state` holds the global mutable state object. Key properties:

- `tickets` — array of ticket objects from the REST API
- `stages` — stage count summary from `/api/stages`
- `selectedTicketId` — currently open ticket in the detail panel
- `filters` — active filter values
- `isConnected` / `connectionState` — SSE connection status
- `auth` — authentication state (mock)
- `claims` — claims monitor data
- `workbench` — operator workbench state

## SSE Connection

### Connection Lifecycle

1. `connectSSE()` opens an `EventSource` to `/api/events`.
2. On `open`, sets state to `connected`, resets retry counter.
3. Registers listeners for 13 named event types (see table below).
4. On `error`, closes the source and schedules a reconnect with
   exponential backoff: `delay = min(1000 * 2^(retryCount-1), 30110)`.
5. If elapsed time since last message exceeds 30 s and retryCount > 1,
   state changes to `disconnected` and a banner with a Retry button
   appears.

### SSE Event Types

| Event | Handler in app.js | Handler in pipeline.js |
|-------|-------------------|------------------------|
| `snapshot` | Update `state.stages`, `state.tickets`, re-render board | Clear/rebuild `ticketsMap`, full board render |
| `ticket-update` / `ticket_update` | Merge into `state.tickets`, re-render | Merge into `ticketsMap`, update card in-place |
| `ticket_created` | — | Add card to column |
| `ticket_claimed` | — | Update card, start lease timer |
| `stage_advanced` | — | Move card between columns |
| `ticket_rejected` | — | Flash card, increment rework count |
| `ticket_completed` | — | Move card to DONE, stop timer |
| `lease_expired` | — | Set lease to epoch, update card |
| `lease_extended` | — | Update expiry, restart timer |
| `ticket_escalated` | — | Move card to ESCALATED |
| `health_update` | Dispatched to handlers | — |
| `agent_connected` | Dispatched to handlers | — |
| `agent_disconnected` | Dispatched to handlers | — |

### Handler Registry

Modules register via `ForgeOS.registerHandler(name, { handleEvent })`.
All incoming SSE events are dispatched to every registered handler via
`dispatchToHandlers()`. Errors in individual handlers are caught
silently to prevent breaking the dispatch loop.

## Pipeline Module — Kanban Board

### Data Model

`ticketsMap` (`Map<string, object>`) is the pipeline's source of truth.
It is populated from `GET /api/tickets?limit=500` on initial load and
updated incrementally by SSE events.

### Rendering Strategy

The pipeline uses **granular DOM operations** rather than full re-renders:

| Operation | Function | Trigger |
|-----------|----------|---------|
| Full board render | `renderFullBoard()` | Initial load, snapshot event |
| Update card in-place | `updateCardInDOM()` | Ticket property change |
| Add card | `addCardToColumn()` | New ticket created |
| Move card | `moveCardBetweenColumns()` | Stage transition |
| Flash card | `flashCard()` | Rejection event |

Cards are `<article>` elements with data attributes (`data-ticket-id`,
`data-stage`, `data-priority`, `data-type`, `data-machine`, `data-agent`)
used for filtering and identification.

### Lease Countdown Timers

A global `setInterval` ticks every 1 second (`tickLeaseCountdowns()`).
`leaseTimers` (`Map<string, number>`) maps ticket IDs to expiry timestamps.

Display format: `MM:SS` remaining or `EXPIRED`.

Urgency levels (used for CSS classes):

| Level | Threshold |
|-------|-----------|
| `normal` | > 5 min remaining |
| `warning` | 1–5 min remaining |
| `critical` | < 1 min remaining |
| `expired` | 0 or negative |

ARIA labels on countdown elements update every 15 seconds to avoid
screen reader verbosity.

### Client-Side Filtering

Six filter dimensions with AND logic:

| Filter | Control | URL Param |
|--------|---------|-----------|
| Stage | `<select#filter-stage>` | `stage` |
| Type | `<select#filter-type>` | `type` |
| Priority | `<select#filter-priority>` | `priority` |
| Machine | `<select#filter-machine>` | `machine` |
| Agent | `<select#filter-agent>` | `assignee` |
| Search | `<input#filter-search>` | `search` |

Filters are synced bidirectionally with URL query parameters via
`readFiltersFromURL()` / `syncFiltersToURL()`. Cards are shown/hidden
with CSS `display` toggling (`applyFilterToCard()`) — no DOM recreation.

A filter count badge shows the number of active filters.

## App Module Features

### Kanban Board (app.js)

`app.js` provides its own `renderBoard()` / `renderColumn()` functions
used for the initial load path. These re-create card DOM via an HTML
`<template>` element (`#ticket-card-template`). The pipeline module's
granular update functions take over after the initial render.

### Ticket Detail Panel

A slide-over panel with four tabs:

| Tab | Content |
|-----|---------|
| Overview | Metadata, acceptance criteria, description |
| History | Chronological event timeline with coloured dots |
| Dependencies | Upstream/downstream dependency graph with status icons |
| Files | Associated file paths with copy-to-clipboard |

Focus is trapped inside the panel when open. Escape closes it.

### Theme Toggle

Dark/light mode persisted in `localStorage` under `forgeos-theme`.
Toggled via `data-theme` attribute on `<html>`.

### Keyboard Navigation (WCAG 2.2 AA)

| Key | Context | Action |
|-----|---------|--------|
| `1`–`4` | Global | Switch view tab (pipeline, graph, machines, admin) |
| `/` | Global | Focus the search input |
| `?` | Global | Toggle shortcut help overlay |
| `r` | Global (disconnected) | Retry SSE connection |
| `Escape` | Slide-over / modal | Close panel |
| Arrow keys | Ticket cards | Navigate between cards / columns |
| `Enter` / `Space` | Ticket card | Open detail panel |

### Operator Workbench

Ticket search with type-ahead dropdown. Four action buttons:

- **Claim** — claim an unclaimed ticket
- **Release** — release your own claim (requires confirmation)
- **Advance** — advance to next stage
- **Force Release** — release another operator's claim (requires confirmation)

All destructive actions require a 10+ character reason via the
confirmation modal.

### Claims Monitor

Sortable table (desktop) / cards (mobile) of active claims with:

- Sortable columns (click headers)
- Per-row release buttons
- "Release All Expired" bulk action
- Live countdown timers (1-second tick)
- Pagination (20 per page)

### Multi-Machine Status

Card grid showing connected machines with:

- Connection status dot (connected / reconnecting / disconnected)
- Active agent list
- Claims and throughput meters
- Last heartbeat time

### Connection Banner

Appears on SSE disconnect:

- **Reconnecting** — warning style, shows retry delay
- **Disconnected** — error style, shows Retry button

### Metrics

Four metric cards updated from ticket state:

- Total tickets
- Active claims
- Expired leases
- Dashboard uptime

## REST API Endpoints Used

| Endpoint | Method | Used By |
|----------|--------|---------|
| `/api/tickets?limit=500` | GET | pipeline.js initial load |
| `/api/tickets` | GET | app.js `fetchTickets()` |
| `/api/stages` | GET | app.js `fetchStages()` |
| `/api/tickets/:id` | GET | app.js `fetchTicketDetail()` |
| `/api/tickets/:id/history` | GET | app.js `fetchTicketHistory()` |
| `/api/events` | SSE | app.js `connectSSE()` |

## Accessibility

- ARIA live region (`#liveAnnouncer`) for dynamic content announcements
- `aria-label` on every ticket card, column, and interactive element
- `role="listitem"` on cards, `role="list"` on containers
- Focus trap in slide-over and confirmation modal
- `prefers-reduced-motion` respected for card animations
- Keyboard-navigable cards with arrow keys
- Tab key cycles through focusable elements in modals
