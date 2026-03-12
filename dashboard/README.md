# ForgeOS Dashboard

<!-- last_reviewed: 2026-03-12T12:00:00Z -->

> **Category:** Reference  
> **Audience:** Developers working on the ForgeOS dashboard

Next.js 14+ web application for monitoring and managing the ForgeOS
multi-agent orchestration system. Built with the App Router, TypeScript
strict mode, and Tailwind CSS.

## Prerequisites

- **Node.js** 18.17 or later
- **npm** 9+ (or pnpm / yarn)
- **ForgeOS API** running at `http://localhost:3000` (or set
  `NEXT_PUBLIC_API_URL`)

## Quick Start

```bash
cd dashboard
npm install
npm run dev
```

The dashboard starts on **http://localhost:3001** by default.

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server on port 3001 |
| `npm run build` | Create production build |
| `npm start` | Serve production build on port 3001 |
| `npm run lint` | Run ESLint via `next lint` |
| `npm test` | Run Jest test suite |
| `npm run test:coverage` | Run tests with coverage report |

## Project Structure

```
dashboard/
├── next.config.js             # Next.js configuration (strict mode)
├── tailwind.config.ts         # Tailwind CSS with design token colors
├── tsconfig.json              # TypeScript strict mode, bundler resolution
├── postcss.config.js          # PostCSS with Tailwind and Autoprefixer
├── package.json               # Dependencies and scripts
└── src/
    ├── app/                   # Next.js App Router pages
    │   ├── layout.tsx         # Root layout with ThemeProvider
    │   ├── page.tsx           # Dashboard overview (metric cards)    │   ├── claims/
    │   │   └── page.tsx       # Active claims monitor (lease countdowns)    │   ├── health/
    │   │   └── page.tsx       # System health dashboard (4 panels, 30s auto-refresh)
    │   └── machines/
    │       └── page.tsx       # Multi-machine status view (real-time grid)
    ├── components/            # React components
    │   ├── Breadcrumb.tsx     # Breadcrumb navigation
    │   ├── ConnectionStatusIndicator.tsx  # WebSocket status dot
    │   ├── claims/            # Active claims monitor
    │   │   ├── ClaimsTable.tsx  # Sortable claims table + mobile cards
    │   │   └── LeaseCountdown.tsx  # Real-time lease countdown timer
    │   ├── DashboardShell.tsx # Shell layout (sidebar + top bar + content)
    │   ├── filters/           # Filter/sort components
    │   │   ├── FilterBar.tsx   # Filter bar with chip groups + sort
    │   │   └── FilterChip.tsx  # Toggleable chip button
    │   ├── HealthStatusCard.tsx # Service health indicator card
    │   ├── MetricCard.tsx     # Metric display card with trend
    │   ├── MobileSidebar.tsx  # Mobile modal sidebar
    │   ├── Sidebar.tsx        # Desktop collapsible sidebar
    │   ├── ThemeToggle.tsx    # Dark/light theme toggle
    │   ├── TopBar.tsx         # Top bar with breadcrumbs and menu
    │   ├── health/            # Health dashboard components
    │   │   ├── HealthPanel.tsx      # Panel container with status + badge
    │   │   ├── MetricCard.tsx       # Metric value with trend and severity
    │   │   └── StatusIndicator.tsx  # Green/yellow/red status dot
    │   ├── machines/          # Machine status view components
    │   │   ├── MachineCard.tsx      # Individual machine card with status + agents
    │   │   └── AgentList.tsx        # Agent list with clickable links to claims
    │   └── operator/          # Operator workbench components
    │       ├── OperatorActions.tsx   # Action toolbar (Claim, Release, Advance, Force Release)
    │       └── ConfirmationModal.tsx # Confirmation dialog for destructive actions
    ├── lib/                   # Shared utilities
    │   ├── api/               # REST API client library
    │   │   ├── index.ts       # Barrel re-exports (types + functions)
    │   │   ├── types.ts       # TypeScript interfaces and type aliases
    │   │   ├── client.ts      # ForgeApiClient class (fetch wrapper)
    │   │   ├── tickets.ts     # Ticket endpoint functions
    │   │   ├── operations.ts  # Ticket lifecycle action functions (claim, release, advance, force-release)
    │   │   └── websocket.ts   # WebSocket client with reconnection
    │   ├── hooks/             # Custom React hooks
    │   │   ├── useTicketStream.ts  # WebSocket lifecycle hook
    │   │   └── useFilters.ts      # Filter/sort state + URL sync
    │   ├── api-client.ts      # Legacy REST API client (health checks)
    │   ├── theme.tsx          # ThemeProvider context + localStorage
    │   └── types.ts           # Shared TypeScript type definitions
    └── styles/
        └── globals.css        # CSS custom properties (design tokens)
```

