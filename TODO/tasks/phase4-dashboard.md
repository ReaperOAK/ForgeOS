# Phase 4 — Dashboard L3 Tickets

Source blocks: BLK-10-01 (Dashboard UI Design), BLK-10-02 (Dashboard Core Views), BLK-10-03 (Dashboard Operations & Advanced Features)

---

## BLK-10-01: Dashboard UI Design (UIDesigner Artifacts)

---

## FORGEOS-UID001: Design Dashboard Layout and Design Tokens

**Type:** frontend
**Priority:** high
**Dependencies:** FORGEOS-PM004
**Files:** docs/uiux/mockups/FORGEOS-UID001.md, docs/uiux/design-tokens.json, docs/uiux/layout-spec.md
**Tags:** frontend, uidesign, tokens, layout, theme, phase4, BLK-10-01

### Description

Define the foundational design system for the ForgeOS dashboard. Establish design tokens for colors (dark and light theme), typography scale, spacing system (4px grid), border radius, shadow levels, and z-index layering. Specify responsive layout breakpoints (desktop-first: 1440px, 1024px, 768px). Define the overall dashboard shell layout: sidebar navigation, top bar, main content area, and notification panel. Produce the design token JSON file and layout specification document.

### Acceptance Criteria

- [ ] Design tokens defined for dark theme (primary, secondary, accent, surface, error, warning, success colors)
- [ ] Design tokens defined for light theme with matching semantic color names
- [ ] Typography scale defined (heading 1-4, body, caption, code) with font family, size, weight, line-height
- [ ] Spacing system using 4px grid (xs=4, sm=8, md=16, lg=24, xl=32, xxl=48)
- [ ] Responsive breakpoints: desktop (>=1440px), laptop (>=1024px), tablet (>=768px)
- [ ] Dashboard shell layout wireframe: sidebar (collapsible), top bar (breadcrumb, user menu), main content, notification tray
- [ ] Design token JSON file exported for consumption by frontend theming system

---

## FORGEOS-UID002: Design Pipeline and Ticket Detail Views

**Type:** frontend
**Priority:** high
**Dependencies:** FORGEOS-UID001
**Files:** docs/uiux/mockups/FORGEOS-UID002.md, docs/uiux/components/pipeline-board.md, docs/uiux/components/ticket-card.md
**Tags:** frontend, uidesign, pipeline, kanban, ticketDetail, phase4, BLK-10-01

### Description

Design the stage pipeline view (Kanban board) and ticket detail view. The pipeline view shows columns for each SDLC stage (READY through DONE) with ticket cards showing ID, title, type badge, priority indicator, and claim status. The ticket detail view shows full metadata, acceptance criteria checklist, file paths, dependency tree, history timeline, and agent activity log. Define component specifications for TicketCard, StageColumn, MetadataPanel, HistoryTimeline, and DependencyTree.

### Acceptance Criteria

- [ ] Pipeline view wireframe with 11 stage columns, ticket count badges, and scrollable card lists
- [ ] TicketCard component spec: ticket ID, title (truncated), type badge (color-coded), priority dot, claim indicator
- [ ] StageColumn component spec: stage name header, count badge, card list with empty state
- [ ] Ticket detail view wireframe with tabbed layout (Overview, History, Dependencies, Files)
- [ ] HistoryTimeline component spec: chronological event list with agent attribution and timestamps
- [ ] DependencyTree component spec: upstream (depends_on) and downstream (depended_by) ticket links
- [ ] Mockup approval status set to APPROVED in mockup document header

---

## FORGEOS-UID003: Design Dependency Graph and Search Interface

**Type:** frontend
**Priority:** medium
**Dependencies:** FORGEOS-UID001
**Files:** docs/uiux/mockups/FORGEOS-UID003.md, docs/uiux/components/dependency-graph.md, docs/uiux/components/search-bar.md
**Tags:** frontend, uidesign, dag, graph, search, phase4, BLK-10-01

### Description

Design the interactive dependency graph (DAG visualization) and global search interface. The dependency graph replaces `todo_visual.py --dot` output with an interactive, zoomable, pannable directed acyclic graph. Nodes represent tickets color-coded by stage, edges show dependency relationships. The search interface provides global search by ticket ID, title keyword, file path, agent, and stage with type-ahead suggestions and recent searches.

