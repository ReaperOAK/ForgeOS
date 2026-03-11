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