## Theme System

The dashboard supports dark and light themes using CSS custom properties
defined in `globals.css`. Themes are toggled through the `ThemeProvider`
context in `src/lib/theme.tsx`.

### How It Works

1. On page load, an inline script in `layout.tsx` reads the stored theme from
   `localStorage` (key: `forgeos-theme`) or falls back to the system
   preference. This prevents a flash of incorrect theme colors.
2. The `ThemeProvider` client component syncs the `data-theme` attribute on
   `<html>` and persists changes to `localStorage`.
3. Tailwind classes reference CSS custom properties (e.g., `bg-background`,
   `text-foreground`), so all components respond to theme changes
   automatically.

### Design Tokens

Colors are sourced from the UIDesigner design tokens (FORGEOS-UID001) and
mapped to CSS variables in `globals.css`:

| Token | Dark | Light |
|-------|------|-------|
| `--color-primary` | `#06b6d4` (cyan) | `#2563eb` (blue) |
| `--color-background` | `#0f172a` (slate 900) | `#f1f5f9` (slate 100) |
| `--color-surface` | `#1e293b` (slate 800) | `#ffffff` (white) |
| `--color-text` | `#f8fafc` (slate 50) | `#0f172a` (slate 900) |
| `--color-error` | `#ef4444` | `#dc2626` |
| `--color-success` | `#16a34a` | `#16a34a` |

The full palette includes `secondary`, `accent`, `border`, `warning`, `info`,
and semantic variants (`*-muted`, `*-hover`).

## Components

### DashboardShell

Wraps all pages with a desktop sidebar, mobile sidebar, and top bar.
Manages sidebar collapse state and mobile drawer open/close.

### MetricCard

Displays a labeled metric value with an icon and optional trend indicator
(`up` or `down` direction with a text value like `+3`).

### HealthStatusCard

Shows the health status of a backend service with status indicator,
endpoint URL, response time, and last check timestamp.

### ThemeToggle

Renders a sun/moon toggle button that switches between dark and light
themes via the `useTheme()` hook.

### Health Dashboard (`/health`)

The system health page displays four panels sourced from the
`/api/health` endpoint. Data auto-refreshes every 30 seconds.

| Panel | Metrics |
|-------|---------|
| **Database** | Connection pool utilization, P50 / P99 latency |
| **MCP Server** | Uptime, connected agents, requests/min |
| **Webhooks** | Success rate, pending queue, failed deliveries |
| **Alerts** | Recent warnings in chronological order |

#### StatusIndicator

Colored dot that maps a `StatusLevel` (`healthy`, `degraded`,
`critical`, `unknown`) to green, yellow, red, or grey. Supports
a pulse animation for critical status.

#### MetricCard (health)

Card showing a labeled value with optional unit, trend arrow
(up / down / flat), and severity border (normal / warning / critical).
Renders a skeleton placeholder while loading.

#### HealthPanel

Section container with a header (title, status dot, alert badge)
and a body slot for child metric cards.

## Machines View (`/machines`)

<!-- last_reviewed: 2026-03-12T20:00:00Z -->

The machines page shows a real-time grid of operator machines with
online/offline status, last heartbeat times, and lists of running agents.
Data is sourced from claimed tickets and updated via WebSocket.