### Acceptance Criteria

- [ ] Dependency graph wireframe showing DAG with ticket nodes and dependency edges
- [ ] Node design: rounded rectangle with ticket ID, short title, stage color fill, priority border
- [ ] Edge design: directional arrows with hover tooltip showing dependency relationship
- [ ] Graph controls: zoom slider, fit-to-view button, pan via drag, minimap navigator
- [ ] Search bar wireframe: input field with filter chips (stage, type, priority, agent), type-ahead dropdown
- [ ] Search results view: list with ticket cards, highlight matching terms, sort options
- [ ] Mockup approval status set to APPROVED in mockup document header

---

## FORGEOS-UID004: Design Operator Workbench and Claims Monitor

**Type:** frontend
**Priority:** medium
**Dependencies:** FORGEOS-UID001
**Files:** docs/uiux/mockups/FORGEOS-UID004.md, docs/uiux/components/claims-monitor.md, docs/uiux/components/operator-actions.md
**Tags:** frontend, uidesign, operator, claims, monitor, phase4, BLK-10-01

### Description

Design the operator workbench and active claims monitor views. The claims monitor shows all active claims with agent identity, machine ID, operator name, ticket info, and a real-time lease countdown timer. The operator workbench provides authenticated action buttons for claim, release, and advance operations. Design confirmation modals for destructive actions (force-release, force-advance). Define the multi-machine status panel showing connected machines and running agents.

### Acceptance Criteria

- [ ] Claims monitor wireframe: table with columns (Ticket, Agent, Machine, Operator, Lease Remaining, Actions)
- [ ] Lease countdown timer component: visual countdown with warning state at <5 minutes, critical at <1 minute
- [ ] Operator action buttons: Claim (green), Release (orange), Advance (blue), Force-Release (red with lock icon)
- [ ] Confirmation modal for destructive actions with reason text input and explicit confirm button
- [ ] Multi-machine status panel: machine cards with hostname, status indicator, active agents list, last heartbeat
- [ ] All operator actions gated behind authentication indicator (logged-in user badge)
- [ ] Mockup approval status set to APPROVED in mockup document header

---

## FORGEOS-UID005: Design System Health Dashboard

**Type:** frontend
**Priority:** low
**Dependencies:** FORGEOS-UID001
**Files:** docs/uiux/mockups/FORGEOS-UID005.md, docs/uiux/components/health-panel.md
**Tags:** frontend, uidesign, health, monitoring, status, phase4, BLK-10-01

### Description

Design the system health dashboard view. Show database connection pool status (active, idle, max), MCP server status (uptime, connected agents, request rate), webhook delivery health (success rate, pending queue, failed deliveries), and system alerts. Design status indicator components (green/yellow/red) and metric cards with sparkline mini-charts for trending data. Define the notification/alert tray design for system-wide warnings.

### Acceptance Criteria

- [ ] System health view wireframe with 4 panels: Database, MCP Server, Webhooks, Alerts
- [ ] Database panel: connection pool gauge (used/max), query latency p50/p99, recent slow queries
- [ ] MCP Server panel: uptime duration, connected agents count, requests/minute sparkline
- [ ] Webhook panel: delivery success rate percentage, pending queue depth, failed delivery count
- [ ] Status indicator component: colored dot (green=healthy, yellow=degraded, red=critical) with tooltip
- [ ] Metric card component: label, current value, sparkline trend (last 1h), change indicator (up/down arrow)
- [ ] Mockup approval status set to APPROVED in mockup document header

---

## BLK-10-02: Dashboard Core Views (Frontend Implementation)

---

## FORGEOS-FE001: Scaffold Dashboard Web Application

**Type:** frontend
**Priority:** critical
**Dependencies:** FORGEOS-UID001, FORGEOS-BE038
**Files:** dashboard/package.json, dashboard/tsconfig.json, dashboard/next.config.js, dashboard/src/app/layout.tsx, dashboard/src/app/page.tsx, dashboard/src/styles/globals.css, dashboard/src/lib/theme.ts
**Tags:** frontend, dashboard, scaffold, nextjs, react, phase4, BLK-10-02

### Description

