# Dashboard Tickets

## TASK-FOS-05-001: Dashboard HTML/CSS Layout with Pipeline Visualization

**Type:** frontend
**Priority:** high
**Dependencies:** TASK-FOS-05-002, TASK-FOS-03-010
**Files:** forgeos-server/src/dashboard/index.html, forgeos-server/src/dashboard/css/style.css

### Description
Build the main dashboard page as a vanilla HTML + CSS layout (no frontend framework, no build step) as specified in Architecture §5 and PRD FR-22/FR-27. The page includes a Kanban-style pipeline board with columns for each active SDLC stage (READY, BACKEND, FRONTEND, QA, SECURITY, CI, DOCUMENTATION, VALIDATION). Each column displays ticket cards showing: ticket_id, title, type badge, priority indicator, claimed_by agent name, and lease countdown timer. Cards are color-coded by status (unclaimed=blue, claimed=yellow, expiring=orange, expired=red). The layout includes a header with system health summary, navigation tabs for Pipeline/Graph/Machines views, and filter controls for stage, type, priority, machine, and agent. Responsive layout, desktop-first. D3.js loaded via CDN script tag.

### Acceptance Criteria
- [ ] Single HTML file served as static content by the Express server at GET /dashboard
- [ ] Kanban board with 8+ stage columns; each column shows a ticket count badge
- [ ] Ticket cards display: ticket_id, title (truncated), type badge (color-coded), priority dot, claimed_by, lease countdown
- [ ] Cards color-coded: unclaimed blue (#3B82F6), claimed yellow (#EAB308), expiring (<5min) orange (#F97316), expired red (#EF4444)
- [ ] Filter bar with dropdowns for stage, type, priority, machine, agent; filters update the board dynamically
- [ ] Navigation tabs: Pipeline (active by default), Graph, Machines, Admin
- [ ] Header shows: total tickets, active claims count, expired leases count, system uptime
- [ ] CSS in separate style.css file; no inline styles except for dynamic values
- [ ] Responsive layout: columns wrap on smaller screens; minimum readable at 1024px width
- [ ] D3.js v7 loaded via CDN (<script src="https://d3js.org/d3.v7.min.js">)
- [ ] WCAG 2.2 AA compliance: 4.5:1 color contrast, ARIA labels on interactive elements, keyboard navigation

---

## TASK-FOS-05-002: SSE Endpoint for Real-Time Updates

**Type:** backend
**Priority:** high
**Dependencies:** TASK-FOS-02-001, TASK-FOS-01-002
**Files:** forgeos-server/src/api/routes/events.ts, forgeos-server/src/api/routes/tickets.ts, forgeos-server/src/api/routes/stages.ts, forgeos-server/src/api/index.ts

### Description
Implement Server-Sent Events (SSE) endpoint and REST API routes for the dashboard. SSE endpoint (GET /api/events) uses PostgreSQL's LISTEN/NOTIFY on the 'ticket_changes' channel (triggered by the notify_ticket_change function). When a notification arrives, it broadcasts the event to all connected SSE clients. Also implement REST endpoints: GET /api/tickets (paginated, filterable list), GET /api/tickets/:id (full ticket detail), GET /api/tickets/:id/history (event timeline), GET /api/stages (pipeline overview with counts per stage). All REST endpoints require authentication; SSE endpoint optionally authenticated.

### Acceptance Criteria
- [ ] GET /api/events returns text/event-stream with proper SSE headers (Content-Type, Cache-Control, Connection)
- [ ] SSE endpoint listens on PostgreSQL 'ticket_changes' NOTIFY channel and broadcasts to all connected clients
- [ ] SSE events have format: event: ticket-update\ndata: {JSON}\n\n with < 1 second latency
- [ ] Initial SSE connection sends a snapshot of current system state as first event
- [ ] GET /api/tickets returns paginated JSON with filters: stage, type, status, claimed_by, priority; supports limit/offset
- [ ] GET /api/tickets/:id returns full ticket object including depends_on resolved status
- [ ] GET /api/tickets/:id/history returns ordered array of events from events table
- [ ] GET /api/stages returns {stage: {count, claimed, ready}} for each active stage
- [ ] SSE handles client disconnection gracefully (cleans up listener on req.close)
- [ ] REST endpoints return proper HTTP status codes: 200, 404 (not found), 401 (unauth), 500

---

## TASK-FOS-05-003: Dependency Graph D3.js Visualization

**Type:** frontend
**Priority:** medium
**Dependencies:** TASK-FOS-05-001, TASK-FOS-03-007
**Files:** forgeos-server/src/dashboard/js/graph.js

### Description
Build the interactive dependency graph visualization using D3.js force-directed layout as specified in PRD FR-23. Fetches the dependency DAG from the tickets.graph API endpoint (or REST /api/tickets with depends_on data). Renders tickets as nodes with color-coding by status (DONE=green, READY=blue, BLOCKED=red, IN_PROGRESS/CLAIMED=yellow). Edges show dependency direction (arrow from dependency to dependent). Nodes sized by priority (critical=largest). Critical path visually highlighted (thicker edges, glowing nodes). Interactive features: click node to view ticket detail panel, zoom/pan with mouse wheel and drag, search by ticket ID to focus a node, tooltip on hover showing ticket summary. Respects prefers-reduced-motion for animations.

### Acceptance Criteria
- [ ] D3.js force-directed (or d3-dag) layout renders ticket dependency DAG
- [ ] Nodes colored by status: DONE=#22C55E, READY=#3B82F6, BLOCKED=#EF4444, CLAIMED=#EAB308, ESCALATED=#A855F7
- [ ] Nodes sized proportionally by priority: critical=24px, high=18px, medium=14px, low=10px radius
- [ ] Directed edges (arrows) from dependency → dependent ticket
- [ ] Critical path edges rendered with increased stroke-width and distinct color
- [ ] Click on node opens ticket detail panel (reuses ticket-detail component from dashboard)
- [ ] Zoom via scroll wheel; pan via click-and-drag on background
- [ ] Search input focuses and highlights matching ticket node by ID
- [ ] Graph updates in real-time when SSE ticket-update events arrive
- [ ] Respects prefers-reduced-motion: disables force simulation animation if set

---

## TASK-FOS-05-004: Dashboard JavaScript Logic

**Type:** frontend
**Priority:** high
**Dependencies:** TASK-FOS-05-001, TASK-FOS-05-002
**Files:** forgeos-server/src/dashboard/js/app.js, forgeos-server/src/dashboard/js/pipeline.js, forgeos-server/src/dashboard/js/admin.js

### Description
Implement the dashboard's JavaScript logic as vanilla JS (no framework). app.js initializes the SSE connection (EventSource), handles reconnection on disconnect, and dispatches events to view modules. pipeline.js renders and updates the Kanban pipeline board: fetches initial state from REST API, builds card DOM elements, updates cards on SSE events, manages lease countdown timers (updating every second), and implements filter logic. admin.js provides admin panel functionality: force-release button with confirmation dialog, machine status list with health indicators (active/stale/offline based on last_seen), and system health metrics display. All modules use event delegation for performance.

### Acceptance Criteria
- [ ] app.js creates EventSource connection to /api/events; auto-reconnects on disconnect with exponential backoff (1s, 2s, 4s, max 30s)
- [ ] app.js dispatches received SSE events to registered view handlers (pipeline, graph, admin)
- [ ] pipeline.js fetches initial ticket data from GET /api/tickets and renders Kanban board
- [ ] pipeline.js updates individual ticket cards on SSE ticket-update events without full re-render
- [ ] Lease countdown timers update every second; display format "MM:SS remaining" or "EXPIRED"
- [ ] Filter controls (stage, type, priority, machine, agent) filter displayed cards client-side
- [ ] admin.js: force-release button shows confirmation dialog before calling POST /api/tickets/:id/release?force=true
- [ ] admin.js: machine status section fetches from GET /api/admin/machines and shows health indicators
- [ ] admin.js: system health panel shows DB pool stats, server uptime, expired lease count from /health and /api/stages
- [ ] No external JavaScript dependencies (except D3.js via CDN for graph view)