### Components

| Component | File | Purpose |
|-----------|------|---------|
| `MachinesPage` | `app/machines/page.tsx` | Page shell: fetches claimed tickets, aggregates by machine, renders grid |
| `MachineCard` | `components/machines/MachineCard.tsx` | Card showing hostname, status dot, heartbeat time, and agent list |
| `AgentList` | `components/machines/AgentList.tsx` | List of agents with links to `/claims?agent=…` |

### Behavior

- Fetches all `CLAIMED` and `IN_PROGRESS` tickets on mount, then
  aggregates them by `machine_id` into machine cards.
- **Real-time updates** via `TicketWebSocketClient` — cards appear, update,
  or disappear as ticket state changes arrive over WebSocket.
- **Online/offline status** determined by heartbeat recency: a machine is
  online if its last heartbeat is within 10 minutes (`HEARTBEAT_THRESHOLD_MS`).
- Relative timestamps refresh every 30 seconds without a full re-fetch.
- Machines sorted: online first, then alphabetical by hostname.
- Responsive grid layout: 3 columns on desktop, 2 on tablet, 1 on mobile.
- Each machine card has a unique top-border accent color from a rotating
  palette.
- Clicking an agent name navigates to `/claims?agent={name}`.
- Empty state with illustration when no machines are active.
- Error state with a retry button on fetch failure.
- Skeleton cards render while loading.

### Key Interfaces

```typescript
interface MachineCardProps {
  hostname: string;
  status: 'online' | 'offline';
  lastHeartbeat: string;   // ISO-8601
  agents: AgentInfo[];
  machineColor?: string;   // top-border accent
}

interface AgentInfo {
  agentName: string;
  ticketId: string;
  stage: string;
  claimedAt: string;       // ISO-8601
}
```

## API Client

The typed REST API client lives in `src/lib/api/`. Import everything from
the barrel module:

```typescript
import {
  fetchTickets,
  fetchTicket,
  fetchPipelineOverview,
  fetchTicketHistory,
  isApiError,
  type Ticket,
  type TicketFilters,
  type PipelineOverview,
} from '@/lib/api';
```

### Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `NEXT_PUBLIC_API_URL` | `http://localhost:3000` | ForgeOS API base URL |

The client reads the environment variable at construction time and applies
a 10-second request timeout via `AbortController`.

### Endpoint Functions

| Function | Return Type | Backend Endpoint |
|----------|-------------|------------------|
| `fetchTickets(filters?)` | `PaginatedResponse<Ticket>` | `GET /api/tickets` |
| `fetchTicket(id)` | `TicketDetail` | `GET /api/tickets/:id` |
| `fetchPipelineOverview()` | `PipelineOverview` | `GET /api/stages` |
| `fetchTicketHistory(id)` | `EventHistory[]` | `GET /api/tickets/:id/history` |

## WebSocket Real-Time Updates

<!-- last_reviewed: 2026-03-12T20:00:00Z -->

The dashboard receives live ticket updates over a WebSocket connection to
the `/ws/tickets` endpoint. No manual polling is required — ticket cards
move between pipeline columns and detail views refresh automatically.

### Architecture

```
Browser  ──WebSocket──▶  ForgeOS API  /ws/tickets
  │                         │
  │  TicketWebSocketClient  │  Pushes JSON events:
  │  (lib/api/websocket.ts) │   • TICKET_STATE_CHANGE
  │          │              │   • TICKET_CREATED
  │    useTicketStream()    │   • TICKET_UPDATED
  │    (hooks/useTicketStream.ts)
  │          │
  │  ConnectionStatusIndicator
  │  (components/ConnectionStatusIndicator.tsx)
```

### WebSocket Client