Scaffold the dashboard web application using Next.js (App Router) with TypeScript. Set up the project structure, install core dependencies (React 18+, Next.js 14+, TypeScript, Tailwind CSS), configure the theme system from UIDesigner design tokens (FORGEOS-UID001), and create the dashboard shell layout with sidebar navigation, top bar, and content area. Verify connectivity to the REST API health endpoint (FORGEOS-BE038).

### Acceptance Criteria

- [ ] Next.js 14+ application scaffolded with App Router and TypeScript strict mode
- [ ] Tailwind CSS configured with design token color palette from FORGEOS-UID001
- [ ] Dashboard shell layout implemented: collapsible sidebar, top bar with breadcrumbs, main content area
- [ ] Dark and light theme toggle functional using design tokens
- [ ] REST API client module created with base URL configuration from environment variable
- [ ] Health check page verifies connectivity to /api/health endpoint
- [ ] Build produces zero TypeScript errors and zero lint warnings

---

## FORGEOS-FE002: Implement API Client and Data Models

**Type:** frontend
**Priority:** critical
**Dependencies:** FORGEOS-FE001, FORGEOS-BE034
**Files:** dashboard/src/lib/api/client.ts, dashboard/src/lib/api/tickets.ts, dashboard/src/lib/api/types.ts, dashboard/src/lib/api/index.ts
**Tags:** frontend, dashboard, api, client, types, models, phase4, BLK-10-02

### Description

Implement the REST API client library for the dashboard. Create TypeScript interfaces matching the backend API response models (Ticket, Claim, StageTransition, EventHistory, PipelineOverview). Implement API functions for all ticket endpoints: list tickets with filters, get ticket detail, get ticket history. Use fetch with proper error handling, response typing, and request/response interceptors for authentication headers.

### Acceptance Criteria

- [ ] TypeScript interfaces defined for Ticket, Claim, StageTransition, EventHistory, PipelineOverview
- [ ] API client function: fetchTickets(filters) → PaginatedResponse<Ticket>
- [ ] API client function: fetchTicket(id) → TicketDetail (includes history, dependencies)
- [ ] API client function: fetchPipelineOverview() → PipelineOverview (counts per stage)
- [ ] API client function: fetchTicketHistory(id) → EventHistory[]
- [ ] Error responses parsed into typed error objects with status code and message
- [ ] Base URL configurable via NEXT_PUBLIC_API_URL environment variable

---

## FORGEOS-FE003: Implement Stage Pipeline Kanban View

**Type:** frontend
**Priority:** critical
**Dependencies:** FORGEOS-FE002, FORGEOS-UID002
**Files:** dashboard/src/app/pipeline/page.tsx, dashboard/src/components/pipeline/StageColumn.tsx, dashboard/src/components/pipeline/TicketCard.tsx, dashboard/src/components/pipeline/PipelineBoard.tsx
**Tags:** frontend, dashboard, pipeline, kanban, tickets, stage, phase4, BLK-10-02

### Description

Implement the stage pipeline view as a horizontal Kanban-style board following the UIDesigner mockup (FORGEOS-UID002). Display 11 stage columns (READY through DONE), each showing a count badge and a scrollable list of ticket cards. Each ticket card shows the ticket ID, truncated title, type badge (color-coded), priority indicator, and claim status. Support column collapsing for unused stages. Data sourced from the pipeline overview and ticket list API endpoints.

### Acceptance Criteria

- [ ] PipelineBoard renders 11 StageColumn components in SDLC order
- [ ] StageColumn shows stage name, ticket count badge, and scrollable card list
- [ ] TicketCard displays: ticket ID, title (max 50 chars), type badge, priority dot, claim indicator
- [ ] Type badges color-coded: backend=blue, frontend=green, fullstack=purple, infra=orange, security=red, docs=gray
- [ ] Clicking a TicketCard navigates to ticket detail page
- [ ] Empty stages show placeholder message with reduced opacity
- [ ] Pipeline data refreshes on page load and on manual refresh button click

---

## FORGEOS-FE004: Implement Ticket Detail View

