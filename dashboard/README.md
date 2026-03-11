# ForgeOS Dashboard

<!-- last_reviewed: 2026-03-11T14:00:00Z -->

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
    │   ├── page.tsx           # Dashboard overview (metric cards)
    │   └── health/
    │       └── page.tsx       # System health dashboard (4 panels, 30s auto-refresh)
    ├── components/            # React components
    │   ├── Breadcrumb.tsx     # Breadcrumb navigation
    │   ├── DashboardShell.tsx # Shell layout (sidebar + top bar + content)
    │   ├── HealthStatusCard.tsx # Service health indicator card
    │   ├── MetricCard.tsx     # Metric display card with trend
    │   ├── MobileSidebar.tsx  # Mobile modal sidebar
    │   ├── Sidebar.tsx        # Desktop collapsible sidebar
    │   ├── ThemeToggle.tsx    # Dark/light theme toggle
    │   ├── TopBar.tsx         # Top bar with breadcrumbs and menu
    │   └── health/            # Health dashboard components
    │       ├── HealthPanel.tsx      # Panel container with status + badge
    │       ├── MetricCard.tsx       # Metric value with trend and severity
    │       └── StatusIndicator.tsx  # Green/yellow/red status dot
    ├── lib/                   # Shared utilities
    │   ├── api/               # REST API client library
    │   │   ├── index.ts       # Barrel re-exports (types + functions)
    │   │   ├── types.ts       # TypeScript interfaces and type aliases
    │   │   ├── client.ts      # ForgeApiClient class (fetch wrapper)
    │   │   └── tickets.ts     # Ticket endpoint functions
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

## Pipeline View (`/pipeline`)

<!-- last_reviewed: 2026-03-11T18:00:00Z -->

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
- Tickets sorted within each column: critical priority first, then by
  most-recently-updated.
- Type badges are color-coded (backend=blue, frontend=teal,
  infra=orange, security=red).
- Priority shown via a left-border color and a small dot indicator.
- Clicking a card navigates to `/tickets/{id}`.
- Empty stages display a low-opacity placeholder message.
- Skeleton columns render while loading.

## Ticket Detail View (`/tickets/[id]`)

<!-- last_reviewed: 2026-03-11T18:00:00Z -->

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
- Metadata grid shows type, stage, claimed-by, machine, operator, lease
  expiry, rework count, and creation time.
- Acceptance criteria rendered as a read-only checklist.
- File paths displayed in monospace font.
- History tab shows events with relative timestamps, agent names, and
  expandable JSON payload details.
- Dependency tab shows upstream (depends-on) and downstream (depended-by)
  tickets as clickable links with resolved/unresolved status dots.

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