`TicketWebSocketClient` (`src/lib/api/websocket.ts`) manages the raw
WebSocket lifecycle:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `url` | `string` | Derived from `NEXT_PUBLIC_API_URL` | WebSocket endpoint URL |
| `initialDelay` | `number` | `1000` | Initial reconnection delay (ms) |
| `maxDelay` | `number` | `30000` | Maximum reconnection delay (ms) |
| `onEvent` | `(event: WebSocketEvent) => void` | no-op | Called for every parsed event |
| `onStatusChange` | `(status: ConnectionStatus) => void` | no-op | Called on status transitions |

Methods:

- **`connect()`** — opens the WebSocket. Safe to call multiple times;
  no-ops if already connected or connecting.
- **`disconnect()`** — closes the connection and clears pending reconnect
  timers. The client will not attempt to reconnect after this call.

**Reconnection** uses exponential backoff: on each failed attempt the delay
doubles (1 s → 2 s → 4 s → … → cap at 30 s). The delay resets to 1 s
after a successful connection.

### useTicketStream Hook

`useTicketStream` (`src/lib/hooks/useTicketStream.ts`) wraps the client
in a React-friendly API:

```tsx
import { useTicketStream } from '@/lib/hooks/useTicketStream';

const { status, reconnect } = useTicketStream({
  enabled: true,
  onTicketUpdate: (ticket) => {
    // Merge updated ticket into local state
  },
});
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | `boolean` | `true` | Connect automatically on mount |
| `onTicketUpdate` | `(ticket: Ticket) => void` | — | Fires for every ticket event |

Returns:

| Field | Type | Description |
|-------|------|-------------|
| `status` | `ConnectionStatus` | `'connected'`, `'connecting'`, or `'disconnected'` |
| `reconnect` | `() => void` | Manually trigger a reconnect |

The hook connects on mount (when `enabled`), disconnects on unmount, and
stabilises callbacks with refs so the WebSocket client is never recreated
due to callback identity changes.

### ConnectionStatusIndicator

`ConnectionStatusIndicator` (`src/components/ConnectionStatusIndicator.tsx`)
renders in the dashboard shell header:

| Status | Dot Color | Animation | Label |
|--------|-----------|-----------|-------|
| `connected` | Green | — | Connected |
| `connecting` | Yellow | Pulse | Connecting… |
| `disconnected` | Red | — | Disconnected |

The component uses `role="status"` and `aria-live="polite"` for
accessibility.

### Event Types

| Event | Payload Fields |
|-------|---------------|
| `TICKET_STATE_CHANGE` | `ticket_id`, `previous_stage`, `new_stage`, `previous_status`, `new_status`, `ticket`, `timestamp` |
| `TICKET_CREATED` | `ticket`, `timestamp` |
| `TICKET_UPDATED` | `ticket`, `timestamp` |

All events carry a full `Ticket` object so consumers can update local
state without an additional API call.

## Filtering and Sorting

<!-- last_reviewed: 2026-03-12T20:00:00Z -->

The pipeline view includes a chip-based filter bar that lets users narrow
the ticket list by stage, type, priority, operator, machine, or agent.
Filter state is synced to URL query parameters so configurations are
bookmarkable and shareable.

### useFilters Hook

`useFilters` (`src/lib/hooks/useFilters.ts`) manages filter and sort
state, reading from and writing to the URL:

```tsx
import { useFilters } from '@/lib/hooks/useFilters';