**Type:** frontend
**Priority:** critical
**Dependencies:** FORGEOS-FE002, FORGEOS-UID002
**Files:** dashboard/src/app/tickets/[id]/page.tsx, dashboard/src/components/tickets/TicketMetadata.tsx, dashboard/src/components/tickets/HistoryTimeline.tsx, dashboard/src/components/tickets/DependencyTree.tsx
**Tags:** frontend, dashboard, ticketDetail, history, dependencies, phase4, BLK-10-02

### Description

Implement the ticket detail page following the UIDesigner mockup (FORGEOS-UID002). Display full ticket metadata (ID, title, type, priority, stage, claimed_by, machine, operator, lease_expiry), acceptance criteria as a checklist, file paths list, and tabbed content for History (timeline of state transitions) and Dependencies (upstream depends_on and downstream dependents). Data from the ticket detail and history API endpoints.

### Acceptance Criteria

- [ ] Ticket detail page loads ticket data by ID from URL parameter
- [ ] TicketMetadata panel displays all ticket fields with appropriate formatting
- [ ] Acceptance criteria rendered as a read-only checklist
- [ ] File paths displayed as a list with monospace font
- [ ] HistoryTimeline shows chronological events with agent name, action, timestamp, and details
- [ ] DependencyTree shows upstream (depends_on) tickets as clickable links
- [ ] DependencyTree shows downstream (depended_by) tickets as clickable links
- [ ] 404 page displayed for non-existent ticket IDs

---

## FORGEOS-FE005: Implement Interactive Dependency Graph

**Type:** frontend
**Priority:** high
**Dependencies:** FORGEOS-FE002, FORGEOS-UID003
**Files:** dashboard/src/app/graph/page.tsx, dashboard/src/components/graph/DependencyGraph.tsx, dashboard/src/components/graph/GraphControls.tsx, dashboard/src/lib/graph/layout.ts
**Tags:** frontend, dashboard, dag, graph, visualization, interactive, phase4, BLK-10-02

### Description

Implement the interactive dependency graph (DAG visualization) following the UIDesigner mockup (FORGEOS-UID003). Render all tickets as nodes in a directed acyclic graph with dependency edges. Nodes are color-coded by current stage. Support zoom, pan, fit-to-view, and click-to-navigate-to-detail. Use a graph rendering library (e.g., react-flow, d3-dag, or cytoscape.js). Replace the static `todo_visual.py --dot` output with this interactive view.

### Acceptance Criteria

- [ ] DAG visualization renders all tickets as nodes with dependency edges
- [ ] Nodes display ticket ID and abbreviated title, colored by stage
- [ ] Edges show directional arrows from dependency to dependent
- [ ] Zoom in/out via mouse wheel or pinch gesture
- [ ] Pan via mouse drag on empty canvas area
- [ ] Fit-to-view button scales and centers the entire graph
- [ ] Clicking a node navigates to that ticket's detail page
- [ ] Graph layout algorithm produces readable, non-overlapping node placement

---

## FORGEOS-FE006: Implement WebSocket Real-Time Updates

**Type:** frontend
**Priority:** high
**Dependencies:** FORGEOS-FE003, FORGEOS-BE039
**Files:** dashboard/src/lib/api/websocket.ts, dashboard/src/hooks/useTicketStream.ts, dashboard/src/components/pipeline/PipelineBoard.tsx
**Tags:** frontend, dashboard, websocket, realtime, streaming, phase4, BLK-10-02

### Description

Implement WebSocket connectivity for real-time ticket state updates following BLK-06-03 output. Connect to the `/ws/tickets` WebSocket endpoint (FORGEOS-BE039) to receive live state change events. Create a React hook (`useTicketStream`) that manages the WebSocket connection lifecycle and dispatches updates to the pipeline board and ticket detail views. Handle reconnection on disconnect with exponential backoff.

### Acceptance Criteria

- [ ] WebSocket client connects to /ws/tickets endpoint on dashboard load
- [ ] useTicketStream hook provides connection status (connected, connecting, disconnected)
- [ ] Ticket state change events update the pipeline board in real-time (card moves between columns)
- [ ] Ticket detail view updates in real-time when viewing a ticket that changes state
- [ ] Automatic reconnection with exponential backoff (initial 1s, max 30s)
- [ ] Connection status indicator visible in dashboard shell (green dot = connected)
- [ ] WebSocket disconnection does not crash the application; falls back to manual refresh

---

## FORGEOS-FE007: Implement Global Search

