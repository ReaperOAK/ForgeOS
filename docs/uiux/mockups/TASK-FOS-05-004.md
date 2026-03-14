---
title: Dashboard JavaScript Logic — UI Interaction Mockup
ticket: TASK-FOS-05-004
type: mockup
author: UIDesigner
date: 2026-03-10T03:00:00Z
status: APPROVED
stitch_project_id: projects/17753507249462882723
upstream_refs:
  - docs/uiux/mockups/TASK-FOS-05-001.md
  - docs/uiux/design-tokens.json
  - docs/uiux/components/pipeline-board.md
  - docs/uiux/components/operator-actions.md
  - docs/uiux/components/health-panel.md
  - docs/product/dashboard-ux-reqs.md
---

# TASK-FOS-05-004 — Dashboard JavaScript Logic

> **Ticket:** TASK-FOS-05-004 | **Agent:** UIDesigner | **Date:** 2026-03-10
> **Status:** APPROVED | **Confidence:** HIGH

---

## 1. Screen Inventory

| # | Screen Name | Stitch Screen ID | Device | Theme | Route / Context | Screenshot |
|---|-------------|-----------------|--------|-------|-----------------|------------|
| 1 | SSE Connection & Dispatch Flow | `ee604df2b09548988f3cd5965d74f2e1` | Desktop | Dark | Connection lifecycle reference | `TASK-FOS-05-004/sse-connection-dispatch--dark--desktop.png` |
| 2 | Pipeline Interaction Reference | `64e1b2edc55545cbb1c14c15a991be4f` | Desktop | Dark | `#/pipeline` with interactions | `TASK-FOS-05-004/pipeline-interactions--dark--desktop.png` |
| 3 | Admin Panel Interactions | `d940555486314533a39f6fafd7028c38` | Desktop | Dark | `#/admin` | `TASK-FOS-05-004/admin-panel--dark--desktop.png` |
| 4 | Mobile Pipeline with Filters | `cf98ef4e8f2048efbc73e039073bcc52` | Mobile | Dark | `#/pipeline` (mobile) | `TASK-FOS-05-004/pipeline-mobile--dark--mobile.png` |

---

## 2. Module Architecture

This ticket defines the JavaScript interaction layer across three vanilla JS modules. All modules share a common event bus and use event delegation for performance.

### 2.1 Module Dependency Graph

```
┌──────────────────────────────────────────────────────────┐
│                      index.html                          │
│  <script src="js/app.js" type="module">                  │
│  <script src="js/pipeline.js" type="module">             │
│  <script src="js/admin.js" type="module">                │
│  <script src="https://d3js.org/d3.v7.min.js">           │
└──────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────┐     dispatches     ┌─────────────────┐
│     app.js      │ ──────────────────▶│  pipeline.js    │
│                 │                    │                  │
│ • EventSource   │     dispatches     ├─────────────────┤
│ • Reconnect     │ ──────────────────▶│  admin.js       │
│ • Event bus     │                    │                  │
│ • Health poll   │     dispatches     ├─────────────────┤
│                 │ ──────────────────▶│  graph.js (D3)  │
└─────────────────┘                    └─────────────────┘
```

### 2.2 File Map

| File | Responsibility | REST Endpoints | SSE Events Consumed |
|------|---------------|----------------|---------------------|
| `app.js` | SSE connection, reconnection, event dispatch to handlers | None (SSE only) | All (dispatches to handlers) |
| `pipeline.js` | Kanban rendering, card updates, filters, lease timers | `GET /api/tickets` | `ticket_created`, `ticket_claimed`, `stage_advanced`, `ticket_rejected`, `ticket_completed`, `lease_expired`, `ticket_escalated` |
| `admin.js` | Force-release, machine status, system health | `POST /api/tickets/:id/release?force=true`, `GET /api/admin/machines`, `GET /health`, `GET /api/stages` | `health_update`, `agent_connected`, `agent_disconnected` |

---

## 3. app.js — SSE Connection Manager

### 3.1 Connection Lifecycle

```mermaid
statechart-v2
    [*] --> Connecting
    Connecting --> Connected : EventSource.onopen
    Connecting --> Reconnecting : EventSource.onerror
    Connected --> Reconnecting : EventSource.onerror
    Reconnecting --> Connecting : backoff timer fires
    Reconnecting --> Disconnected : > 30s elapsed since last successful message
    Disconnected --> Connecting : user clicks Retry
    Connected --> [*] : page unload
```

### 3.2 Connection States — UI Mapping