const {
  filters,       // current FilterState
  toggleFilter,  // toggle a chip on/off
  setSort,       // change sort field
  setSortDir,    // change sort direction
  clearAll,      // reset all filters
  hasActiveFilters,
  activeFilterCount,
} = useFilters();
```

#### FilterState Shape

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `stage` | `TicketStage[]` | `[]` | Active stage filters |
| `type` | `TicketType[]` | `[]` | Active type filters |
| `priority` | `TicketPriority[]` | `[]` | Active priority filters |
| `operator` | `string[]` | `[]` | Active operator filters |
| `machine` | `string[]` | `[]` | Active machine filters |
| `agent` | `string[]` | `[]` | Active agent filters |
| `sort` | `SortField` | `'priority'` | Sort field |
| `sortDir` | `SortDirection` | `'desc'` | Sort direction |

**URL encoding:** array filters are comma-separated
(`?stage=QA,SECURITY&priority=high`). Sort defaults are omitted from the
URL to keep it clean. Multiple filter dimensions combine with **AND**
logic.

### FilterBar Component

`FilterBar` (`src/components/filters/FilterBar.tsx`) renders grouped
chip sets for each filter dimension:

| Prop | Type | Description |
|------|------|-------------|
| `filters` | `UseFiltersResult` | Return value from `useFilters()` |
| `availableOperators` | `string[]` | Dynamic operator values from tickets |
| `availableMachines` | `string[]` | Dynamic machine values from tickets |
| `availableAgents` | `string[]` | Dynamic agent values from tickets |

Features:
- Static chip groups for Stage (11 values), Type (10), Priority (4)
- Dynamic chip groups for Operator, Machine, Agent (populated from data)
- Sort dropdown: Priority, Created Date, Last Updated, Ticket ID
- Active filter count badge in the header
- "Clear all" button resets every filter to its default

### FilterChip Component

`FilterChip` (`src/components/filters/FilterChip.tsx`) is a small
pill-shaped toggle button:

| Prop | Type | Description |
|------|------|-------------|
| `label` | `string` | Display text |
| `active` | `boolean` | Whether the chip is selected |
| `onClick` | `() => void` | Toggle callback |

Active chips use primary fill color; inactive chips use surface
background with a hover effect. Uses `role="option"` and
`aria-selected` for accessibility.

## Pipeline View (`/pipeline`)

<!-- last_reviewed: 2026-03-12T20:00:00Z -->

The pipeline page renders a horizontal Kanban board with 11 SDLC stage
columns (Ready through Done). Each column shows a count badge and a
scrollable list of ticket cards.

### Components

| Component | File | Purpose |
|-----------|------|---------|
| `PipelineBoard` | `components/pipeline/PipelineBoard.tsx` | Groups tickets by stage and renders 11 `StageColumn` instances |
| `StageColumn` | `components/pipeline/StageColumn.tsx` | Single column with header, count badge, and scrollable card list |
| `TicketCard` | `components/pipeline/TicketCard.tsx` | Compact card showing ID, title, type badge, priority dot, claim status |

### Behavior

- Data loads via `fetchTickets()` on mount; manual refresh button available.
- **Real-time updates** via `useTicketStream` — ticket cards move between
  columns automatically when state change events arrive over WebSocket.
- **FilterBar** at the top of the pipeline view enables filtering by stage,
  type, priority, operator, machine, and agent. Sort controls change the
  ordering of tickets within columns.
- Tickets sorted within each column: critical priority first, then by
  most-recently-updated.
- Type badges are color-coded (backend=blue, frontend=teal,
  infra=orange, security=red).
- Priority shown via a left-border color and a small dot indicator.
- Clicking a card navigates to `/tickets/{id}`.
- Empty stages display a low-opacity placeholder message.
- Skeleton columns render while loading.

## Ticket Detail View (`/tickets/[id]`)

<!-- last_reviewed: 2026-03-12T20:00:00Z -->

Displays full metadata and history for a single ticket, loaded by ID
from the URL parameter.

### Components

| Component | File | Purpose |
|-----------|------|---------|
| `TicketDetailPage` | `app/tickets/[id]/page.tsx` | Page shell with tab navigation (History / Dependencies) |
| `TicketNotFound` | `app/tickets/[id]/not-found.tsx` | Custom 404 error page for invalid ticket IDs |
| `TicketMetadata` | `components/tickets/TicketMetadata.tsx` | Header, description, metadata grid, acceptance criteria, file paths |
| `HistoryTimeline` | `components/tickets/HistoryTimeline.tsx` | Vertical timeline of ticket lifecycle events |
| `DependencyTree` | `components/tickets/DependencyTree.tsx` | Upstream/downstream dependency links with status indicators |

### Behavior

- Fetches ticket via `fetchTicket(id)` with automatic 404 detection.
- **Real-time updates** \u2014 the detail view subscribes to `useTicketStream`
  and refreshes metadata when the viewed ticket changes state.
- Metadata grid shows type, stage, claimed-by, machine, operator, lease
  expiry, rework count, and creation time.
- Acceptance criteria rendered as a read-only checklist.
- File paths displayed in monospace font.
- History tab shows events with relative timestamps, agent names, and
  expandable JSON payload details.
- Dependency tab shows upstream (depends-on) and downstream (depended-by)
  tickets as clickable links with resolved/unresolved status dots.

---

## Active Claims Monitor (`/claims`)

<!-- last_reviewed: 2026-03-12T12:00:00Z -->

Displays all currently claimed tickets in a sortable table with real-time
lease countdown timers. Designed for operators who need to monitor which
agents hold active claims and how much lease time remains.

### Components

| Component | File | Purpose |
|-----------|------|---------|
| `ClaimsPage` | `app/claims/page.tsx` | Page shell — loads claims via REST, subscribes to WebSocket updates |
| `ClaimsTable` | `components/claims/ClaimsTable.tsx` | Sortable data table with mobile card layout fallback |
| `LeaseCountdown` | `components/claims/LeaseCountdown.tsx` | Real-time per-second countdown timer with urgency states |

### Behavior

- Claims load via `fetchTickets()` on mount; only tickets with an active
  claim and lease expiry are displayed.
- **Real-time updates** via `useTicketStream` — new claims appear, released
  claims disappear, and lease times stay current without page refresh.
- **Sortable columns:** Ticket, Agent, Machine, Operator, Stage, Lease
  Remaining. Default sort: lease remaining ascending (expiring soonest first).
- **Responsive layout:** table on desktop/tablet, card list on mobile.
- Loading state shows skeleton rows/cards.
- Empty state shows an inbox icon with explanatory text.

### LeaseCountdown States

The countdown timer transitions through four visual states based on
remaining time:

| State | Condition | Indicator | Color |
|-------|-----------|-----------|-------|
| Normal | ≥ 5 min remaining | Solid green dot + MM:SS | Green |
| Warning | < 5 min remaining | Pulsing yellow dot + MM:SS | Yellow |
| Critical | < 1 min remaining | Pulsing red dot + MM:SS | Red |
| Expired | 0 sec remaining | "EXPIRED" badge | Red |

Warning and critical thresholds are configurable via
`warningThreshold` (default 300 s) and `criticalThreshold` (default 60 s)
props on `LeaseCountdown`.

### Accessibility

- Table uses `role="table"` and `role="columnheader"` with `aria-sort`.
- Sort headers are keyboard-focusable and support Enter/Space activation.
- `LeaseCountdown` uses `role="timer"` with throttled `aria-live="polite"`
  announcements (30 s intervals when normal, 10 s when warning, 5 s when
  critical).
- Row visual urgency is communicated via colored left borders, not color
  alone.
- Mobile card list uses `role="list"` with `aria-label`.

### Data Types

| Type | Description |
|------|-------------|
| `ClaimRow` | Flat row model: ticketId, ticketTitle, agent, machine, operator, leaseExpiry, stage, claimedAt |
| `SortField` | Union of sortable column identifiers |
| `SortDirection` | `'asc'` or `'desc'` |
| `ClaimsTableProps` | Props for the `ClaimsTable` component |
| `LeaseCountdownProps` | Props for the `LeaseCountdown` component |
| `CountdownState` | Internal urgency state: normal, warning, critical, expired |

---

## Operator Workbench Actions

<!-- last_reviewed: 2026-03-12T20:00:00Z -->

Action toolbar for executing ticket lifecycle operations from the
dashboard. Operators can claim, release, advance, and force-release
tickets. Destructive actions require explicit confirmation with a
reason or evidence input.

### Components

| Component | File | Purpose |
|-----------|------|---------|
| `OperatorActions` | `components/operator/OperatorActions.tsx` | 2×2 grid of action buttons with state-aware enable/disable logic |
| `ConfirmationModal` | `components/operator/ConfirmationModal.tsx` | Accessible modal dialog with text input for destructive action confirmation |

### API Client

The operations API module (`src/lib/api/operations.ts`) provides typed
functions that POST to the ForgeOS REST API:

| Function | Endpoint | Description |
|----------|----------|-------------|
| `claimTicket(req)` | `POST /api/tickets/:id/claim` | Acquire a 30-minute lease on an unclaimed ticket |
| `releaseTicket(req)` | `POST /api/tickets/:id/release` | Release the caller’s active claim |
| `advanceTicket(req)` | `POST /api/tickets/:id/advance` | Move a ticket to the next SDLC stage |
| `forceReleaseTicket(req)` | `POST /api/tickets/:id/force-release` | Force-release another operator’s claim (requires reason) |

All functions return an `OperationResponse` with `success`, `message`,
`ticketId`, and `timestamp` fields. On failure they throw an `ApiError`
(use `isApiError()` to narrow).

### Action Enable/Disable Rules

| Action | Enabled when |
|--------|-------------|
| Claim | User is authenticated, ticket is selected, and ticket is **not** claimed |
| Release | User is authenticated and **holds** the active claim |
| Advance | User is authenticated and **holds** the active claim |
| Force Release | User is authenticated, ticket **is** claimed, and user **does not** hold the claim |

When the user is not authenticated, a translucent overlay with a lock
icon covers the entire toolbar.

### Confirmation Modal

The `ConfirmationModal` is shown for **Advance** (warning variant) and
**Force Release** (danger variant) actions:

- **Advance** — multiline textarea for evidence; no minimum length.
- **Force Release** — single-line input for a reason; minimum 10 characters.

Behavior:
- Focus traps inside the modal while open.
- Escape closes the modal (disabled during loading).
- Ctrl/Cmd+Enter submits the form.
- Focus returns to the previously focused element on close.

### Accessibility

- Toolbar uses `role="toolbar"` with `aria-label`.
- Each button has a descriptive `aria-label` (e.g., "Claim Ticket:
  Acquire lease on an unclaimed ticket").
- Loading buttons set `aria-busy="true"` and update their label.
- A screen-reader-only `aria-live="polite"` region announces action
  outcomes.
- Disabled buttons include a `title` tooltip explaining why.
- The confirmation modal uses `role="dialog"`, `aria-modal`,
  `aria-labelledby`, and `aria-describedby`.
- Invalid input shows inline error text with `aria-invalid` and
  `aria-describedby` linking to the error message.

### Key Interfaces

```typescript
interface OperatorActionsProps {
  ticketId: string | null;
  ticketStage: string | null;
  isClaimHolder: boolean;
  isClaimed: boolean;
  isAuthenticated: boolean;
  onActionComplete?: (action: OperatorAction, result: ActionResult) => void;
  onActionError?: (action: OperatorAction, error: Error) => void;
}