**Type:** frontend
**Priority:** medium
**Dependencies:** FORGEOS-FE002, FORGEOS-UID003
**Files:** dashboard/src/components/search/SearchBar.tsx, dashboard/src/components/search/SearchResults.tsx, dashboard/src/app/search/page.tsx
**Tags:** frontend, dashboard, search, filter, typeahead, phase4, BLK-10-02

### Description

Implement the global search interface following the UIDesigner mockup (FORGEOS-UID003). Build a search bar with type-ahead suggestions as the user types. Support filtering by stage, type, priority, and agent via filter chips. Display search results as a list of ticket cards with highlighted matching terms. Support search by ticket ID, title keyword, and file path.

### Acceptance Criteria

- [ ] Search bar component in the top bar with keyboard shortcut (Cmd/Ctrl+K) to focus
- [ ] Type-ahead suggestions appear after 2+ characters with debounced API calls (300ms)
- [ ] Filter chips for stage, type, priority allow narrowing results
- [ ] Search results page displays matching tickets as TicketCard components
- [ ] Matching terms highlighted in search results
- [ ] Recent searches stored in localStorage (last 5 searches)
- [ ] Empty search state shows helpful placeholder text

---

## BLK-10-03: Dashboard Operations & Advanced Features

---

## FORGEOS-FE008: Implement Active Claims Monitor

**Type:** frontend
**Priority:** high
**Dependencies:** FORGEOS-FE006, FORGEOS-UID004
**Files:** dashboard/src/app/claims/page.tsx, dashboard/src/components/claims/ClaimsTable.tsx, dashboard/src/components/claims/LeaseCountdown.tsx
**Tags:** frontend, dashboard, claims, monitor, lease, countdown, phase4, BLK-10-03

### Description

Implement the active claims monitor view following the UIDesigner mockup (FORGEOS-UID004). Display a table of all currently claimed tickets with columns for ticket ID, agent, machine, operator, stage, and a real-time lease countdown timer. The countdown timer shows remaining lease time, turns yellow at <5 minutes, and red at <1 minute. Data updates in real-time via WebSocket. Support sorting by lease remaining and filtering by agent/machine.

### Acceptance Criteria

- [ ] Claims table displays all actively claimed tickets with agent, machine, operator, and stage
- [ ] LeaseCountdown component shows remaining time in MM:SS format
- [ ] Countdown turns yellow (warning) when lease remaining < 5 minutes
- [ ] Countdown turns red (critical) when lease remaining < 1 minute
- [ ] Expired leases shown with "EXPIRED" badge in red
- [ ] Table sortable by lease remaining (ascending to show expiring soonest first)
- [ ] Real-time updates via WebSocket connection from FORGEOS-FE006

---

## FORGEOS-FE009: Implement Operator Workbench Actions

**Type:** frontend
**Priority:** high
**Dependencies:** FORGEOS-FE008, FORGEOS-BE036, FORGEOS-BE037, FORGEOS-BE055
**Files:** dashboard/src/components/operator/OperatorActions.tsx, dashboard/src/components/operator/ConfirmationModal.tsx, dashboard/src/lib/api/operations.ts
**Tags:** frontend, dashboard, operator, actions, claim, release, advance, phase4, BLK-10-03

### Description

Implement authenticated operator action controls following the UIDesigner mockup (FORGEOS-UID004). Add action buttons for Claim, Release, Advance, and Force-Release operations. Each action calls the corresponding REST endpoint (FORGEOS-BE036 for claim, FORGEOS-BE037 for advance/rework). Destructive actions (force-release, force-advance) show a confirmation modal requiring explicit reason input. All actions require authentication via the auth system (FORGEOS-BE055 role-based restrictions).

### Acceptance Criteria

- [ ] Claim button triggers POST /api/tickets/:id/claim with operator credentials
- [ ] Release button triggers POST /api/tickets/:id/release with confirmation
- [ ] Advance button triggers POST /api/tickets/:id/advance with evidence input
- [ ] Force-Release button shows ConfirmationModal with reason text field before executing
- [ ] ConfirmationModal requires non-empty reason text and explicit confirm click
- [ ] Action responses display success toast or error message
- [ ] All action buttons disabled when user is not authenticated

---