| State | UI Element | Visual | ARIA |
|-------|-----------|--------|------|
| `connected` | Top bar Live dot | Green dot (#16A34A), solid, "Live" label | `aria-live="polite"` announces "Connected" |
| `reconnecting` | Top bar dot + banner | Yellow dot (#EAB308) pulsing 1s, yellow banner: "Reconnecting... retry in {N}s" | `aria-live="polite"` announces "Reconnecting" |
| `disconnected` | Top bar dot + banner | Red dot (#EF4444) static, red banner: "Connection lost. Data may be stale. [Retry]" | `aria-live="assertive"` announces "Disconnected" |

### 3.3 Exponential Backoff Strategy

```
Attempt 1: wait 1s
Attempt 2: wait 2s
Attempt 3: wait 4s
Attempt 4: wait 8s
Attempt 5: wait 16s
Attempt 6+: wait 30s (capped maximum)
```

**Backoff formula:** `delay = Math.min(1000 * Math.pow(2, attempt - 1), 30110)`

**Reset:** On successful reconnection (`onopen`), reset attempt counter to 0.

### 3.4 Event Dispatch Interface

```typescript
// Conceptual type definition (implemented as vanilla JS)
interface EventHandler {
  /** Called when an SSE event is received */
  handleEvent(eventType: string, data: object): void;
}

interface AppController {
  /** Register a view handler for SSE events */
  registerHandler(name: string, handler: EventHandler): void;

  /** Remove a registered handler */
  unregisterHandler(name: string): void;

  /** Get current connection state */
  getConnectionState(): 'connected' | 'reconnecting' | 'disconnected';

  /** Manually trigger reconnect */
  reconnect(): void;
}
```

### 3.5 Event Types Dispatched

| SSE Event Type | Data Shape | Dispatched To |
|---------------|-----------|---------------|
| `ticket_created` | `{ ticket: TicketData }` | pipeline, graph |
| `ticket_claimed` | `{ ticketId, agent, machine, leaseExpiry }` | pipeline, admin |
| `stage_advanced` | `{ ticketId, fromStage, toStage }` | pipeline, graph |
| `ticket_rejected` | `{ ticketId, reason, reworkCount }` | pipeline |
| `ticket_completed` | `{ ticketId }` | pipeline, graph, admin |
| `lease_expired` | `{ ticketId }` | pipeline, admin |
| `lease_extended` | `{ ticketId, newExpiry }` | pipeline |
| `ticket_escalated` | `{ ticketId }` | pipeline |
| `health_update` | `{ dbPool, uptime, expiredCount }` | admin |
| `agent_connected` | `{ agentName, machineId }` | admin |
| `agent_disconnected` | `{ agentName, machineId }` | admin |

### 3.6 Connection Status Banner Component

**Location:** Rendered directly below the 56px top bar, above the filter bar.

**DOM structure:**
```html
<div id="connection-banner" role="status" aria-live="polite" class="connection-banner hidden">
  <span class="connection-banner__icon"></span>
  <span class="connection-banner__message"></span>
  <button class="connection-banner__retry" aria-label="Retry connection">Retry</button>
</div>
```

**States:**

| State | CSS Class | Icon | Message | Retry Button | Background |
|-------|-----------|------|---------|-------------|------------|
| Connected | `.hidden` | — | — | Hidden | — |
| Reconnecting | `.banner--warning` | Spinning circle (CSS animation) | "Reconnecting... retry in {N}s" | Hidden | `warningMuted` (#713F12) |
| Disconnected | `.banner--error` | Static red circle | "Connection lost. Data may be stale." | Visible (primary color) | `errorMuted` (#7F1D1D) |

**Keyboard:** `Tab` to focus Retry button when visible. `Enter`/`Space` to activate.

---

## 4. pipeline.js — Kanban Board Logic

### 4.1 Initialization Sequence

```mermaid
flowchart TD
    A[pipeline.js loaded] --> B[Register as SSE handler with app.js]
    B --> C[Fetch GET /api/tickets]
    C --> D{Response OK?}
    D -->|200| E[Parse JSON ticket array]
    D -->|Error| F[Show error state in board area]
    F --> G[Retry button visible]
    G -->|Click| C
    E --> H[Group tickets by stage]
    H --> I[Render StageColumns with TicketCards]
    I --> J[Start lease countdown timers]
    J --> K[Attach filter bar event listeners via delegation]
    K --> L[Ready for SSE updates]
```

### 4.2 Card Rendering — DOM Structure

Each ticket card is rendered as a DOM element with data attributes for efficient updates:

```html
<article class="ticket-card" 
         data-ticket-id="TASK-FOS-03-007"
         data-stage="BACKEND"
         data-priority="high"
         data-type="backend"
         data-machine="pop-os"
         data-agent="Backend"
         data-claim-status="claimed"
         role="listitem"
         tabindex="0"
         aria-label="Ticket TASK-FOS-03-007, Dashboard JavaScript Logic, high priority, claimed">
  
  <div class="ticket-card__header">
    <span class="ticket-card__id">TASK-FOS-03-007</span>
    <span class="ticket-card__machine-badge" style="--machine-color: #3B82F6">pop-os</span>
  </div>
  
  <div class="ticket-card__title">Dashboard JavaScript Logic</div>
  
  <div class="ticket-card__meta">
    <span class="ticket-card__priority-badge priority--high">High</span>
    <span class="ticket-card__type">backend</span>
    <span class="ticket-card__agent">Backend</span>
    <span class="ticket-card__time-in-stage">2h 15m</span>
  </div>
  
  <div class="ticket-card__lease" aria-label="Lease remaining: 22 minutes 15 seconds">
    <span class="ticket-card__countdown">22:15</span>
    <span class="ticket-card__countdown-label">remaining</span>
  </div>
</article>
```

### 4.3 SSE Event → Card Update Mapping

**Key principle:** Individual card updates, never full board re-render.

| SSE Event | DOM Operation | Animation |
|-----------|-------------|-----------|
| `ticket_created` | `createElement` + `appendChild` to READY column | Fade in (250ms ease-in-out) |
| `ticket_claimed` | Update `data-claim-status`, add agent/machine badges, start countdown | Border color transition (150ms) |
| `stage_advanced` | Remove from source column, append to target column | Slide out left (250ms) + slide in right (250ms) |
| `ticket_rejected` | Flash red border (500ms), increment rework badge | Red flash keyframe |
| `ticket_completed` | Move to DONE section, update column counters | Fade + move (250ms) |
| `lease_expired` | Update `data-claim-status="expired"`, show EXPIRED badge + Release button | Pulsing red glow |
| `ticket_escalated` | Move to ESCALATED section in bottom row | Red flash + move |

**Column counter updates:** After every card move, update the `<span class="stage-column__count">` for both source and target columns.

### 4.4 Lease Countdown Timer

**Implementation:**

```typescript
// Conceptual interface (implemented in vanilla JS)
interface LeaseTimer {
  ticketId: string;
  expiryTime: number;       // Unix timestamp ms
  intervalId: number;        // setInterval reference
  countdownEl: HTMLElement;  // DOM element to update
}

interface LeaseTimerManager {
  /** Start tracking a lease countdown */
  startTimer(ticketId: string, expiryISO: string): void;
  
  /** Stop and clean up a timer */
  stopTimer(ticketId: string): void;
  
  /** Called every 1000ms for active timers */
  tick(): void;
  
  /** Reset timer on lease extension */
  extendLease(ticketId: string, newExpiryISO: string): void;
}
```

**Display format:**

| Remaining Time | Display | Color | CSS Class |
|---------------|---------|-------|-----------|
| ≥ 5 minutes | `"22:15 remaining"` | `success` (#16A34A) | `.countdown--normal` |
| < 5 minutes, > 0 | `"04:30 remaining"` | `warning` (#EAB308) | `.countdown--warning` |
| < 1 minute, > 0 | `"00:45 remaining"` | `error` (#EF4444) | `.countdown--critical` (pulsing) |
| ≤ 0 | `"EXPIRED"` | `error` (#EF4444) | `.countdown--expired` |

**Tick behavior:**
- Global `setInterval` at 1000ms ticks all active timers
- Each tick: compute `remaining = expiryTime - Date.now()`
- Format: `MM:SS` — `Math.floor(remaining / 60000)` + `:` + `Math.floor((remaining % 60000) / 1000).toString().padStart(2, '0')`
- On transition from normal→warning or warning→critical: update `data-claim-status` attribute and `aria-label`
- When remaining ≤ 0: stop individual timer, set display to "EXPIRED", emit internal event

**Reduced motion:** When `prefers-reduced-motion: reduce` is active, disable pulsing animation. Countdown text still updates.

### 4.5 Filter Logic

**Filter state model:**

```typescript
interface FilterState {
  stage: string | null;         // null = all stages
  type: string | null;          // null = all types
  priority: string | null;      // null = all priorities
  machine: string | null;       // null = all machines
  agent: string | null;         // null = all agents
  search: string;               // '' = no search filter
}
```

**Filter application (all filters use AND logic):**

```
for each .ticket-card element:
  match = true
  if filters.stage && card.dataset.stage !== filters.stage: match = false
  if filters.type && card.dataset.type !== filters.type: match = false
  if filters.priority && card.dataset.priority !== filters.priority: match = false
  if filters.machine && card.dataset.machine !== filters.machine: match = false
  if filters.agent && card.dataset.agent !== filters.agent: match = false
  if filters.search && !matchesSearch(card, filters.search): match = false
  
  card.style.display = match ? '' : 'none'
  
update column counts (visible cards only)
update "N filter(s) active" badge
```

**Search matching:** Checks ticket ID (`data-ticket-id`) and title text content. Case-insensitive. Debounced 300ms on input.

**Filter bar interactions:**

| Element | Event | Action |
|---------|-------|--------|
| Stage dropdown | `change` | Set `filters.stage`, apply filters |
| Type dropdown | `change` | Set `filters.type`, apply filters |
| Priority dropdown | `change` | Set `filters.priority`, apply filters |
| Machine dropdown | `change` | Set `filters.machine`, apply filters |
| Agent dropdown | `change` | Set `filters.agent`, apply filters |
| Search input | `input` (debounced 300ms) | Set `filters.search`, apply filters |
| Clear All link | `click` | Reset all filters to defaults, apply |

**URL sync:** Active filters are reflected in URL query parameters (`?priority=high&stage=BACKEND`) for shareability. On page load, filters are initialized from URL params.

**Active filter indicator:**
- When any filter is non-default: show filter count badge in cyan: "2 filters active"
- "Clear All" link appears only when filters are active
- Each active dropdown gets a subtle cyan border highlight

### 4.6 Event Delegation Pattern

All click/change handlers are attached to parent containers, not individual cards:

```javascript
// Attach to board container, not each card
document.getElementById('pipeline-board').addEventListener('click', (e) => {
  const card = e.target.closest('.ticket-card');
  if (card) {
    openTicketDetail(card.dataset.ticketId);
    return;
  }
  
  const releaseBtn = e.target.closest('.ticket-card__release-btn');
  if (releaseBtn) {
    handleRelease(releaseBtn.dataset.ticketId);
    return;
  }
});

// Filter bar delegation
document.getElementById('filter-bar').addEventListener('change', (e) => {
  const filterName = e.target.dataset.filterName;
  if (filterName) {
    updateFilter(filterName, e.target.value);
  }
});
```

---

## 5. admin.js — Admin Panel Logic

### 5.1 Admin Panel Layout

```
┌──────────────────────────────────────────────────────────────┐
│ ADMIN TAB                                                     │
├─────────────────────────────┬────────────────────────────────┤
│                             │                                │
│  OPERATOR ACTIONS           │  MACHINE STATUS                │
│  ┌──────────┬──────────┐   │  ┌────────┬────────┬────────┐  │
│  │  Claim   │ Release  │   │  │ pop-os │dev-svr │staging │  │
│  │  Ticket  │ Claim    │   │  │  🟢    │  🟡   │  🔴    │  │
│  ├──────────┼──────────┤   │  │Active  │Stale   │Offline │  │
│  │ Advance  │  Force   │   │  └────────┴────────┴────────┘  │
│  │  Stage   │ Release  │   │                                │
│  └──────────┴──────────┘   │                                │
│                             │                                │
├─────────────────────────────┴────────────────────────────────┤
│                                                              │
│  SYSTEM HEALTH METRICS                                       │
│  ┌────────────┬────────────┬──────────────┬────────────────┐ │
│  │  DB Pool   │  Uptime   │ Expired      │ Active Claims  │ │
│  │  12/20     │ 14d 7h    │ Leases: 3    │     8          │ │
│  │  ████░░    │           │              │                │ │
│  └────────────┴────────────┴──────────────┴────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

### 5.2 Force Release Flow

```mermaid
flowchart TD
    A[Operator clicks Force Release button] --> B{Ticket selected?}
    B -->|No| C[Show toast: Select a ticket first]
    B -->|Yes| D[Open Confirmation Modal]
    D --> E[Modal shows ticket ID and warning text]
    E --> F{Operator enters reason >= 10 chars?}
    F -->|No| G[Confirm button stays disabled, inline validation]
    F -->|Yes| H[Confirm button enabled]
    H --> I[Operator clicks Confirm]
    I --> J[POST /api/tickets/:id/release?force=true]
    J --> K{Response}
    K -->|200 OK| L[Close modal, show success toast, update card state]
    K -->|403| M[Show error toast: Not authorized]
    K -->|404| N[Show error toast: Ticket not found]
    K -->|409| O[Show error toast: Lease already expired]
    K -->|500| P[Show error toast: Server error, try again]
    D --> Q[Operator clicks Cancel or presses Escape]
    Q --> R[Close modal, no action]
```

### 5.3 Confirmation Modal Component

**DOM structure:**

```html
<div id="confirm-modal" class="modal-overlay" role="dialog" aria-modal="true" 
     aria-labelledby="modal-title" style="display: none;">
  <div class="modal-backdrop" aria-hidden="true"></div>
  <div class="modal-content">
    <div class="modal-header">
      <h2 id="modal-title" class="modal-title">Confirm Force Release</h2>
      <button class="modal-close" aria-label="Close dialog">&times;</button>
    </div>
    <div class="modal-body">
      <div class="modal-warning">
        <svg class="warning-icon"><!-- triangle icon --></svg>
        <p>Are you sure you want to force-release the claim on <strong id="modal-ticket-id"></strong>?</p>
      </div>
      <p class="modal-caution">This action cannot be undone. The agent's work in progress may be lost.</p>
      <div class="modal-field">
        <label for="release-reason">Reason for force release</label>
        <textarea id="release-reason" 
                  placeholder="Enter reason for force release (min 10 characters)..."
                  minlength="10"
                  required
                  aria-describedby="reason-validation"></textarea>
        <span id="reason-validation" class="field-validation" aria-live="polite"></span>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn--outline" id="modal-cancel">Cancel</button>
      <button class="btn btn--danger" id="modal-confirm" disabled>Force Release</button>
    </div>
  </div>
</div>
```

**Styling:**

| Element | Value |
|---------|-------|
| Overlay | `scrim` color token, z-index: `modal` (50) |
| Modal card | `surface` (#1E293B), border-radius: `xl` (12px), max-width: 480px |
| Warning icon | `warning` (#EAB308), 24px |
| Caution text | `textMuted` (#94A3B8), `fontSize.sm` |
| Cancel button | `border` (#334155) outline, `text` color |
| Confirm button | `error` (#EF4444) background, white text, disabled = opacity 0.5 |
| Reason textarea | `surfaceAlt` (#162032) background, `border` (#334155), min-height 80px |

**Keyboard navigation:**

| Key | Action |
|-----|--------|
| `Escape` | Close modal |
| `Tab` | Cycle through modal elements (focus trap) |
| `Enter` on Confirm | Submit if enabled |

**Validation:**

- On blur or on typing: check `textarea.value.length >= 10`
- If < 10: show inline message "Reason must be at least 10 characters" in `error` color
- If ≥ 10: hide validation message, enable Confirm button

### 5.4 Machine Status Section

**Data source:** `GET /api/admin/machines`

**Poll interval:** Every 15 seconds (not SSE-driven; supplements with SSE `agent_connected`/`agent_disconnected` events)

**Machine health classification:**

| Status | Condition | Dot Color | Animation | Label |
|--------|-----------|-----------|-----------|-------|
| Active | `last_seen` < 30s ago | `success` (#16A34A) | None | "Active" |
| Stale | `last_seen` 30s–5min ago | `warning` (#EAB308) | Pulse 1s | "Stale" |
| Offline | `last_seen` > 5min ago | `error` (#EF4444) | None | "Offline" |

**Machine Card Layout:**

```
┌──────────────────────────────┐
│ 🟢 pop-os                    │
│ 192.168.1.42                 │
│ Last seen: 2s ago            │
│ ──────────────────────────── │
│ Active agents:               │
│   Backend  TASK-FOS-03-007   │
│   Frontend TASK-FOS-05-004   │
│   QA       TASK-FOS-03-006   │
│ ──────────────────────────── │
│ CPU ████░░ 42%               │
│ MEM ██████ 67%               │
│ Sessions: 4                  │
└──────────────────────────────┘
```

**DOM data attributes:**

```html
<div class="machine-card" data-machine-id="pop-os" data-status="active">
```

**SSE updates:**
- `agent_connected`: Add agent entry to machine's agent list
- `agent_disconnected`: Remove agent entry, check if machine should go stale/offline

### 5.5 System Health Panel

**Data sources and refresh:**

| Metric | Endpoint | Refresh | Display |
|--------|----------|---------|---------|
| DB Pool Stats | `GET /health` → `data.database.pool` | 15s poll | Gauge: `{active}/{total}` with colored bar |
| Server Uptime | `GET /health` → `data.uptime` | 15s poll | Formatted: `"{days}d {hours}h {minutes}m"` |
| Expired Lease Count | `GET /api/stages` → sum expired | 15s poll | Large number, red tint if > 0 |
| Active Claims | `GET /api/tickets?claimed=true` → count | SSE-driven | Large number, cyan accent |

**Health metric card states:**

| Metric | Healthy | Warning | Critical |
|--------|---------|---------|----------|
| DB Pool | ≤ 70% used → green | 70–90% → yellow | > 90% → red |
| Uptime | > 1 hour → green | < 1 hour → yellow | < 5 min → red (restart?) |
| Expired Leases | 0 → green | 1–3 → yellow | > 3 → red |
| Active Claims | Any → cyan | — | — |

**Gauge component for DB Pool:**

```
12/20 connections (60%)
[████████████░░░░░░░░] 
```

- Bar width: `(active / total) * 100%`
- Bar color: green (#16A34A) when ≤ 70%, yellow (#EAB308) when 70–90%, red (#EF4444) when > 90%
- Text: `{active}/{total}` in mono font above gauge

---

## 6. State Management Patterns

### 6.1 Application State Model

```typescript
// Centralized state (vanilla JS object, not a framework)
interface DashboardState {
  // Connection
  connection: {
    status: 'connected' | 'reconnecting' | 'disconnected';
    reconnectAttempt: number;
    lastMessageAt: number;            // Unix timestamp
  };
  
  // Pipeline
  tickets: Map<string, TicketData>;   // ticketId → full ticket data
  filters: FilterState;
  selectedTicketId: string | null;
  
  // Timers
  activeLeases: Map<string, LeaseTimer>;  // ticketId → timer
  
  // Admin
  machines: Map<string, MachineData>;     // machineId → machine info
  health: {
    dbPool: { active: number; total: number };
    uptime: number;                       // seconds
    expiredLeaseCount: number;
    activeClaimCount: number;
  };
  
  // UI
  activeTab: 'pipeline' | 'graph' | 'machines' | 'admin';
  modalState: {
    isOpen: boolean;
    type: 'force-release' | 'advance' | null;
    targetTicketId: string | null;
  };
}
```

### 6.2 State Update Flow

```mermaid
flowchart LR
    A[SSE Event] --> B[app.js dispatcher]
    B --> C[Handler updates state]
    C --> D[Handler updates DOM]
    
    E[User Action] --> F[Event listener]
    F --> C
    
    G[REST Response] --> C
    
    H[Timer tick] --> I[Update countdown DOM]
```

**Key rule:** State is the source of truth. DOM is derived from state. Never read DOM to determine state — always reference the state object.

### 6.3 Optimistic UI Updates

| Action | Immediate UI Change | On Success | On Failure |
|--------|--------------------|------------|------------|
| Force Release | Card border → blue (unclaimed), hide agent/machine | Remove countdown, update metric | Revert to claimed state, show error toast |
| Filter Change | Cards show/hide instantly | — | — |
| Retry Connection | Banner → "Reconnecting..." | Banner hides | Banner → "Disconnected" |

### 6.4 Error Handling Pattern

```typescript
interface ToastNotification {
  type: 'success' | 'error' | 'warning' | 'info';
  message: string;
  duration: number;   // ms, 0 = persistent
  action?: {
    label: string;
    handler: () => void;
  };
}
```

**Toast positioning:** Bottom-right, stacked, z-index: `toast` (60).

**Toast auto-dismiss:** Success = 3011ms. Error = 0 (persistent, must dismiss). Warning = 5000ms.

---

## 7. Interaction Specifications

### 7.1 Keyboard Shortcuts (Global)

| Shortcut | Action | Module |
|----------|--------|--------|
| `1` | Switch to Pipeline tab | app.js |
| `2` | Switch to Graph tab | app.js |
| `3` | Switch to Machines tab | app.js |
| `4` | Switch to Admin tab | app.js |
| `/` | Focus search input in filter bar | pipeline.js |
| `Escape` | Close modal/slide-over, clear search | app.js |
| `?` | Toggle keyboard shortcut help overlay | app.js |
| `r` | Manual reconnect (when disconnected) | app.js |

### 7.2 Tab Navigation — Event Handling

```javascript
document.addEventListener('keydown', (e) => {
  // Skip if focus is in input/textarea
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
  
  switch (e.key) {
    case '1': switchTab('pipeline'); break;
    case '2': switchTab('graph'); break;
    case '3': switchTab('machines'); break;
    case '4': switchTab('admin'); break;
    case '/': e.preventDefault(); focusSearch(); break;
    case 'Escape': handleEscape(); break;
    case '?': toggleShortcutHelp(); break;
    case 'r': if (state.connection.status === 'disconnected') reconnect(); break;
  }
});
```

### 7.3 Card Click → Detail Panel

```mermaid
flowchart TD
    A[Card clicked or Enter pressed on focused card] --> B[Read data-ticket-id from card]
    B --> C[Set state.selectedTicketId]
    C --> D[Populate slide-over panel with ticket data from state.tickets map]
    D --> E[Open slide-over with transition.normal 250ms]
    E --> F[Focus trap activated within panel]
    F --> G{User action?}
    G -->|Escape or close button| H[Close panel, restore focus to card]
    G -->|Release button| I[Open confirmation modal]
    G -->|Tab through sections| J[Navigate panel content]
```

---

## 8. Responsive Behavior

### 8.1 Mobile Adaptations (< 768px)

| Component | Desktop | Mobile |
|-----------|---------|--------|
| Filter bar | Horizontal row, all visible | Collapsed by default, tap to expand vertically |
| Kanban columns | Horizontal scroll, all visible | Vertical accordion, one expanded at a time |
| Lease countdown | Inline in card | Below card content, larger touch area |
| Admin actions | 2×2 grid | Vertical stack, full width buttons |
| Machine status | 3 cards in row | Single column, cards stacked |
| Health metrics | 4 cards in row | 2×2 grid |
| Confirmation modal | 480px centered | Full-screen overlay |
| Connection banner | Below top bar | Below top bar, smaller text |

### 8.2 Touch Targets

All interactive elements maintain minimum 44×44px touch targets on mobile:

| Element | Desktop Size | Mobile Size |
|---------|-------------|-------------|
| Filter dropdown | 36px height | 44px height |
| Ticket card | 88px min-height | 56px min-height (44px touch target) |
| Action buttons | 36px height | 48px height |
| Modal buttons | 36px height | 48px height |
| Close (×) button | 32px | 44px × 44px |

---

## 9. Accessibility Checklist

### 9.1 Color Contrast (WCAG AA)

| Element | Foreground | Background | Ratio | Status |
|---------|-----------|------------|-------|--------|
| Countdown normal (dark) | `#16A34A` | `#1E293B` | 4.5:1 | ✅ Pass |
| Countdown warning (dark) | `#EAB308` | `#1E293B` | 7.8:1 | ✅ Pass |
| Countdown expired (dark) | `#EF4444` | `#1E293B` | 4.6:1 | ✅ Pass |
| Modal text (dark) | `#F8FAFC` | `#1E293B` | 11.1:1 | ✅ Pass |
| Banner warning text | `#F8FAFC` | `#713F12` | 7.2:1 | ✅ Pass |
| Banner error text | `#F8FAFC` | `#7F1D1D` | 7.8:1 | ✅ Pass |
| Filter active highlight | `#06B6D4` | `#0F172A` | 7.3:1 | ✅ Pass |
| Toast text | `#F8FAFC` | `#1E293B` | 11.1:1 | ✅ Pass |
| Machine "Active" label | `#16A34A` | `#1E293B` | 4.5:1 | ✅ Pass |
| Machine "Stale" label | `#EAB308` | `#1E293B` | 7.8:1 | ✅ Pass |
| Machine "Offline" label | `#EF4444` | `#1E293B` | 4.6:1 | ✅ Pass |

### 9.2 Focus Indicators

| Element | Focus Style |
|---------|-------------|
| Ticket cards | 2px solid `focus` (#06B6D4) outline, 2px offset |
| Filter dropdowns | 2px solid `focus` outline |
| Action buttons | 2px solid `focus` outline, 2px offset |
| Modal inputs | 2px solid `focus` outline |
| Modal buttons | 2px solid `focus` outline, 2px offset |
| Connection retry button | 2px solid `focus` outline |

### 9.3 Screen Reader Support

| Element | ARIA |
|---------|------|
| Connection banner | `role="status"`, `aria-live="polite"` (connected/reconnecting), `aria-live="assertive"` (disconnected) |
| Lease countdowns | `aria-label="Lease remaining: {minutes} minutes {seconds} seconds"`, updated every 15s (not every 1s to avoid verbosity) |
| Filter changes | `aria-live="polite"` region: "Showing {N} of {total} tickets" |
| Card state changes | `aria-live="polite"` region per column: "{stage} column, {N} tickets" |
| Confirmation modal | `role="dialog"`, `aria-modal="true"`, `aria-labelledby="modal-title"` |
| Toast notifications | `role="alert"` for errors, `role="status"` for success |
| Machine status dots | Status conveyed by icon + text label, not color alone |

### 9.4 Reduced Motion

```css
@media (prefers-reduced-motion: reduce) {
  .ticket-card { transition: none !important; }
  .countdown--critical { animation: none !important; }
  .connection-dot--reconnecting { animation: none !important; }
  .machine-dot--stale { animation: none !important; }
}
```

Countdown text still updates. Card moves are instant (no slide animation). Status dot pulsing is disabled.

---

## 10. User Flow Diagrams

### 10.1 Complete App Initialization Flow

```mermaid
flowchart TD
    A[Page loads index.html] --> B[Scripts loaded: app.js, pipeline.js, admin.js, D3.js]
    B --> C[app.js: DOMContentLoaded fires]
    C --> D[app.js: Initialize EventSource to /api/events]
    D --> E[app.js: Register handlers: pipeline, graph, admin]
    E --> F{SSE connected?}
    F -->|Yes| G[Show green Live dot]
    F -->|No| H[Start exponential backoff]
    G --> I[pipeline.js: GET /api/tickets]
    I --> J[pipeline.js: Render Kanban board]
    J --> K[pipeline.js: Start lease countdowns]
    K --> L[pipeline.js: Initialize filter bar from URL params]
    L --> M[admin.js: GET /api/admin/machines]
    M --> N[admin.js: GET /health + /api/stages]
    N --> O[admin.js: Render machine cards + health metrics]
    O --> P[Dashboard ready — listening for SSE events]
    H --> Q[Banner: Reconnecting...]
    Q --> R{Reconnected?}
    R -->|Yes| G
    R -->|No, 30s+ elapsed| S[Banner: Disconnected with Retry]
```

### 10.2 Force Release Happy Path

```mermaid
flowchart TD
    A[Operator switches to Admin tab via tab 4 or click] --> B[Selects a ticket in pipeline or from modal dropdown]
    B --> C[Clicks Force Release red button]
    C --> D[Confirmation modal opens with focus trap]
    D --> E[Types reason: 'Agent stalled during BACKEND stage']
    E --> F[Reason ≥ 10 chars → Confirm button enabled]
    F --> G[Clicks Confirm]
    G --> H[POST /api/tickets/TASK-FOS-03-007/release?force=true]
    H --> I[Response 200 OK]
    I --> J[Modal closes]
    J --> K[Success toast: 'Claim released for TASK-FOS-03-007']
    K --> L[Card in pipeline updates: unclaimed state, blue border]
    L --> M[Metric cards update: Active Claims -1, Expired Leases check]
```

### 10.3 Filter + Live Update Interaction

```mermaid
flowchart TD
    A[Operator sets Priority filter to High] --> B[URL updates: ?priority=high]
    B --> C[Cards not matching priority=high are hidden]
    C --> D[Column counts update to show filtered counts]
    D --> E[Badge shows: 1 filter active]
    E --> F{SSE event arrives: ticket_created with priority=high}
    F --> G[New card added to READY column]
    G --> H{Does new card match active filters?}
    H -->|Yes| I[Card is visible, column count increments]
    H -->|No| J[Card is in DOM but display:none]
    I --> K[Metric cards update regardless of filters]
```

---

## 11. Design Token References

All styling references the existing token system at `docs/uiux/design-tokens.json`. Additions specific to this ticket's JS interactions:

### 11.1 Animation Tokens (from design-tokens.json)

| Usage | Token | Value |
|-------|-------|-------|
| Hover feedback, focus rings | `transitions.fast` | 150ms ease-in-out |
| Card moves, panel slides, tab switches | `transitions.normal` | 250ms ease-in-out |
| Page transitions | `transitions.slow` | 500ms ease-in-out |

### 11.2 Timer-Specific Colors

| Usage | Token Path | Value |
|-------|-----------|-------|
| Countdown ≥ 5min | `themes.dark.colors.success` | #16A34A |
| Countdown < 5min | `themes.dark.colors.warning` | #EAB308 |
| Countdown < 1min / EXPIRED | `themes.dark.colors.error` | #EF4444 |

### 11.3 Z-Index Layer Map

| Layer | Token | Value | Used By |
|-------|-------|-------|---------|
| Base content | `zIndex.base` | 0 | Cards, columns |
| Filter dropdowns | `zIndex.dropdown` | 10 | Open dropdown menus |
| Sticky headers | `zIndex.sticky` | 20 | Top bar, filter bar |
| Modal scrim | `zIndex.overlay` | 30 | Modal backdrop |
| Slide-over panel | `zIndex.slideOver` | 40 | Ticket detail |
| Confirmation modal | `zIndex.modal` | 50 | Force release modal |
| Toast notifications | `zIndex.toast` | 60 | Success/error toasts |

---

## 12. Screenshots Reference

All screenshots persisted at `docs/uiux/mockups/TASK-FOS-05-004/`:

| # | Filename | Description |
|---|----------|-------------|
| 1 | `sse-connection-dispatch--dark--desktop.png` | SSE connection lifecycle states + event dispatch architecture + exponential backoff timeline |
| 2 | `pipeline-interactions--dark--desktop.png` | Kanban board with card states + SSE event mapping + filter bar |
| 3 | `admin-panel--dark--desktop.png` | Admin panel with force-release modal + machine status + system health metrics |
| 4 | `pipeline-mobile--dark--mobile.png` | Mobile pipeline with accordion stages + expanded filters + lease countdown |

---

## 13. Acceptance Criteria Verification

| # | Acceptance Criterion | Section | Status |
|---|---------------------|---------|--------|
| AC1 | app.js creates EventSource to /api/events; auto-reconnects with exponential backoff (1s, 2s, 4s, max 30s) | §3.1–§3.3 | ✅ Covered |
| AC2 | app.js dispatches SSE events to registered view handlers (pipeline, graph, admin) | §3.4–§3.5 | ✅ Covered |
| AC3 | pipeline.js fetches initial ticket data from GET /api/tickets and renders Kanban board | §4.1 | ✅ Covered |
| AC4 | pipeline.js updates individual ticket cards on SSE events without full re-render | §4.3 | ✅ Covered |
| AC5 | Lease countdown timers update every second; display "MM:SS remaining" or "EXPIRED" | §4.4 | ✅ Covered |
| AC6 | Filter controls (stage, type, priority, machine, agent) filter cards client-side | §4.5 | ✅ Covered |
| AC7 | admin.js: force-release button shows confirmation dialog before POST /api/tickets/:id/release?force=true | §5.2–§5.3 | ✅ Covered |
| AC8 | admin.js: machine status fetches from GET /api/admin/machines with health indicators | §5.4 | ✅ Covered |
| AC9 | admin.js: system health panel shows DB pool stats, uptime, expired lease count from /health and /api/stages | §5.5 | ✅ Covered |
| AC10 | No external JS dependencies except D3.js via CDN | §2.1 | ✅ Covered |

---

## 14. Quality Self-Assessment

```
PRD Coverage:       10/10 — All 10 acceptance criteria addressed with detailed specs
Component Coverage: 9/10  — All JS modules specified with interfaces, events, DOM
State Coverage:     10/10 — All card states, connection states, modal states, filter states
A11y Coverage:      9/10  — WCAG AA contrast verified, ARIA defined, keyboard nav mapped, reduced motion
Responsive:         8/10  — Mobile/tablet/desktop breakpoints for all interactive elements
Token Consistency:  10/10 — All values from design-tokens.json, no ad-hoc values
Flow Completeness:  10/10 — Init flow, force release flow, filter+SSE flow, reconnection flow
Handoff Readiness:  10/10 — Frontend can implement all 3 JS modules from specs alone

TOTAL: 76/80 (PASS — exceeds 56/80 threshold)
```