interface ConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (inputText: string) => void;
  variant: 'danger' | 'warning';
  title: string;
  description: string;
  warningText: string;
  inputLabel: string;
  inputPlaceholder: string;
  confirmLabel: string;
  minInputLength?: number;  // default: 0
  isLoading?: boolean;      // default: false
  multiline?: boolean;      // default: false
}

type OperatorAction = 'claim' | 'release' | 'advance' | 'force-release';
```

---

## Dependency Graph (`/graph`)

Full-project DAG visualisation of ticket dependencies.

### Files

| File | Purpose |
|------|---------|
| `src/app/graph/page.tsx` | Page shell — paginates all tickets and passes them to `DependencyGraph` |
| `src/components/graph/DependencyGraph.tsx` | Interactive SVG graph with zoom, pan, and touch support |
| `src/components/graph/GraphControls.tsx` | Floating toolbar (zoom in / out / fit-to-view) |
| `src/lib/graph/layout.ts` | Sugiyama-style DAG layout engine (topological sort → layer assignment → positioning) |

### Layout Algorithm

1. **Topological sort** — Kahn's algorithm orders nodes from source to sink.
2. **Layer assignment** — longest-path heuristic places each node in a column
   based on its maximum upstream depth.
3. **Positioning** — columns flow left-to-right; nodes within a column stack
   top-to-bottom.

Constants: `NODE_WIDTH = 180`, `NODE_HEIGHT = 56`, `HORIZONTAL_GAP = 80`,
`VERTICAL_GAP = 100`, `PADDING = 60`.

### Interactions

- **Mouse wheel** — zoom in / out (range 20 %–300 %).
- **Click-drag on canvas** — pan the viewport.
- **Touch** — single-finger pan, two-finger pinch-zoom.
- **Click a node** — navigate to `/tickets/{id}`.
- **Hover a node** — highlight connected edges.

---

## Global Search (`/search`)

Full-text ticket search with typeahead, filters, and URL-persisted state.

### Files

| File | Purpose |
|------|---------|
| `src/app/search/page.tsx` | Search page with URL-param sync, filter toggles, and Suspense boundary |
| `src/components/search/SearchBar.tsx` | Combobox-style typeahead (Cmd/Ctrl+K shortcut, debounced API, recent searches) |
| `src/components/search/SearchResults.tsx` | Results list with highlighted matches, empty state, and skeleton loaders |

### Features

- **Keyboard shortcut** — `Cmd/Ctrl + K` focuses the search input from anywhere.
- **Debounced typeahead** — 300 ms debounce; max 10 suggestions.
- **Filter chips** — stage, priority, and type filters toggle on/off.
- **Recent searches** — last 5 queries persisted in `localStorage`.
- **URL sync** — query and active filters serialised to `?q=&stage=&priority=&type=`
  so search state is shareable and bookmark-friendly.
- **Match highlighting** — matching substrings highlighted in both the typeahead
  dropdown and the full results page via `<mark>` elements.

### Error Handling

All endpoint functions throw an `ApiError` on non-OK responses or network
failures. Use the `isApiError` type guard to narrow caught values:

```typescript
try {
  const tickets = await fetchTickets({ stage: 'QA' });
} catch (err) {
  if (isApiError(err)) {
    console.error(`API ${err.status}: ${err.message}`);
  }
}
```

Timeout and network errors set `status: 0` and `code: 'NETWORK_ERROR'`.

### Data Types

The main domain types are defined in `src/lib/api/types.ts`:

| Type | Description |
|------|-------------|
| `Ticket` | Core ticket entity (id, stage, status, priority, etc.) |
| `TicketDetail` | Ticket extended with dependency resolution status |
| `Claim` | Active agent claim on a ticket |
| `StageTransition` | Stage or status change record |
| `EventHistory` | Single audit trail entry |
| `PipelineOverview` | Per-stage ticket counts snapshot |
| `PaginatedResponse<T>` | Generic list wrapper with pagination info |
| `TicketFilters` | Query parameters for `fetchTickets` |
| `ApiError` | Structured error with status code and message |

Enum-like union types: `TicketStage`, `TicketStatus`, `TicketType`,
`TicketPriority`, `EventType`.

## TypeScript Configuration

TypeScript is configured in strict mode with these key settings:

- `strict: true` — enables all strict type-checking options
- `moduleResolution: "bundler"` — optimized for Next.js 14+
- `isolatedModules: true` — required for SWC/Babel transforms
- `paths: { "@/*": ["./src/*"] }` — path alias for clean imports

## Tech Stack

| Technology | Version | Purpose |
|------------|---------|---------|
| Next.js | 14.2+ | React framework with App Router |
| React | 18.3+ | UI library |
| TypeScript | 5.4+ | Type-safe development |
| Tailwind CSS | 3.4+ | Utility-first CSS framework |
| Lucide React | 0.400+ | Icon library |
| ESLint | 8.57+ | Code linting (eslint-config-next) |
| Jest | 30+ | Test runner |