## FORGEOS-FE010: Implement Multi-Machine Status View

**Type:** frontend
**Priority:** medium
**Dependencies:** FORGEOS-FE006, FORGEOS-UID004
**Files:** dashboard/src/app/machines/page.tsx, dashboard/src/components/machines/MachineCard.tsx, dashboard/src/components/machines/AgentList.tsx
**Tags:** frontend, dashboard, machines, multiMachine, status, agents, phase4, BLK-10-03

### Description

Implement the multi-machine status view following the UIDesigner mockup (FORGEOS-UID004). Display a grid of machine cards showing hostname, online/offline status indicator, last heartbeat timestamp, and list of currently running agents. Each machine card expands to show the agent-to-ticket mapping. Data sourced from the pipeline overview and claims data, updated in real-time via WebSocket.

### Acceptance Criteria

- [ ] Machine cards display hostname, status indicator (green=online, gray=offline), and last heartbeat time
- [ ] Each machine card shows a list of currently running agents with their claimed tickets
- [ ] Status determined by lease heartbeat recency (online if heartbeat within last 10 minutes)
- [ ] Cards arranged in responsive grid layout (3 columns desktop, 2 tablet, 1 mobile)
- [ ] Clicking an agent name navigates to the claims view filtered by that agent
- [ ] Real-time updates reflect when machines come online or go offline
- [ ] Empty state message when no machines are currently active

---

## FORGEOS-FE011: Implement System Health Dashboard

**Type:** frontend
**Priority:** medium
**Dependencies:** FORGEOS-FE001, FORGEOS-BE038, FORGEOS-UID005
**Files:** dashboard/src/app/health/page.tsx, dashboard/src/components/health/HealthPanel.tsx, dashboard/src/components/health/MetricCard.tsx, dashboard/src/components/health/StatusIndicator.tsx
**Tags:** frontend, dashboard, health, monitoring, metrics, status, phase4, BLK-10-03

### Description

Implement the system health dashboard view following the UIDesigner mockup (FORGEOS-UID005). Display four health panels: Database (connection pool, query latency), MCP Server (uptime, connected agents, requests/minute), Webhooks (delivery rate, queue depth, failures), and Alerts (recent system warnings). Data sourced from the /api/health endpoint (FORGEOS-BE038). Each panel uses StatusIndicator (green/yellow/red) and MetricCard components.

### Acceptance Criteria

- [ ] Database panel shows connection pool utilization gauge and query latency metrics
- [ ] MCP Server panel shows uptime, connected agent count, and request rate
- [ ] Webhook panel shows delivery success rate, pending queue count, and failure count
- [ ] Alerts panel shows recent system warnings in chronological order
- [ ] StatusIndicator component renders green (healthy), yellow (degraded), or red (critical) dot
- [ ] MetricCard shows label, current value, and change direction indicator (up/down arrow)
- [ ] Health data refreshes every 30 seconds automatically

---

## FORGEOS-FE012: Implement Dashboard Filtering and Sorting

**Type:** frontend
**Priority:** medium
**Dependencies:** FORGEOS-FE003, FORGEOS-FE004
**Files:** dashboard/src/components/filters/FilterBar.tsx, dashboard/src/components/filters/FilterChip.tsx, dashboard/src/hooks/useFilters.ts
**Tags:** frontend, dashboard, filters, sorting, state, phase4, BLK-10-03

### Description

Implement comprehensive filtering and sorting controls for the dashboard views. Build a shared FilterBar component with filter chips for stage, type, priority, operator, machine, and agent. Filters apply to the pipeline view, search results, and claims monitor. Implement URL-based filter state so filter configurations are bookmarkable and shareable. Support sort options on list views (by priority, creation date, last updated).

### Acceptance Criteria

- [ ] FilterBar renders selectable filter chips for stage, type, priority, operator, machine, agent
- [ ] Selecting a filter chip immediately updates the displayed ticket list
- [ ] Multiple filters combine with AND logic (e.g., stage=QA AND type=backend)
- [ ] Active filters reflected in URL query parameters for bookmarkability
- [ ] Sort dropdown with options: priority (high first), created date, last updated, ticket ID
- [ ] useFilters hook manages filter state and syncs with URL
- [ ] Clear all filters button resets to default unfiltered view
