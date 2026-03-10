/**
 * ForgeOS Dashboard — Main Application
 * Ticket: TASK-FOS-05-004
 *
 * Implements:
 *   - SSE real-time updates with exponential backoff reconnection
 *   - Handler registration & dispatch (pipeline, graph, admin)
 *   - REST data fetching (tickets, stages, history)
 *   - Kanban board rendering with ticket cards
 *   - Filter bar with URL query parameter sync
 *   - Tabbed ticket detail slide-over panel
 *   - Theme toggle (dark/light)
 *   - Keyboard navigation (WCAG 2.2 AA)
 *   - Mobile sidebar navigation
 *   - Metric cards
 *   - Connection status banner
 */

/* global d3 */
'use strict';

/* ═══════════════════════════════════════════════════════════
   CONSTANTS
   ═══════════════════════════════════════════════════════════ */

const STAGES_MAIN = [
  'READY', 'ARCHITECT', 'RESEARCH', 'BACKEND',
  'FRONTEND', 'QA', 'SECURITY', 'CI'
];

const STAGES_BOTTOM = ['DOCS', 'VALIDATION', 'DONE', 'ESCALATED'];

const ALL_STAGES = [...STAGES_MAIN, ...STAGES_BOTTOM];

const TYPE_COLORS = {
  backend:      '#3B82F6',
  frontend:     '#14B8A6',
  fullstack:    '#8B5CF6',
  infra:        '#64748B',
  security:     '#EF4444',
  docs:         '#64748B',
  research:     '#A855F7',
  architecture: '#8B5CF6'
};

const TYPE_LABELS = {
  backend:      'backend',
  frontend:     'frontend',
  fullstack:    'fullstack',
  infra:        'infra',
  security:     'security',
  docs:         'docs',
  research:     'research',
  architecture: 'arch'
};

const PRIORITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

const MACHINE_PALETTE = [
  '#3B82F6', '#8B5CF6', '#16A34A', '#F97316',
  '#EF4444', '#06B6D4', '#EC4899', '#EAB308'
];

const EVENT_DOT_COLORS = {
  CLAIM:    'var(--color-warning)',
  ADVANCE:  'var(--color-success)',
  REWORK:   'var(--color-error)',
  RELEASE:  'var(--color-info)',
  CREATE:   'var(--color-primary)',
  UPDATE:   'var(--color-secondary)'
};

/** SSE backoff cap in ms */
const SSE_BACKOFF_MAX = 30000;
/** Threshold (ms since last successful message) before declaring disconnected */
const SSE_DISCONNECT_THRESHOLD = 30000;

/* ═══════════════════════════════════════════════════════════
   HANDLER REGISTRY
   ═══════════════════════════════════════════════════════════ */

/** @type {Map<string, { handleEvent: (eventType: string, data: object) => void }>} */
const _handlers = new Map();

/* ═══════════════════════════════════════════════════════════
   STATE
   ═══════════════════════════════════════════════════════════ */

const state = {
  tickets: [],
  stages: {},
  selectedTicketId: null,
  selectedTicketData: null,
  selectedTicketHistory: [],
  filters: {
    stage: '',
    type: '',
    priority: '',
    machine: '',
    agent: '',
    search: ''
  },
  isConnected: false,
  connectionState: 'disconnected', // 'connected' | 'reconnecting' | 'disconnected'
  sseRetryCount: 0,
  eventSource: null,
  lastMessageAt: 0,
  startTime: Date.now(),

  /* FORGEOS-UID004 state */
  auth: { authenticated: false, user: null },
  claims: {
    data: [],
    sortCol: 'leaseRemaining',
    sortDir: 'asc',
    page: 1,
    perPage: 20,
    countdownIntervalId: null,
  },
  workbench: {
    selectedTicket: null,
    confirmCallback: null,
    previousFocus: null,
  },
};

/* ═══════════════════════════════════════════════════════════
   DOM REFERENCES
   ═══════════════════════════════════════════════════════════ */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const dom = {};

function cacheDom() {
  dom.connectionStatus = $('#connectionStatus');
  dom.statusDot = dom.connectionStatus?.querySelector('.status-dot');
  dom.statusLabel = dom.connectionStatus?.querySelector('.connection-status__label');
  dom.themeToggle = $('#themeToggle');
  dom.hamburgerBtn = $('#hamburgerBtn');
  dom.mobileSidebar = $('#mobileSidebar');
  dom.mobileScrim = $('#mobileScrim');
  dom.sidebarClose = $('#sidebarClose');
  dom.filterStage = $('#filter-stage');
  dom.filterType = $('#filter-type');
  dom.filterPriority = $('#filter-priority');
  dom.filterMachine = $('#filter-machine');
  dom.filterAgent = $('#filter-agent');
  dom.filterSearch = $('#filter-search');
  dom.clearFilters = $('#clearFilters');
  dom.kanbanColumns = $('#kanbanColumns');

  /* FORGEOS-UID004 DOM refs */
  dom.authBadge = $('#authUserBadge');
  dom.claimsTable = $('#claimsTable');
  dom.claimsTableBody = $('#claimsTableBody');
  dom.claimsCards = $('#claimsCards');
  dom.claimsEmpty = $('#claimsEmpty');
  dom.claimsPagination = $('#claimsPagination');
  dom.claimsPaginationInfo = $('#claimsPaginationInfo');
  dom.claimsPageNum = $('#claimsPageNum');
  dom.claimsPrevBtn = $('#claimsPrevBtn');
  dom.claimsNextBtn = $('#claimsNextBtn');
  dom.releaseAllExpiredBtn = $('#releaseAllExpiredBtn');
  dom.claimRowTemplate = $('#claim-row-template');
  dom.claimCardTemplate = $('#claim-card-template');
  dom.confirmScrim = $('#confirmScrim');
  dom.confirmModal = $('#confirmModal');
  dom.confirmTitle = $('#confirmTitle');
  dom.confirmDesc = $('#confirmDesc');
  dom.confirmReasonInput = $('#confirmReason');
  dom.confirmCharCount = $('#confirmCharCount');
  dom.confirmCancelBtn = $('#confirmCancelBtn');
  dom.confirmConfirmBtn = $('#confirmConfirmBtn');
  dom.workbenchTicketSearch = $('#workbenchTicketSearch');
  dom.workbenchDropdown = $('#workbenchDropdown');
  dom.workbenchSelection = $('#workbenchSelection');
  dom.wbTicketId = $('#wbTicketId');
  dom.wbTitle = $('#wbTitle');
  dom.wbStage = $('#wbStage');
  dom.wbClaimedBy = $('#wbClaimedBy');
  dom.wbMachine = $('#wbMachine');
  dom.wbLease = $('#wbLease');
  dom.actionClaim = $('#actionClaim');
  dom.actionRelease = $('#actionRelease');
  dom.actionAdvance = $('#actionAdvance');
  dom.actionForceRelease = $('#actionForceRelease');
  dom.activityLog = $('#activityLog');
  dom.activityEmpty = $('#activityEmpty');
  dom.activityEntryTemplate = $('#activity-entry-template');
  dom.machinesGrid = $('#machinesGrid');
  dom.machinesEmpty = $('#machinesEmpty');
  dom.machineCardTemplate = $('#machine-card-template');
  dom.metricTotal = $('#metricTotalValue');
  dom.metricClaims = $('#metricClaimsValue');
  dom.metricExpired = $('#metricExpiredValue');
  dom.metricUptime = $('#metricUptimeValue');
  dom.scrim = $('#scrim');
  dom.slideOver = $('#ticketDetail');
  dom.detailClose = $('#detailClose');
  dom.detailTicketId = $('#detailTicketId');
  dom.detailTitle = $('#detailTitle');
  dom.detailBadges = $('#detailBadges');
  dom.detailBody = $('#detailBody');
  dom.liveAnnouncer = $('#liveAnnouncer');
  dom.ticketTemplate = $('#ticket-card-template');
  dom.tabButtons = $$('.tab-nav__tab');
  dom.viewPanels = $$('.view-panel');
  dom.sidebarItems = $$('.mobile-sidebar__item');
  dom.compactStages = $$('.compact-stage');
  dom.connectionBanner = $('#connection-banner');
}

/* ═══════════════════════════════════════════════════════════
   UTILITIES
   ═══════════════════════════════════════════════════════════ */

function announce(message) {
  if (dom.liveAnnouncer) {
    dom.liveAnnouncer.textContent = '';
    requestAnimationFrame(() => {
      dom.liveAnnouncer.textContent = message;
    });
  }
}

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function getMachineColor(hostname) {
  if (!hostname) return MACHINE_PALETTE[0];
  return MACHINE_PALETTE[hashString(hostname) % MACHINE_PALETTE.length];
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function formatDuration(ms) {
  if (!ms || ms < 0) return '—';
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function formatRelativeTime(isoString) {
  if (!isoString) return '—';
  const date = new Date(isoString);
  const now = Date.now();
  const diff = now - date.getTime();
  return formatDuration(diff) + ' ago';
}

function formatLeaseRemaining(leaseExpiry) {
  if (!leaseExpiry) return '—';
  const expiry = new Date(leaseExpiry).getTime();
  const now = Date.now();
  const remaining = expiry - now;
  if (remaining <= 0) return 'Expired';
  return formatDuration(remaining);
}

function formatTimestamp(isoString) {
  if (!isoString) return '—';
  const date = new Date(isoString);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
}

function getClaimStatus(ticket) {
  if (!ticket.claimed_by) return 'unclaimed';
  if (!ticket.lease_expiry) return 'claimed';
  const expiry = new Date(ticket.lease_expiry).getTime();
  const now = Date.now();
  const remaining = expiry - now;
  if (remaining <= 0) return 'expired';
  if (remaining <= 300000) return 'expiring';
  return 'claimed';
}

function debounce(fn, ms) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), ms);
  };
}

/* ═══════════════════════════════════════════════════════════
   API
   ═══════════════════════════════════════════════════════════ */

async function fetchJSON(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  return response.json();
}

async function fetchTickets(filters) {
  const params = new URLSearchParams();
  if (filters.stage) params.set('stage', filters.stage);
  if (filters.type) params.set('type', filters.type);
  if (filters.priority) params.set('priority', filters.priority);
  if (filters.agent) params.set('claimed_by', filters.agent);
  params.set('limit', '500');
  const query = params.toString();
  const url = '/api/tickets' + (query ? '?' + query : '');
  const result = await fetchJSON(url);
  return result.data || [];
}

async function fetchStages() {
  const result = await fetchJSON('/api/stages');
  return result.stages || {};
}

async function fetchTicketDetail(ticketId) {
  return fetchJSON(`/api/tickets/${encodeURIComponent(ticketId)}`);
}

async function fetchTicketHistory(ticketId) {
  const result = await fetchJSON(`/api/tickets/${encodeURIComponent(ticketId)}/history`);
  return result.events || [];
}

/* ═══════════════════════════════════════════════════════════
   HANDLER REGISTRATION & DISPATCH
   ═══════════════════════════════════════════════════════════ */

/**
 * Register a named handler that receives dispatched SSE events.
 * Handler must implement handleEvent(eventType, data).
 */
function registerHandler(name, handler) {
  if (typeof handler?.handleEvent !== 'function') {
    return;
  }
  _handlers.set(name, handler);
}

/** Remove a previously registered handler. */
function unregisterHandler(name) {
  _handlers.delete(name);
}

/** Dispatch an SSE event to all registered handlers. */
function dispatchToHandlers(eventType, data) {
  _handlers.forEach(function (handler) {
    try {
      handler.handleEvent(eventType, data);
    } catch (_err) {
      // Handlers must not break the dispatch loop.
    }
  });
}

/** Return current connection state string. */
function getConnectionState() {
  return state.connectionState;
}

/* ═══════════════════════════════════════════════════════════
   SSE CONNECTION — EXPONENTIAL BACKOFF
   ═══════════════════════════════════════════════════════════ */

function connectSSE() {
  if (state.eventSource) {
    state.eventSource.close();
  }

  state.connectionState = 'reconnecting';
  updateConnectionStatus('reconnecting');

  const es = new EventSource('/api/events');
  state.eventSource = es;

  es.onopen = function () {
    state.isConnected = true;
    state.sseRetryCount = 0;
    state.connectionState = 'connected';
    state.lastMessageAt = Date.now();
    updateConnectionStatus('connected');
    hideBanner();
  };

  /** Generic listener for named SSE event types. */
  function handleSSEMessage(eventType, rawData) {
    state.lastMessageAt = Date.now();
    try {
      var data = JSON.parse(rawData);
    } catch (_err) {
      return; // malformed
    }

    /* ── Internal state updates for backward-compat ── */
    if (eventType === 'snapshot') {
      if (data.stage_summary) state.stages = data.stage_summary;
      if (data.recent_tickets) state.tickets = data.recent_tickets;
      renderBoard();
      updateMetrics();
    }

    if (eventType === 'ticket-update' || eventType === 'ticket_update') {
      handleTicketUpdate(data);
    }

    if (eventType === 'stage-update' || eventType === 'stage_update') {
      if (data.stages) {
        state.stages = data.stages;
        updateStageCounts();
        updateMetrics();
      }
    }

    /* ── Dispatch to all registered handlers ── */
    dispatchToHandlers(eventType, data);
  }

  /* Listen for known SSE event types */
  var sseEventNames = [
    'snapshot', 'ticket-update', 'stage-update',
    'ticket_created', 'ticket_claimed', 'stage_advanced',
    'ticket_rejected', 'ticket_completed', 'lease_expired',
    'lease_extended', 'ticket_escalated',
    'health_update', 'agent_connected', 'agent_disconnected'
  ];

  sseEventNames.forEach(function (name) {
    es.addEventListener(name, function (e) {
      handleSSEMessage(name, e.data);
    });
  });

  es.onerror = function () {
    state.isConnected = false;
    es.close();
    state.eventSource = null;

    state.sseRetryCount++;
    var elapsed = Date.now() - (state.lastMessageAt || state.startTime);

    if (elapsed > SSE_DISCONNECT_THRESHOLD && state.sseRetryCount > 1) {
      state.connectionState = 'disconnected';
      updateConnectionStatus('disconnected');
      showBanner('disconnected');
    } else {
      state.connectionState = 'reconnecting';
      var delay = Math.min(1000 * Math.pow(2, state.sseRetryCount - 1), SSE_BACKOFF_MAX);
      updateConnectionStatus('reconnecting');
      showBanner('reconnecting', Math.ceil(delay / 1000));
      setTimeout(connectSSE, delay);
    }
  };
}

/** Manual reconnect (e.g. Retry button or keyboard shortcut). */
function reconnectSSE() {
  state.sseRetryCount = 0;
  state.lastMessageAt = Date.now();
  connectSSE();
}

function handleTicketUpdate(data) {
  var ticket = data.ticket || data;
  if (!ticket.id) return;

  var idx = state.tickets.findIndex(function (t) { return t.id === ticket.id; });
  if (idx >= 0) {
    state.tickets[idx] = Object.assign({}, state.tickets[idx], ticket);
  } else {
    state.tickets.push(ticket);
  }

  renderBoard();
  updateMetrics();

  if (state.selectedTicketId === ticket.id) {
    loadTicketDetail(ticket.id);
  }
}

function updateConnectionStatus(status) {
  if (!dom.statusDot || !dom.statusLabel) return;

  dom.statusDot.className = 'status-dot';

  switch (status) {
    case 'connected':
      dom.statusDot.classList.add('status-dot--connected');
      dom.statusLabel.textContent = 'Live';
      dom.statusDot.setAttribute('aria-hidden', 'true');
      break;
    case 'reconnecting':
      dom.statusDot.classList.add('status-dot--reconnecting');
      dom.statusLabel.textContent = 'Reconnecting…';
      announce('Connection lost. Reconnecting.');
      break;
    case 'disconnected':
      dom.statusDot.classList.add('status-dot--disconnected');
      dom.statusLabel.textContent = 'Offline';
      announce('Connection lost. Dashboard is offline.');
      break;
  }
}

/* ═══════════════════════════════════════════════════════════
   CONNECTION BANNER
   ═══════════════════════════════════════════════════════════ */

function ensureBannerElement() {
  if (dom.connectionBanner) return;
  var banner = document.getElementById('connection-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'connection-banner';
    banner.setAttribute('role', 'status');
    banner.setAttribute('aria-live', 'polite');
    banner.className = 'connection-banner hidden';
    banner.innerHTML =
      '<span class="connection-banner__icon" aria-hidden="true"></span>' +
      '<span class="connection-banner__message"></span>' +
      '<button class="connection-banner__retry" aria-label="Retry connection">Retry</button>';
    var main = document.querySelector('main') || document.body;
    main.parentNode.insertBefore(banner, main);
    banner.querySelector('.connection-banner__retry')
      .addEventListener('click', reconnectSSE);
  }
  dom.connectionBanner = banner;
}

function showBanner(bannerState, delaySec) {
  ensureBannerElement();
  var banner = dom.connectionBanner;
  banner.classList.remove('hidden', 'banner--warning', 'banner--error');

  var msgEl = banner.querySelector('.connection-banner__message');
  var retryBtn = banner.querySelector('.connection-banner__retry');

  if (bannerState === 'reconnecting') {
    banner.classList.add('banner--warning');
    banner.setAttribute('aria-live', 'polite');
    msgEl.textContent = 'Reconnecting\u2026 retry in ' + (delaySec || '?') + 's';
    retryBtn.hidden = true;
  } else {
    banner.classList.add('banner--error');
    banner.setAttribute('aria-live', 'assertive');
    msgEl.textContent = 'Connection lost. Data may be stale.';
    retryBtn.hidden = false;
  }
}

function hideBanner() {
  if (dom.connectionBanner) {
    dom.connectionBanner.classList.add('hidden');
  }
}

/* ═══════════════════════════════════════════════════════════
   FILTERS
   ═══════════════════════════════════════════════════════════ */

function readFiltersFromURL() {
  const params = new URLSearchParams(window.location.search);
  state.filters.stage = params.get('stage') || '';
  state.filters.type = params.get('type') || '';
  state.filters.priority = params.get('priority') || '';
  state.filters.machine = params.get('machine') || '';
  state.filters.agent = params.get('assignee') || '';
  state.filters.search = params.get('search') || '';
}

function syncFiltersToURL() {
  const params = new URLSearchParams();
  if (state.filters.stage) params.set('stage', state.filters.stage);
  if (state.filters.type) params.set('type', state.filters.type);
  if (state.filters.priority) params.set('priority', state.filters.priority);
  if (state.filters.machine) params.set('machine', state.filters.machine);
  if (state.filters.agent) params.set('assignee', state.filters.agent);
  if (state.filters.search) params.set('search', state.filters.search);

  const query = params.toString();
  const url = window.location.pathname + (query ? '?' + query : '');
  window.history.replaceState(null, '', url);
}

function syncFiltersToDOM() {
  if (dom.filterStage) dom.filterStage.value = state.filters.stage;
  if (dom.filterType) dom.filterType.value = state.filters.type;
  if (dom.filterPriority) dom.filterPriority.value = state.filters.priority;
  if (dom.filterMachine) dom.filterMachine.value = state.filters.machine;
  if (dom.filterAgent) dom.filterAgent.value = state.filters.agent;
  if (dom.filterSearch) dom.filterSearch.value = state.filters.search;
}

function applyFilters(tickets) {
  return tickets.filter(t => {
    if (state.filters.stage && t.stage !== state.filters.stage) return false;
    if (state.filters.type && t.type !== state.filters.type) return false;
    if (state.filters.priority && t.priority !== state.filters.priority) return false;
    if (state.filters.machine && t.machine_id !== state.filters.machine) return false;
    if (state.filters.agent && t.claimed_by !== state.filters.agent) return false;
    if (state.filters.search) {
      const term = state.filters.search.toLowerCase();
      const idMatch = (t.id || '').toLowerCase().includes(term);
      const titleMatch = (t.title || '').toLowerCase().includes(term);
      if (!idMatch && !titleMatch) return false;
    }
    return true;
  });
}

function onFilterChange() {
  state.filters.stage = dom.filterStage?.value || '';
  state.filters.type = dom.filterType?.value || '';
  state.filters.priority = dom.filterPriority?.value || '';
  state.filters.machine = dom.filterMachine?.value || '';
  state.filters.agent = dom.filterAgent?.value || '';
  state.filters.search = dom.filterSearch?.value || '';

  syncFiltersToURL();
  renderBoard();
  announce('Filters updated');
}

function clearAllFilters() {
  state.filters = { stage: '', type: '', priority: '', machine: '', agent: '', search: '' };
  syncFiltersToDOM();
  syncFiltersToURL();
  renderBoard();
  announce('All filters cleared');
}

/* ═══════════════════════════════════════════════════════════
   RENDERING — TICKET CARDS
   ═══════════════════════════════════════════════════════════ */

function createTicketCard(ticket) {
  const template = dom.ticketTemplate;
  if (!template) return null;

  const clone = template.content.cloneNode(true);
  const card = clone.querySelector('.ticket-card');
  if (!card) return null;

  card.dataset.ticketId = ticket.id || '';

  // Claim status class
  const claimStatus = getClaimStatus(ticket);
  card.classList.add(`ticket-card--${claimStatus}`);

  // Selected state
  if (state.selectedTicketId === ticket.id) {
    card.classList.add('ticket-card--selected');
    card.setAttribute('aria-selected', 'true');
  }

  // Ticket ID
  const idEl = card.querySelector('.ticket-card__id');
  if (idEl) idEl.textContent = ticket.id || '—';

  // Machine badge
  const machineEl = card.querySelector('.ticket-card__machine');
  if (machineEl) {
    if (ticket.machine_id) {
      machineEl.textContent = ticket.machine_id;
      machineEl.style.backgroundColor = getMachineColor(ticket.machine_id);
    } else {
      machineEl.hidden = true;
    }
  }

  // Title
  const titleEl = card.querySelector('.ticket-card__title');
  if (titleEl) titleEl.textContent = ticket.title || '—';

  // Priority badge
  const priorityEl = card.querySelector('.ticket-card__priority');
  if (priorityEl && ticket.priority) {
    priorityEl.textContent = ticket.priority;
    priorityEl.classList.add(`badge--priority-${ticket.priority}`);
  }

  // Type badge
  const typeEl = card.querySelector('.ticket-card__type');
  if (typeEl && ticket.type) {
    typeEl.textContent = TYPE_LABELS[ticket.type] || ticket.type;
    typeEl.style.backgroundColor = TYPE_COLORS[ticket.type] || 'var(--color-secondary)';
    typeEl.style.color = 'var(--color-text-inverse)';
    typeEl.classList.add('badge--type-colored');
  }

  // Agent / claim indicator
  const agentEl = card.querySelector('.ticket-card__agent');
  if (agentEl) {
    if (ticket.claimed_by) {
      agentEl.innerHTML =
        '<span class="claim-dot claim-dot--claimed" aria-hidden="true"></span> ' +
        escapeHtml(ticket.claimed_by);
    } else {
      agentEl.innerHTML =
        '<span class="claim-dot claim-dot--unclaimed" aria-hidden="true"></span> ' +
        '<em>Unclaimed</em>';
    }
  }

  // Time in stage
  const timeEl = card.querySelector('.ticket-card__time');
  if (timeEl) {
    if (ticket.claimed_at) {
      const elapsed = Date.now() - new Date(ticket.claimed_at).getTime();
      timeEl.textContent = formatDuration(elapsed);
      if (elapsed > 1800000) {
        timeEl.classList.add('ticket-card__time--warning');
      }
    } else if (ticket.created_at) {
      timeEl.textContent = formatRelativeTime(ticket.created_at);
    } else {
      timeEl.textContent = '';
    }
  }

  // Rework badge
  const reworkEl = card.querySelector('.ticket-card__rework');
  if (reworkEl) {
    const reworkCount = ticket.rework_count || 0;
    if (reworkCount > 0) {
      reworkEl.textContent = `R${reworkCount}`;
      reworkEl.hidden = false;
    } else {
      reworkEl.hidden = true;
    }
  }

  // ARIA label
  const ariaLabel = [
    ticket.id,
    ticket.title,
    ticket.priority ? `${ticket.priority} priority` : '',
    ticket.type ? `${ticket.type} type` : '',
    ticket.claimed_by ? `Claimed by ${ticket.claimed_by}` : 'Unclaimed'
  ].filter(Boolean).join(', ');
  card.setAttribute('aria-label', ariaLabel);

  // Click handler
  card.addEventListener('click', () => openTicketDetail(ticket.id));

  // Keyboard handler
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openTicketDetail(ticket.id);
    }
    handleCardKeyNav(e, card);
  });

  return clone;
}

function createSkeletonCard() {
  const card = document.createElement('article');
  card.className = 'ticket-card ticket-card--skeleton';
  card.setAttribute('aria-hidden', 'true');
  card.innerHTML =
    '<div class="skeleton-bar skeleton-bar--id"></div>' +
    '<div class="skeleton-bar skeleton-bar--title"></div>' +
    '<div class="skeleton-bar skeleton-bar--title-2"></div>' +
    '<div class="ticket-card__bottom">' +
    '  <span class="skeleton-bar skeleton-bar--badge"></span>' +
    '  <span class="skeleton-bar skeleton-bar--badge"></span>' +
    '</div>';
  return card;
}

/* ═══════════════════════════════════════════════════════════
   RENDERING — KANBAN BOARD
   ═══════════════════════════════════════════════════════════ */

function renderBoard() {
  const filtered = applyFilters(state.tickets);

  STAGES_MAIN.forEach(stage => {
    renderColumn(stage, filtered);
  });

  updateStageCounts();
  updateBottomRow(filtered);
}

function renderColumn(stage, filteredTickets) {
  const col = document.getElementById(`col-${stage}`);
  if (!col) return;

  const stageTickets = filteredTickets
    .filter(t => t.stage === stage)
    .sort((a, b) => {
      const pa = PRIORITY_ORDER[a.priority] ?? 4;
      const pb = PRIORITY_ORDER[b.priority] ?? 4;
      if (pa !== pb) return pa - pb;
      const timeA = a.claimed_at ? new Date(a.claimed_at).getTime() : 0;
      const timeB = b.claimed_at ? new Date(b.claimed_at).getTime() : 0;
      return timeB - timeA;
    });

  col.innerHTML = '';

  if (stageTickets.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'stage-column__empty';
    empty.textContent = 'No tickets in this stage';
    col.appendChild(empty);
  } else {
    stageTickets.forEach(ticket => {
      const card = createTicketCard(ticket);
      if (card) col.appendChild(card);
    });
  }

  col.setAttribute('aria-label', `${stage} stage, ${stageTickets.length} tickets`);
}

function updateStageCounts() {
  ALL_STAGES.forEach(stage => {
    const colEl = document.querySelector(`.stage-column[data-stage="${stage}"]`);
    const compactEl = document.querySelector(`.compact-stage[data-stage="${stage}"]`);

    const count = state.stages[stage]?.count
      ?? state.tickets.filter(t => t.stage === stage).length;

    if (colEl) {
      const countBadge = colEl.querySelector('.stage-column__count');
      if (countBadge) {
        countBadge.textContent = count;
        countBadge.setAttribute('aria-label', `${count} tickets`);
      }
    }

    if (compactEl) {
      const countBadge = compactEl.querySelector('.compact-stage__count');
      if (countBadge) {
        countBadge.textContent = count;
      }
      compactEl.setAttribute('aria-label', `${stage} stage, ${count} tickets`);
    }
  });
}

function updateBottomRow(filteredTickets) {
  STAGES_BOTTOM.forEach(stage => {
    const compactEl = document.querySelector(`.compact-stage[data-stage="${stage}"]`);
    if (!compactEl) return;

    const count = filteredTickets.filter(t => t.stage === stage).length;
    const countBadge = compactEl.querySelector('.compact-stage__count');
    if (countBadge) countBadge.textContent = count;
    compactEl.setAttribute('aria-label', `${stage} stage, ${count} tickets`);
  });
}

/* ═══════════════════════════════════════════════════════════
   RENDERING — METRICS
   ═══════════════════════════════════════════════════════════ */

function updateMetrics() {
  const total = state.tickets.length;
  const activeClaims = state.tickets.filter(t => {
    const cs = getClaimStatus(t);
    return cs === 'claimed' || cs === 'expiring';
  }).length;
  const expiredLeases = state.tickets.filter(t => getClaimStatus(t) === 'expired').length;
  const uptime = Date.now() - state.startTime;

  if (dom.metricTotal) dom.metricTotal.textContent = total;
  if (dom.metricClaims) dom.metricClaims.textContent = activeClaims;
  if (dom.metricExpired) dom.metricExpired.textContent = expiredLeases;
  if (dom.metricUptime) dom.metricUptime.textContent = formatDuration(uptime);
}

/* ═══════════════════════════════════════════════════════════
   TICKET DETAIL — SLIDE-OVER
   ═══════════════════════════════════════════════════════════ */

async function openTicketDetail(ticketId) {
  if (!ticketId) return;

  state.selectedTicketId = ticketId;

  // Show slide-over with loading state
  showSlideOver();

  // Mark selected card
  $$('.ticket-card--selected').forEach(el => {
    el.classList.remove('ticket-card--selected');
    el.removeAttribute('aria-selected');
  });
  const selectedCard = document.querySelector(`.ticket-card[data-ticket-id="${ticketId}"]`);
  if (selectedCard) {
    selectedCard.classList.add('ticket-card--selected');
    selectedCard.setAttribute('aria-selected', 'true');
  }

  await loadTicketDetail(ticketId);
}

async function loadTicketDetail(ticketId) {
  try {
    const [detail, history] = await Promise.all([
      fetchTicketDetail(ticketId),
      fetchTicketHistory(ticketId)
    ]);

    state.selectedTicketData = detail;
    state.selectedTicketHistory = history;

    renderDetailPanel(detail, history);
    announce(`Ticket ${ticketId} details loaded`);
  } catch (err) {
    renderDetailError(ticketId, err.message);
  }
}

function renderDetailPanel(ticket, history) {
  if (!dom.detailTicketId) return;

  // Header
  dom.detailTicketId.textContent = ticket.id || '—';

  // Title
  dom.detailTitle.textContent = ticket.title || '—';

  // Badges row
  dom.detailBadges.innerHTML = '';
  if (ticket.priority) {
    dom.detailBadges.appendChild(
      createBadgeEl(ticket.priority, `badge--priority badge--priority-${ticket.priority}`)
    );
  }
  if (ticket.type) {
    const typeBadge = createBadgeEl(TYPE_LABELS[ticket.type] || ticket.type, 'badge--type-colored');
    typeBadge.style.backgroundColor = TYPE_COLORS[ticket.type] || 'var(--color-secondary)';
    typeBadge.style.color = 'var(--color-text-inverse)';
    dom.detailBadges.appendChild(typeBadge);
  }
  if (ticket.stage) {
    dom.detailBadges.appendChild(createBadgeEl(ticket.stage, 'badge--stage'));
  }

  // Claim indicator row
  const claimRow = document.createElement('div');
  claimRow.className = 'slide-over__claim-row';
  if (ticket.claimed_by) {
    claimRow.innerHTML =
      '<span class="claim-dot claim-dot--claimed" aria-hidden="true"></span> ' +
      escapeHtml(ticket.claimed_by);
    if (ticket.machine_id) {
      const machBadge = document.createElement('span');
      machBadge.className = 'badge badge--machine';
      machBadge.textContent = ticket.machine_id;
      machBadge.style.backgroundColor = getMachineColor(ticket.machine_id);
      claimRow.appendChild(machBadge);
    }
  } else {
    claimRow.innerHTML =
      '<span class="claim-dot claim-dot--unclaimed" aria-hidden="true"></span> ' +
      '<em>Unclaimed</em>';
  }
  dom.detailBadges.appendChild(claimRow);

  // Lease timer
  if (ticket.claimed_by && ticket.lease_expiry) {
    const leaseEl = document.createElement('div');
    leaseEl.className = 'slide-over__lease-timer';
    const remaining = formatLeaseRemaining(ticket.lease_expiry);
    leaseEl.innerHTML =
      `<span aria-hidden="true">⏱</span> ${escapeHtml(remaining)} remaining`;
    dom.detailBadges.appendChild(leaseEl);
  }

  // Render the currently active tab content
  const activeTab = document.querySelector('.detail-tab--active');
  const tabId = activeTab?.dataset.tab || 'overview';
  renderTabContent(tabId, ticket, history);
}

function renderTabContent(tabId, ticket, history) {
  const panel = document.getElementById(`detail-tabpanel-${tabId}`);
  if (!panel) return;

  // Hide all panels, show active
  $$('.detail-tabpanel').forEach(p => {
    p.hidden = true;
    p.setAttribute('aria-hidden', 'true');
  });
  panel.hidden = false;
  panel.removeAttribute('aria-hidden');

  ticket = ticket || state.selectedTicketData;
  history = history || state.selectedTicketHistory;

  switch (tabId) {
    case 'overview':
      renderOverviewTab(panel, ticket);
      break;
    case 'history':
      renderHistoryTab(panel, history);
      break;
    case 'dependencies':
      renderDependenciesTab(panel, ticket);
      break;
    case 'files':
      renderFilesTab(panel, ticket);
      break;
  }
}

/* ── Tab: Overview ─────────────────────────────────────────── */

function renderOverviewTab(panel, ticket) {
  if (!ticket) return;

  panel.innerHTML = '';

  // Metadata section
  const metaSection = document.createElement('section');
  metaSection.className = 'slide-over__section';
  metaSection.innerHTML = '<h3 class="slide-over__section-title">Metadata</h3>';

  const dl = document.createElement('dl');
  dl.className = 'slide-over__meta';

  const fields = [
    ['Stage', ticket.stage || '—'],
    ['Priority', ticket.priority || '—'],
    ['Type', ticket.type || '—'],
    ['Claimed By', ticket.claimed_by || '—'],
    ['Machine', ticket.machine_id || '—'],
    ['Lease Remaining', formatLeaseRemaining(ticket.lease_expiry)],
    ['Rework Count', (ticket.rework_count || 0).toString()],
    ['Created', formatTimestamp(ticket.created_at)]
  ];

  fields.forEach(([label, value]) => {
    const row = document.createElement('div');
    row.className = 'meta-row';
    row.innerHTML = `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`;
    dl.appendChild(row);
  });

  metaSection.appendChild(dl);
  panel.appendChild(metaSection);

  // Acceptance Criteria section
  const acSection = document.createElement('section');
  acSection.className = 'slide-over__section';
  acSection.innerHTML = '<h3 class="slide-over__section-title">Acceptance Criteria</h3>';

  const acList = document.createElement('ul');
  acList.className = 'slide-over__ac-list';
  acList.setAttribute('role', 'list');

  const criteria = ticket.acceptance_criteria || [];
  if (criteria.length > 0) {
    const progressEl = document.createElement('span');
    progressEl.className = 'ac-progress';
    progressEl.textContent = `0 / ${criteria.length}`;
    acSection.querySelector('.slide-over__section-title').appendChild(progressEl);

    criteria.forEach((ac) => {
      const li = document.createElement('li');
      li.textContent = ac;
      acList.appendChild(li);
    });
  } else {
    const li = document.createElement('li');
    li.textContent = 'No acceptance criteria defined';
    li.className = 'slide-over__empty-msg';
    acList.appendChild(li);
  }

  acSection.appendChild(acList);
  panel.appendChild(acSection);

  // Description section
  if (ticket.description) {
    const descSection = document.createElement('section');
    descSection.className = 'slide-over__section';
    descSection.innerHTML =
      '<h3 class="slide-over__section-title">Description</h3>' +
      `<p class="slide-over__description">${escapeHtml(ticket.description)}</p>`;
    panel.appendChild(descSection);
  }
}

/* ── Tab: History ──────────────────────────────────────────── */

function renderHistoryTab(panel, events) {
  panel.innerHTML = '';

  const section = document.createElement('section');
  section.className = 'slide-over__section';
  section.innerHTML = '<h3 class="slide-over__section-title">Event Timeline</h3>';

  if (!events || events.length === 0) {
    section.innerHTML += '<p class="slide-over__empty-msg">No history events recorded</p>';
    panel.appendChild(section);
    return;
  }

  const timeline = document.createElement('ol');
  timeline.className = 'slide-over__timeline';
  timeline.setAttribute('role', 'list');
  timeline.setAttribute('aria-label', 'Ticket history timeline');

  events.forEach(evt => {
    const li = document.createElement('li');
    li.className = 'timeline-event';

    const eventType = (evt.event || '').toUpperCase();
    const dotColor = EVENT_DOT_COLORS[eventType] || 'var(--color-primary)';
    li.style.setProperty('--event-dot-color', dotColor);

    const timeStr = formatTimestamp(evt.timestamp);
    const agentStr = evt.agent || '';
    const machineStr = evt.machine_id || '';
    const details = evt.details || '';

    li.innerHTML =
      `<span class="slide-over__timeline-time">${escapeHtml(timeStr)}</span>` +
      `<span class="slide-over__timeline-event">${escapeHtml(evt.event || '')}</span>` +
      (agentStr ? ` <span class="badge badge--type">${escapeHtml(agentStr)}</span>` : '') +
      (machineStr ? ` <span class="badge badge--machine" style="background-color:${getMachineColor(machineStr)}">${escapeHtml(machineStr)}</span>` : '') +
      (details ? `<p class="timeline-event__details">${escapeHtml(details)}</p>` : '');

    timeline.appendChild(li);
  });

  section.appendChild(timeline);
  panel.appendChild(section);
}

/* ── Tab: Dependencies ─────────────────────────────────────── */

function renderDependenciesTab(panel, ticket) {
  panel.innerHTML = '';

  const section = document.createElement('section');
  section.className = 'slide-over__section';

  // Depends On
  const dependsOn = ticket.depends_on || [];
  const depStatus = ticket.dependency_status || [];

  const upstreamHeading = document.createElement('h3');
  upstreamHeading.className = 'slide-over__section-title';
  upstreamHeading.textContent = `Depends On (${dependsOn.length})`;
  section.appendChild(upstreamHeading);

  if (dependsOn.length === 0) {
    const p = document.createElement('p');
    p.className = 'slide-over__empty-msg';
    p.textContent = 'No upstream dependencies';
    section.appendChild(p);
  } else {
    const list = document.createElement('ul');
    list.className = 'dep-list';
    list.setAttribute('role', 'list');
    list.setAttribute('aria-label', 'Upstream dependencies');

    dependsOn.forEach(depId => {
      const info = depStatus.find(d => d.ticket_id === depId) || {};
      const li = document.createElement('li');
      li.className = 'dep-list__item';

      const isResolved = info.is_resolved || info.status === 'DONE';
      const statusIcon = isResolved ? '✅' : (info.status === 'READY' ? '🔵' : '🔴');
      const statusClass = isResolved ? 'dep--resolved' : 'dep--waiting';

      li.innerHTML =
        `<span class="dep-status-icon ${statusClass}" aria-label="${isResolved ? 'Resolved' : 'Waiting'}">${statusIcon}</span>` +
        `<button class="dep-link" data-ticket-id="${escapeHtml(depId)}" aria-label="View ticket ${escapeHtml(depId)}">${escapeHtml(depId)}</button>` +
        (info.title ? ` <span class="dep-title">${escapeHtml(info.title)}</span>` : '') +
        (info.status ? ` <span class="badge badge--stage-sm">${escapeHtml(info.status)}</span>` : '');

      list.appendChild(li);
    });

    list.addEventListener('click', (e) => {
      const btn = e.target.closest('.dep-link');
      if (btn) {
        openTicketDetail(btn.dataset.ticketId);
      }
    });

    section.appendChild(list);
  }

  // Blocks (downstream) — from dependency_status reverse lookup if available
  const blocksHeading = document.createElement('h3');
  blocksHeading.className = 'slide-over__section-title';
  blocksHeading.style.marginTop = 'var(--space-lg)';
  blocksHeading.textContent = 'Blocks';
  section.appendChild(blocksHeading);

  const downstream = ticket.depended_by || [];
  if (downstream.length === 0) {
    const p = document.createElement('p');
    p.className = 'slide-over__empty-msg';
    p.textContent = 'No downstream dependents';
    section.appendChild(p);
  } else {
    const list = document.createElement('ul');
    list.className = 'dep-list';
    list.setAttribute('role', 'list');
    list.setAttribute('aria-label', 'Downstream dependents');

    downstream.forEach(depId => {
      const li = document.createElement('li');
      li.className = 'dep-list__item';
      li.innerHTML =
        `<span class="dep-status-icon" aria-hidden="true">⬇️</span>` +
        `<button class="dep-link" data-ticket-id="${escapeHtml(depId)}" aria-label="View ticket ${escapeHtml(depId)}">${escapeHtml(depId)}</button>`;
      list.appendChild(li);
    });

    list.addEventListener('click', (e) => {
      const btn = e.target.closest('.dep-link');
      if (btn) {
        openTicketDetail(btn.dataset.ticketId);
      }
    });

    section.appendChild(list);
  }

  panel.appendChild(section);
}

/* ── Tab: Files ────────────────────────────────────────────── */

function renderFilesTab(panel, ticket) {
  panel.innerHTML = '';

  const section = document.createElement('section');
  section.className = 'slide-over__section';

  const filePaths = ticket.file_paths || [];

  const heading = document.createElement('h3');
  heading.className = 'slide-over__section-title';
  heading.textContent = `Associated Files (${filePaths.length})`;
  section.appendChild(heading);

  if (filePaths.length === 0) {
    const p = document.createElement('p');
    p.className = 'slide-over__empty-msg';
    p.textContent = 'No files associated with this ticket';
    section.appendChild(p);
    panel.appendChild(section);
    return;
  }

  const list = document.createElement('ul');
  list.className = 'file-list';
  list.setAttribute('role', 'list');
  list.setAttribute('aria-label', 'Associated file paths');

  filePaths.forEach(fp => {
    const li = document.createElement('li');
    li.className = 'file-list__item';

    const pathSpan = document.createElement('span');
    pathSpan.className = 'file-list__path';
    pathSpan.textContent = fp;

    const copyBtn = document.createElement('button');
    copyBtn.className = 'file-list__copy';
    copyBtn.setAttribute('aria-label', `Copy path ${fp}`);
    copyBtn.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">' +
      '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>' +
      '<path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>' +
      '</svg>';

    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      copyToClipboard(fp);
    });

    li.appendChild(pathSpan);
    li.appendChild(copyBtn);
    list.appendChild(li);
  });

  section.appendChild(list);
  panel.appendChild(section);
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast('Path copied to clipboard');
  } catch (err) {
    // Fallback
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    showToast('Path copied to clipboard');
  }
}

function showToast(message) {
  let toast = document.querySelector('.toast');
  if (toast) toast.remove();

  toast = document.createElement('div');
  toast.className = 'toast';
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  toast.textContent = message;
  document.body.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.add('toast--visible');
  });

  setTimeout(() => {
    toast.classList.remove('toast--visible');
    setTimeout(() => toast.remove(), 300);
  }, 2000);
}

function renderDetailError(ticketId, message) {
  const activePanel = document.querySelector('.detail-tabpanel:not([hidden])');
  if (activePanel) {
    activePanel.innerHTML =
      '<div class="slide-over__error" role="alert">' +
      `<p>Failed to load ticket ${escapeHtml(ticketId)}</p>` +
      `<p class="slide-over__error-detail">${escapeHtml(message)}</p>` +
      `<button class="slide-over__retry" onclick="loadTicketDetail('${escapeHtml(ticketId)}')">Retry</button>` +
      '</div>';
  }
}

function createBadgeEl(text, className) {
  const span = document.createElement('span');
  span.className = `badge ${className}`;
  span.textContent = text;
  return span;
}

/* ═══════════════════════════════════════════════════════════
   SLIDE-OVER OPEN / CLOSE
   ═══════════════════════════════════════════════════════════ */

let previousFocus = null;

function showSlideOver() {
  previousFocus = document.activeElement;
  dom.scrim.hidden = false;
  dom.scrim.setAttribute('aria-hidden', 'false');
  dom.slideOver.hidden = false;

  // Trap focus
  requestAnimationFrame(() => {
    dom.detailClose.focus();
  });
}

function hideSlideOver() {
  dom.scrim.hidden = true;
  dom.scrim.setAttribute('aria-hidden', 'true');
  dom.slideOver.hidden = true;

  state.selectedTicketId = null;
  state.selectedTicketData = null;
  state.selectedTicketHistory = [];

  // Remove selected state from cards
  $$('.ticket-card--selected').forEach(el => {
    el.classList.remove('ticket-card--selected');
    el.removeAttribute('aria-selected');
  });

  // Restore focus
  if (previousFocus) {
    previousFocus.focus();
    previousFocus = null;
  }
}

/* ═══════════════════════════════════════════════════════════
   KEYBOARD NAVIGATION
   ═══════════════════════════════════════════════════════════ */

function handleCardKeyNav(e, card) {
  const column = card.closest('.stage-column__cards');
  if (!column) return;

  const cards = Array.from(column.querySelectorAll('.ticket-card'));
  const idx = cards.indexOf(card);

  switch (e.key) {
    case 'ArrowDown': {
      e.preventDefault();
      const next = cards[idx + 1];
      if (next) next.focus();
      break;
    }
    case 'ArrowUp': {
      e.preventDefault();
      const prev = cards[idx - 1];
      if (prev) prev.focus();
      break;
    }
    case 'ArrowLeft': {
      e.preventDefault();
      const stageCol = column.closest('.stage-column');
      const allCols = Array.from(dom.kanbanColumns.querySelectorAll('.stage-column'));
      const colIdx = allCols.indexOf(stageCol);
      if (colIdx > 0) {
        const prevCol = allCols[colIdx - 1];
        const prevCards = prevCol.querySelectorAll('.ticket-card');
        const target = prevCards[Math.min(idx, prevCards.length - 1)];
        if (target) target.focus();
        else prevCol.querySelector('.stage-column__header')?.focus();
      }
      break;
    }
    case 'ArrowRight': {
      e.preventDefault();
      const stageCol2 = column.closest('.stage-column');
      const allCols2 = Array.from(dom.kanbanColumns.querySelectorAll('.stage-column'));
      const colIdx2 = allCols2.indexOf(stageCol2);
      if (colIdx2 < allCols2.length - 1) {
        const nextCol = allCols2[colIdx2 + 1];
        const nextCards = nextCol.querySelectorAll('.ticket-card');
        const target = nextCards[Math.min(idx, nextCards.length - 1)];
        if (target) target.focus();
        else nextCol.querySelector('.stage-column__header')?.focus();
      }
      break;
    }
    case 'Escape':
      e.preventDefault();
      card.closest('.stage-column')?.querySelector('.stage-column__header')?.focus();
      break;
  }
}

function handleSlideOverKeyDown(e) {
  if (e.key === 'Escape') {
    hideSlideOver();
    return;
  }

  // Focus trap
  if (e.key === 'Tab') {
    const focusable = dom.slideOver.querySelectorAll(
      'button, [tabindex]:not([tabindex="-1"]), a[href], input, select, textarea'
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
}

/* ═══════════════════════════════════════════════════════════
   TAB NAVIGATION — TOP BAR VIEWS
   ═══════════════════════════════════════════════════════════ */

function switchView(viewName) {
  dom.tabButtons.forEach(tab => {
    const isActive = tab.dataset.view === viewName;
    tab.classList.toggle('tab-nav__tab--active', isActive);
    tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
    tab.setAttribute('tabindex', isActive ? '0' : '-1');
  });

  dom.viewPanels.forEach(panel => {
    const panelView = panel.id.replace('panel-', '');
    if (panelView === viewName) {
      panel.hidden = false;
      panel.classList.add('view-panel--active');
    } else {
      panel.hidden = true;
      panel.classList.remove('view-panel--active');
    }
  });

  // Update mobile sidebar
  dom.sidebarItems.forEach(item => {
    item.classList.toggle('mobile-sidebar__item--active', item.dataset.view === viewName);
  });

  announce(`${viewName} view active`);
}

function handleTopTabKeyDown(e) {
  const tabs = Array.from(dom.tabButtons);
  const idx = tabs.indexOf(e.target);

  switch (e.key) {
    case 'ArrowRight': {
      e.preventDefault();
      const next = tabs[(idx + 1) % tabs.length];
      next.focus();
      next.click();
      break;
    }
    case 'ArrowLeft': {
      e.preventDefault();
      const prev = tabs[(idx - 1 + tabs.length) % tabs.length];
      prev.focus();
      prev.click();
      break;
    }
    case 'Home': {
      e.preventDefault();
      tabs[0].focus();
      tabs[0].click();
      break;
    }
    case 'End': {
      e.preventDefault();
      tabs[tabs.length - 1].focus();
      tabs[tabs.length - 1].click();
      break;
    }
  }
}

/* ═══════════════════════════════════════════════════════════
   TAB NAVIGATION — DETAIL PANEL TABS
   ═══════════════════════════════════════════════════════════ */

function switchDetailTab(tabId) {
  const tabs = $$('.detail-tab');
  tabs.forEach(tab => {
    const isActive = tab.dataset.tab === tabId;
    tab.classList.toggle('detail-tab--active', isActive);
    tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
    tab.setAttribute('tabindex', isActive ? '0' : '-1');
  });

  renderTabContent(tabId, state.selectedTicketData, state.selectedTicketHistory);
}

function handleDetailTabKeyDown(e) {
  const tabs = Array.from($$('.detail-tab'));
  const idx = tabs.indexOf(e.target);

  switch (e.key) {
    case 'ArrowRight': {
      e.preventDefault();
      const next = tabs[(idx + 1) % tabs.length];
      next.focus();
      switchDetailTab(next.dataset.tab);
      break;
    }
    case 'ArrowLeft': {
      e.preventDefault();
      const prev = tabs[(idx - 1 + tabs.length) % tabs.length];
      prev.focus();
      switchDetailTab(prev.dataset.tab);
      break;
    }
    case 'Home': {
      e.preventDefault();
      tabs[0].focus();
      switchDetailTab(tabs[0].dataset.tab);
      break;
    }
    case 'End': {
      e.preventDefault();
      tabs[tabs.length - 1].focus();
      switchDetailTab(tabs[tabs.length - 1].dataset.tab);
      break;
    }
  }
}

/* ═══════════════════════════════════════════════════════════
   THEME
   ═══════════════════════════════════════════════════════════ */

function initTheme() {
  const saved = localStorage.getItem('forgeos-theme');
  if (saved) {
    document.documentElement.setAttribute('data-theme', saved);
  }
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('forgeos-theme', next);
  announce(`Theme changed to ${next} mode`);
}

/* ═══════════════════════════════════════════════════════════
   MOBILE SIDEBAR
   ═══════════════════════════════════════════════════════════ */

function openMobileSidebar() {
  dom.mobileSidebar.hidden = false;
  dom.mobileScrim.hidden = false;
  dom.hamburgerBtn.setAttribute('aria-expanded', 'true');
  dom.sidebarClose.focus();
}

function closeMobileSidebar() {
  dom.mobileSidebar.hidden = true;
  dom.mobileScrim.hidden = true;
  dom.hamburgerBtn.setAttribute('aria-expanded', 'false');
  dom.hamburgerBtn.focus();
}

/* ═══════════════════════════════════════════════════════════
   COMPACT STAGE CLICK (Bottom Row)
   ═══════════════════════════════════════════════════════════ */

function handleCompactStageClick(stage) {
  state.filters.stage = state.filters.stage === stage ? '' : stage;
  syncFiltersToDOM();
  syncFiltersToURL();
  renderBoard();
  announce(state.filters.stage ? `Filtered to ${stage} stage` : 'Stage filter cleared');
}

/* ═══════════════════════════════════════════════════════════
   UPTIME TIMER
   ═══════════════════════════════════════════════════════════ */

function startUptimeTimer() {
  setInterval(() => {
    const uptime = Date.now() - state.startTime;
    if (dom.metricUptime) dom.metricUptime.textContent = formatDuration(uptime);
  }, 1000);
}

/* ═══════════════════════════════════════════════════════════
   INITIAL DATA LOAD
   ═══════════════════════════════════════════════════════════ */

async function loadInitialData() {
  try {
    const [tickets, stages] = await Promise.all([
      fetchTickets(state.filters),
      fetchStages()
    ]);

    state.tickets = tickets;
    state.stages = stages;

    renderBoard();
    updateMetrics();
    announce('Dashboard loaded');
  } catch (err) {
    announce('Failed to load dashboard data');
  }
}

/* ═══════════════════════════════════════════════════════════
   EVENT BINDING
   ═══════════════════════════════════════════════════════════ */

function bindEvents() {
  // Theme toggle
  dom.themeToggle?.addEventListener('click', toggleTheme);

  // Mobile sidebar
  dom.hamburgerBtn?.addEventListener('click', openMobileSidebar);
  dom.sidebarClose?.addEventListener('click', closeMobileSidebar);
  dom.mobileScrim?.addEventListener('click', closeMobileSidebar);

  // Top bar view tabs
  dom.tabButtons.forEach(tab => {
    tab.addEventListener('click', () => switchView(tab.dataset.view));
    tab.addEventListener('keydown', handleTopTabKeyDown);
  });

  // Mobile sidebar view items
  dom.sidebarItems.forEach(item => {
    item.addEventListener('click', () => {
      switchView(item.dataset.view);
      closeMobileSidebar();
    });
  });

  // Filter controls
  const filterHandler = debounce(onFilterChange, 200);
  dom.filterStage?.addEventListener('change', onFilterChange);
  dom.filterType?.addEventListener('change', onFilterChange);
  dom.filterPriority?.addEventListener('change', onFilterChange);
  dom.filterMachine?.addEventListener('change', onFilterChange);
  dom.filterAgent?.addEventListener('change', onFilterChange);
  dom.filterSearch?.addEventListener('input', filterHandler);
  dom.clearFilters?.addEventListener('click', clearAllFilters);

  // Slide-over close
  dom.detailClose?.addEventListener('click', hideSlideOver);
  dom.scrim?.addEventListener('click', hideSlideOver);
  dom.slideOver?.addEventListener('keydown', handleSlideOverKeyDown);

  // Detail tabs
  $$('.detail-tab').forEach(tab => {
    tab.addEventListener('click', () => switchDetailTab(tab.dataset.tab));
    tab.addEventListener('keydown', handleDetailTabKeyDown);
  });

  // Compact stages (bottom row)
  dom.compactStages.forEach(btn => {
    btn.addEventListener('click', () => handleCompactStageClick(btn.dataset.stage));
  });

  // Global keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // Skip if focus is in input/textarea/select
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;

    // Escape closes slide-over
    if (e.key === 'Escape' && !dom.slideOver.hidden) {
      hideSlideOver();
      return;
    }

    switch (e.key) {
      case '1': switchView('pipeline'); break;
      case '2': switchView('graph'); break;
      case '3': switchView('machines'); break;
      case '4': switchView('admin'); break;
      case '/':
        e.preventDefault();
        if (dom.filterSearch) dom.filterSearch.focus();
        break;
      case '?': toggleShortcutHelp(); break;
      case 'r':
        if (state.connectionState === 'disconnected') reconnectSSE();
        break;
    }
  });
}

/* ═══════════════════════════════════════════════════════════
   AUTH USER BADGE
   ═══════════════════════════════════════════════════════════ */

function toggleAuth() {
  if (state.auth.authenticated) {
    state.auth.authenticated = false;
    state.auth.user = null;
  } else {
    state.auth.authenticated = true;
    state.auth.user = { name: 'Operator', initials: 'OP' };
  }
  updateAuthUI();
  updateActionButtonStates();
  announce(state.auth.authenticated
    ? `Signed in as ${state.auth.user.name}`
    : 'Signed out');
}

function updateAuthUI() {
  if (!dom.authBadge) return;
  const iconEl = dom.authBadge.querySelector('.auth-user-badge__icon');
  const labelEl = dom.authBadge.querySelector('.auth-user-badge__label');
  if (state.auth.authenticated) {
    dom.authBadge.classList.add('auth-user-badge--authenticated');
    dom.authBadge.setAttribute('aria-label',
      `Signed in as ${state.auth.user.name}. Click to sign out.`);
    if (iconEl) iconEl.innerHTML = `<span class="auth-user-badge__avatar">${state.auth.user.initials}</span>`;
    if (labelEl) labelEl.textContent = state.auth.user.name;
  } else {
    dom.authBadge.classList.remove('auth-user-badge--authenticated');
    dom.authBadge.setAttribute('aria-label', 'Sign in to perform operator actions');
    if (iconEl) iconEl.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
    if (labelEl) labelEl.textContent = 'Sign In';
  }
}

function initAuthBadge() {
  if (!dom.authBadge) return;
  dom.authBadge.addEventListener('click', toggleAuth);
  dom.authBadge.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleAuth(); }
  });
  updateAuthUI();
}

/* ═══════════════════════════════════════════════════════════
   CONFIRMATION MODAL
   ═══════════════════════════════════════════════════════════ */

function openConfirmationModal(title, description, callback) {
  if (!dom.confirmModal || !dom.confirmScrim) return;
  state.workbench.previousFocus = document.activeElement;
  state.workbench.confirmCallback = callback;
  if (dom.confirmTitle) dom.confirmTitle.textContent = title;
  if (dom.confirmDesc) dom.confirmDesc.textContent = description;
  if (dom.confirmReasonInput) dom.confirmReasonInput.value = '';
  if (dom.confirmCharCount) dom.confirmCharCount.textContent = '0';
  if (dom.confirmConfirmBtn) dom.confirmConfirmBtn.disabled = true;
  dom.confirmScrim.removeAttribute('hidden');
  dom.confirmScrim.removeAttribute('aria-hidden');
  if (dom.confirmModal.showModal) { dom.confirmModal.showModal(); }
  else { dom.confirmModal.removeAttribute('hidden'); }
  document.body.style.overflow = 'hidden';
  if (dom.confirmReasonInput) requestAnimationFrame(() => dom.confirmReasonInput.focus());
  announce(`Confirmation dialog opened: ${title}`);
}

function closeConfirmationModal() {
  if (!dom.confirmModal || !dom.confirmScrim) return;
  dom.confirmScrim.setAttribute('hidden', '');
  dom.confirmScrim.setAttribute('aria-hidden', 'true');
  if (dom.confirmModal.close) { dom.confirmModal.close(); }
  else { dom.confirmModal.setAttribute('hidden', ''); }
  document.body.style.overflow = '';
  state.workbench.confirmCallback = null;
  if (state.workbench.previousFocus?.focus) state.workbench.previousFocus.focus();
  state.workbench.previousFocus = null;
}

function initConfirmationModal() {
  if (!dom.confirmModal) return;
  dom.confirmCancelBtn?.addEventListener('click', closeConfirmationModal);
  dom.confirmScrim?.addEventListener('click', closeConfirmationModal);
  dom.confirmConfirmBtn?.addEventListener('click', () => {
    const val = dom.confirmReasonInput?.value.trim();
    if (val && val.length >= 10 && state.workbench.confirmCallback) {
      state.workbench.confirmCallback(val);
      closeConfirmationModal();
    }
  });
  dom.confirmReasonInput?.addEventListener('input', () => {
    const len = dom.confirmReasonInput.value.trim().length;
    if (dom.confirmCharCount) dom.confirmCharCount.textContent = len;
    if (dom.confirmConfirmBtn) dom.confirmConfirmBtn.disabled = len < 10;
  });
  dom.confirmModal.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closeConfirmationModal(); }
    if (e.key === 'Tab') {
      const arr = Array.from(dom.confirmModal.querySelectorAll('button:not([disabled]), textarea, [tabindex]:not([tabindex="-1"])'));
      if (!arr.length) return;
      if (e.shiftKey && document.activeElement === arr[0]) { e.preventDefault(); arr[arr.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === arr[arr.length - 1]) { e.preventDefault(); arr[0].focus(); }
    }
  });
}

/* ═══════════════════════════════════════════════════════════
   CLAIMS MONITOR — UTILITIES
   ═══════════════════════════════════════════════════════════ */

function formatLeaseCountdown(totalSeconds) {
  if (totalSeconds <= 0) return 'EXPIRED';
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
}

function getLeaseUrgency(seconds) {
  if (seconds <= 0) return 'expired';
  if (seconds <= 60) return 'critical';
  if (seconds <= 300) return 'warning';
  return 'normal';
}

/* ═══════════════════════════════════════════════════════════
   CLAIMS MONITOR — CORE
   ═══════════════════════════════════════════════════════════ */

function initClaimsMonitor() {
  $$('.claims-table__th--sortable').forEach(th => {
    const btn = th.querySelector('.claims-table__sort-btn');
    if (btn) {
      btn.addEventListener('click', () => {
        const col = th.getAttribute('data-sort');
        if (state.claims.sortCol === col) {
          state.claims.sortDir = state.claims.sortDir === 'asc' ? 'desc' : 'asc';
        } else { state.claims.sortCol = col; state.claims.sortDir = 'asc'; }
        updateClaimsSortIndicators();
        renderClaims();
        announce(`Claims sorted by ${col} ${state.claims.sortDir === 'asc' ? 'ascending' : 'descending'}`);
      });
    }
  });
  dom.claimsPrevBtn?.addEventListener('click', () => { if (state.claims.page > 1) { state.claims.page--; renderClaims(); } });
  dom.claimsNextBtn?.addEventListener('click', () => {
    const tp = Math.ceil(state.claims.data.length / state.claims.perPage);
    if (state.claims.page < tp) { state.claims.page++; renderClaims(); }
  });
  dom.releaseAllExpiredBtn?.addEventListener('click', () => {
    openConfirmationModal('Release All Expired Claims',
      'This will release all claims with expired leases. Affected tickets will become available for re-claiming.',
      (reason) => { state.claims.data = state.claims.data.filter(c => c.leaseRemaining > 0); renderClaims(); addActivityEntry('force-release', `Released all expired claims: ${reason}`); announce('All expired claims released'); });
  });
  state.claims.countdownIntervalId = setInterval(tickClaimsCountdowns, 1000);
  loadDemoClaimsData();
}

function loadDemoClaimsData() {
  state.claims.data = [
    { ticket: 'FORGEOS-BE001', agent: 'Backend', machine: 'pop-os', operator: 'reaperoak', leaseRemaining: 1620 },
    { ticket: 'FORGEOS-BE003', agent: 'Backend', machine: 'dev-server', operator: 'reaperoak', leaseRemaining: 420 },
    { ticket: 'FORGEOS-UID004', agent: 'Frontend', machine: 'pop-os', operator: 'reaperoak', leaseRemaining: 1740 },
    { ticket: 'FORGEOS-QA002', agent: 'QA', machine: 'ci-runner-01', operator: 'alice', leaseRemaining: 45 },
    { ticket: 'FORGEOS-SEC001', agent: 'Security', machine: 'sec-box', operator: 'bob', leaseRemaining: 0 },
    { ticket: 'FORGEOS-DO005', agent: 'Documentation', machine: 'pop-os', operator: 'reaperoak', leaseRemaining: 890 },
  ];
  renderClaims();
}

function tickClaimsCountdowns() {
  let changed = false;
  state.claims.data.forEach(c => { if (c.leaseRemaining > 0) { c.leaseRemaining--; changed = true; } });
  if (changed) { updateClaimsCountdownDisplays(); updateReleaseAllBtn(); }
}

function updateClaimsCountdownDisplays() {
  dom.claimsTableBody?.querySelectorAll('.claims-table__row').forEach(row => {
    const link = row.querySelector('.claims-table__link');
    if (!link) return;
    const claim = state.claims.data.find(c => c.ticket === link.textContent);
    if (!claim) return;
    const timer = row.querySelector('.countdown-timer');
    const urg = getLeaseUrgency(claim.leaseRemaining);
    if (timer) {
      timer.textContent = formatLeaseCountdown(claim.leaseRemaining);
      timer.className = `countdown-timer countdown-timer--${urg}`;
      if (urg === 'critical' && claim.leaseRemaining % 15 === 0) timer.setAttribute('aria-live', 'assertive');
      else if (urg === 'warning' && claim.leaseRemaining % 60 === 0) timer.setAttribute('aria-live', 'polite');
      else timer.setAttribute('aria-live', 'off');
    }
    row.setAttribute('data-urgency', urg);
  });
  dom.claimsCards?.querySelectorAll('.claim-card').forEach(card => {
    const ticketEl = card.querySelector('.claim-card__ticket');
    if (!ticketEl) return;
    const claim = state.claims.data.find(c => c.ticket === ticketEl.textContent);
    if (!claim) return;
    const timer = card.querySelector('.countdown-timer');
    const urg = getLeaseUrgency(claim.leaseRemaining);
    if (timer) { timer.textContent = formatLeaseCountdown(claim.leaseRemaining); timer.className = `countdown-timer countdown-timer--${urg}`; }
    card.setAttribute('data-urgency', urg);
  });
}

function updateReleaseAllBtn() {
  if (!dom.releaseAllExpiredBtn) return;
  dom.releaseAllExpiredBtn.disabled = !state.claims.data.some(c => c.leaseRemaining <= 0) || !state.auth.authenticated;
}

function updateClaimsSortIndicators() {
  $$('.claims-table__th--sortable').forEach(th => {
    const col = th.getAttribute('data-sort');
    const icon = th.querySelector('.claims-table__sort-icon');
    if (col === state.claims.sortCol) {
      th.setAttribute('aria-sort', state.claims.sortDir === 'asc' ? 'ascending' : 'descending');
      if (icon) icon.textContent = state.claims.sortDir === 'asc' ? '\u25B2' : '\u25BC';
    } else { th.setAttribute('aria-sort', 'none'); if (icon) icon.textContent = ''; }
  });
}

function renderClaims() {
  const data = state.claims.data;
  const col = state.claims.sortCol;
  const dir = state.claims.sortDir;
  const sorted = data.slice().sort((a, b) => {
    let vA = a[col], vB = b[col];
    if (typeof vA === 'string') { vA = vA.toLowerCase(); vB = (vB || '').toLowerCase(); }
    const cmp = vA < vB ? -1 : vA > vB ? 1 : 0;
    return dir === 'asc' ? cmp : -cmp;
  });
  const totalPages = Math.max(1, Math.ceil(sorted.length / state.claims.perPage));
  state.claims.page = Math.min(state.claims.page, totalPages);
  const start = (state.claims.page - 1) * state.claims.perPage;
  const pageItems = sorted.slice(start, start + state.claims.perPage);

  renderClaimsTable(pageItems);
  renderClaimsCards(pageItems);

  if (sorted.length === 0) {
    dom.claimsEmpty?.removeAttribute('hidden');
    const wrap = document.querySelector('.claims-table-wrap');
    if (wrap) wrap.style.display = 'none';
    if (dom.claimsCards) dom.claimsCards.style.display = 'none';
  } else {
    dom.claimsEmpty?.setAttribute('hidden', '');
    const wrap = document.querySelector('.claims-table-wrap');
    if (wrap) wrap.style.display = '';
    if (dom.claimsCards) dom.claimsCards.style.display = '';
  }
  if (dom.claimsPagination) {
    dom.claimsPagination[sorted.length > state.claims.perPage ? 'removeAttribute' : 'setAttribute']('hidden', '');
  }
  if (dom.claimsPaginationInfo) dom.claimsPaginationInfo.textContent = `Showing ${start + 1}\u2013${Math.min(start + state.claims.perPage, sorted.length)} of ${sorted.length} claims`;
  if (dom.claimsPageNum) dom.claimsPageNum.textContent = state.claims.page;
  if (dom.claimsPrevBtn) dom.claimsPrevBtn.disabled = state.claims.page <= 1;
  if (dom.claimsNextBtn) dom.claimsNextBtn.disabled = state.claims.page >= totalPages;
  updateClaimsSortIndicators();
  updateReleaseAllBtn();
}

function renderClaimsTable(items) {
  if (!dom.claimsTableBody) return;
  dom.claimsTableBody.innerHTML = '';
  items.forEach(claim => {
    let row;
    if (dom.claimRowTemplate) { row = dom.claimRowTemplate.content.cloneNode(true).querySelector('tr'); }
    else { row = document.createElement('tr'); row.className = 'claims-table__row'; }
    const urg = getLeaseUrgency(claim.leaseRemaining);
    row.setAttribute('data-urgency', urg);
    row.setAttribute('data-ticket', claim.ticket);
    const link = row.querySelector('.claims-table__link');
    if (link) { link.textContent = claim.ticket; link.href = '#'; link.addEventListener('click', (e) => { e.preventDefault(); selectTicketInWorkbench(claim.ticket); }); }
    const agentTd = row.querySelector('.claims-table__td--agent'); if (agentTd) agentTd.textContent = claim.agent;
    const machineTd = row.querySelector('.claims-table__td--machine'); if (machineTd) machineTd.textContent = claim.machine;
    const operatorTd = row.querySelector('.claims-table__td--operator'); if (operatorTd) operatorTd.textContent = claim.operator;
    const timer = row.querySelector('.countdown-timer');
    if (timer) { timer.textContent = formatLeaseCountdown(claim.leaseRemaining); timer.className = `countdown-timer countdown-timer--${urg}`; }
    const releaseBtn = row.querySelector('.claims-release-btn');
    if (releaseBtn) { releaseBtn.setAttribute('aria-label', `Release claim on ${claim.ticket}`); releaseBtn.disabled = !state.auth.authenticated; releaseBtn.addEventListener('click', () => handleReleaseClaim(claim.ticket)); }
    dom.claimsTableBody.appendChild(row);
  });
}

function renderClaimsCards(items) {
  if (!dom.claimsCards) return;
  dom.claimsCards.innerHTML = '';
  items.forEach(claim => {
    let card;
    if (dom.claimCardTemplate) { card = dom.claimCardTemplate.content.cloneNode(true).querySelector('.claim-card'); }
    else { card = document.createElement('div'); card.className = 'claim-card'; }
    const urg = getLeaseUrgency(claim.leaseRemaining);
    card.setAttribute('data-urgency', urg);
    const ticketEl = card.querySelector('.claim-card__ticket'); if (ticketEl) ticketEl.textContent = claim.ticket;
    const timer = card.querySelector('.countdown-timer');
    if (timer) { timer.textContent = formatLeaseCountdown(claim.leaseRemaining); timer.className = `countdown-timer countdown-timer--${urg}`; }
    const agentEl = card.querySelector('.claim-card__agent'); if (agentEl) agentEl.textContent = claim.agent;
    const machineEl = card.querySelector('.claim-card__machine'); if (machineEl) machineEl.textContent = claim.machine;
    const operatorEl = card.querySelector('.claim-card__operator'); if (operatorEl) operatorEl.textContent = claim.operator;
    const releaseBtn = card.querySelector('.claims-release-btn');
    if (releaseBtn) { releaseBtn.setAttribute('aria-label', `Release claim on ${claim.ticket}`); releaseBtn.disabled = !state.auth.authenticated; releaseBtn.addEventListener('click', () => handleReleaseClaim(claim.ticket)); }
    dom.claimsCards.appendChild(card);
  });
}

function handleReleaseClaim(ticketId) {
  if (!state.auth.authenticated) return;
  openConfirmationModal(`Release Claim: ${ticketId}`,
    `This will release the claim on ${ticketId}. The ticket will become available for re-claiming by any operator.`,
    (reason) => { state.claims.data = state.claims.data.filter(c => c.ticket !== ticketId); renderClaims(); addActivityEntry('release', `Released claim on ${ticketId}: ${reason}`); announce(`Claim on ${ticketId} released`); });
}

/* ═══════════════════════════════════════════════════════════
   OPERATOR WORKBENCH
   ═══════════════════════════════════════════════════════════ */

const workbenchTicketData = [
  { id: 'FORGEOS-BE001', title: 'PostgreSQL connection pooling', stage: 'BACKEND', claimed_by: 'Backend', machine: 'pop-os', leaseRemaining: 1620 },
  { id: 'FORGEOS-BE003', title: 'Event sourcing schema migration', stage: 'BACKEND', claimed_by: 'Backend', machine: 'dev-server', leaseRemaining: 420 },
  { id: 'FORGEOS-UID004', title: 'Operator Workbench & Claims Monitor', stage: 'FRONTEND', claimed_by: 'Frontend', machine: 'pop-os', leaseRemaining: 1740 },
  { id: 'FORGEOS-QA002', title: 'QA validation pipeline', stage: 'QA', claimed_by: 'QA', machine: 'ci-runner-01', leaseRemaining: 45 },
  { id: 'FORGEOS-SEC001', title: 'Security audit framework', stage: 'SECURITY', claimed_by: 'Security', machine: 'sec-box', leaseRemaining: 0 },
  { id: 'FORGEOS-FE002', title: 'Dashboard graph view', stage: 'READY', claimed_by: null, machine: null, leaseRemaining: null },
  { id: 'FORGEOS-DO005', title: 'API documentation', stage: 'DOCS', claimed_by: 'Documentation', machine: 'pop-os', leaseRemaining: 890 },
];

function initWorkbench() {
  if (!dom.workbenchTicketSearch) return;
  dom.workbenchTicketSearch.addEventListener('input', debounce(() => {
    const query = dom.workbenchTicketSearch.value.trim().toUpperCase();
    if (query.length < 2) { dom.workbenchDropdown?.setAttribute('hidden', ''); return; }
    const matches = workbenchTicketData.filter(t => t.id.toUpperCase().includes(query));
    if (!matches.length) { dom.workbenchDropdown?.setAttribute('hidden', ''); return; }
    if (dom.workbenchDropdown) {
      dom.workbenchDropdown.innerHTML = '';
      matches.forEach(t => {
        const opt = document.createElement('div');
        opt.className = 'workbench-selector__option';
        opt.setAttribute('role', 'option');
        opt.textContent = `${t.id} \u2014 ${t.title}`;
        opt.addEventListener('click', () => { selectWorkbenchTicket(t); dom.workbenchDropdown.setAttribute('hidden', ''); dom.workbenchTicketSearch.value = t.id; });
        dom.workbenchDropdown.appendChild(opt);
      });
      dom.workbenchDropdown.removeAttribute('hidden');
    }
  }, 200));
  document.addEventListener('click', (e) => {
    if (!dom.workbenchTicketSearch?.contains(e.target) && !dom.workbenchDropdown?.contains(e.target)) dom.workbenchDropdown?.setAttribute('hidden', '');
  });
  dom.workbenchTicketSearch.addEventListener('keydown', (e) => { if (e.key === 'Escape') dom.workbenchDropdown?.setAttribute('hidden', ''); });

  dom.actionClaim?.addEventListener('click', () => {
    const t = state.workbench.selectedTicket;
    if (!t || !state.auth.authenticated) return;
    addActivityEntry('claim', `Claimed ${t.id} as ${state.auth.user.name}`);
    t.claimed_by = state.auth.user.name; t.machine = 'pop-os'; t.leaseRemaining = 1800;
    updateWorkbenchSelectionUI(); updateActionButtonStates(); announce(`Claimed ticket ${t.id}`);
  });
  dom.actionRelease?.addEventListener('click', () => {
    const t = state.workbench.selectedTicket;
    if (!t || !state.auth.authenticated) return;
    openConfirmationModal(`Release Claim: ${t.id}`, 'Release your claim on this ticket. It will become available for other operators.',
      (reason) => { addActivityEntry('release', `Released ${t.id}: ${reason}`); t.claimed_by = null; t.machine = null; t.leaseRemaining = null; updateWorkbenchSelectionUI(); updateActionButtonStates(); announce(`Released ${t.id}`); });
  });
  dom.actionAdvance?.addEventListener('click', () => {
    const t = state.workbench.selectedTicket;
    if (!t || !state.auth.authenticated) return;
    addActivityEntry('advance', `Advanced ${t.id} from ${t.stage}`); t.stage = 'NEXT';
    updateWorkbenchSelectionUI(); updateActionButtonStates(); announce(`Advanced ${t.id}`);
  });
  dom.actionForceRelease?.addEventListener('click', () => {
    const t = state.workbench.selectedTicket;
    if (!t || !state.auth.authenticated) return;
    openConfirmationModal(`Force Release: ${t.id}`, "WARNING: This will forcefully release another operator's claim. Use only when absolutely necessary.",
      (reason) => { addActivityEntry('force-release', `Force-released ${t.id}: ${reason}`); t.claimed_by = null; t.machine = null; t.leaseRemaining = null; updateWorkbenchSelectionUI(); updateActionButtonStates(); announce(`Force-released ${t.id}`); });
  });
}

function selectWorkbenchTicket(ticket) {
  state.workbench.selectedTicket = ticket;
  updateWorkbenchSelectionUI(); updateActionButtonStates();
  announce(`Selected ticket ${ticket.id}`);
}

function selectTicketInWorkbench(ticketId) {
  const ticket = workbenchTicketData.find(t => t.id === ticketId);
  if (ticket) {
    const wbTab = document.querySelector('[data-view="workbench"]');
    if (wbTab) wbTab.click();
    selectWorkbenchTicket(ticket);
    if (dom.workbenchTicketSearch) dom.workbenchTicketSearch.value = ticketId;
  }
}

function updateWorkbenchSelectionUI() {
  if (!dom.workbenchSelection) return;
  const t = state.workbench.selectedTicket;
  if (!t) { dom.workbenchSelection.setAttribute('hidden', ''); return; }
  dom.workbenchSelection.removeAttribute('hidden');
  const fields = { wbTicketId: t.id, wbTitle: t.title, wbStage: t.stage, wbClaimedBy: t.claimed_by || 'Unclaimed', wbMachine: t.machine || '\u2014', wbLease: t.leaseRemaining != null ? formatLeaseCountdown(t.leaseRemaining) : '\u2014' };
  Object.entries(fields).forEach(([id, val]) => { const el = document.getElementById(id); if (el) el.textContent = val; });
}

function updateActionButtonStates() {
  const isAuth = state.auth.authenticated;
  const t = state.workbench.selectedTicket;
  const hasTicket = t != null;
  const isClaimed = hasTicket && t.claimed_by != null;
  const isOwn = isClaimed && state.auth.user && t.claimed_by === state.auth.user.name;
  const isUnclaimed = hasTicket && !t.claimed_by;
  if (dom.actionClaim) dom.actionClaim.disabled = !(isAuth && hasTicket && isUnclaimed);
  if (dom.actionRelease) dom.actionRelease.disabled = !(isAuth && hasTicket && isOwn);
  if (dom.actionAdvance) dom.actionAdvance.disabled = !(isAuth && hasTicket && isOwn);
  if (dom.actionForceRelease) dom.actionForceRelease.disabled = !(isAuth && hasTicket && isClaimed && !isOwn);
  updateReleaseAllBtn();
}

/* ═══════════════════════════════════════════════════════════
   ACTIVITY LOG
   ═══════════════════════════════════════════════════════════ */

function addActivityEntry(type, message) {
  if (!dom.activityLog) return;
  if (dom.activityEmpty) dom.activityEmpty.setAttribute('hidden', '');
  let entry;
  if (dom.activityEntryTemplate) { entry = dom.activityEntryTemplate.content.cloneNode(true).querySelector('.activity-entry'); }
  else { entry = document.createElement('div'); entry.className = 'activity-entry'; }
  entry.classList.add(`activity-entry--${type}`);
  const actionEl = entry.querySelector('.activity-entry__action'); if (actionEl) actionEl.textContent = message;
  const timeEl = entry.querySelector('.activity-entry__time');
  if (timeEl) { const now = new Date(); timeEl.setAttribute('datetime', now.toISOString()); timeEl.textContent = now.toLocaleTimeString(); }
  dom.activityLog.insertBefore(entry, dom.activityLog.firstChild);
  while (dom.activityLog.children.length > 50) dom.activityLog.removeChild(dom.activityLog.lastChild);
}

/* ═══════════════════════════════════════════════════════════
   MULTI-MACHINE STATUS
   ═══════════════════════════════════════════════════════════ */

const machinesDataDemo = [
  { hostname: 'pop-os', status: 'connected', agents: ['Backend', 'Frontend', 'Documentation'], claims: 3, maxClaims: 10, throughput: 7, maxThroughput: 20, lastHeartbeat: new Date(Date.now() - 5000) },
  { hostname: 'dev-server', status: 'connected', agents: ['Backend'], claims: 1, maxClaims: 10, throughput: 3, maxThroughput: 20, lastHeartbeat: new Date(Date.now() - 12000) },
  { hostname: 'ci-runner-01', status: 'reconnecting', agents: ['QA'], claims: 1, maxClaims: 10, throughput: 12, maxThroughput: 20, lastHeartbeat: new Date(Date.now() - 45000) },
  { hostname: 'sec-box', status: 'disconnected', agents: [], claims: 0, maxClaims: 10, throughput: 0, maxThroughput: 20, lastHeartbeat: new Date(Date.now() - 300000) },
];

function initMachines() { renderMachines(machinesDataDemo); }

function renderMachines(machines) {
  if (!dom.machinesGrid) return;
  dom.machinesGrid.innerHTML = '';
  if (!machines.length) { dom.machinesEmpty?.removeAttribute('hidden'); return; }
  dom.machinesEmpty?.setAttribute('hidden', '');
  machines.forEach(machine => {
    let card;
    if (dom.machineCardTemplate) { card = dom.machineCardTemplate.content.cloneNode(true).querySelector('.machine-card'); }
    else { card = document.createElement('article'); card.className = 'machine-card'; }
    const hostnameEl = card.querySelector('.machine-card__hostname'); if (hostnameEl) hostnameEl.textContent = machine.hostname;
    const statusDot = card.querySelector('.machine-card__status-dot');
    if (statusDot) { statusDot.classList.add(`status-dot--${machine.status}`); statusDot.setAttribute('aria-label', machine.status); }
    const agentsList = card.querySelector('.machine-card__agents-list');
    if (agentsList) {
      agentsList.innerHTML = '';
      if (!machine.agents.length) { const li = document.createElement('li'); li.textContent = 'None'; li.style.cssText = 'color:var(--color-text-secondary);font-size:var(--text-xs)'; agentsList.appendChild(li); }
      else machine.agents.forEach(a => { const li = document.createElement('li'); li.textContent = a; agentsList.appendChild(li); });
    }
    const meters = card.querySelectorAll('.machine-card__meter');
    const metricValues = card.querySelectorAll('.machine-card__metric-value');
    if (meters.length >= 2) {
      meters[0].setAttribute('aria-valuenow', machine.claims); meters[0].setAttribute('aria-valuemax', machine.maxClaims);
      const fill0 = meters[0].querySelector('.machine-card__meter-fill'); if (fill0) fill0.style.width = `${(machine.claims / machine.maxClaims) * 100}%`;
      if (metricValues[0]) metricValues[0].textContent = machine.claims;
      meters[1].setAttribute('aria-valuenow', machine.throughput); meters[1].setAttribute('aria-valuemax', machine.maxThroughput);
      const fill1 = meters[1].querySelector('.machine-card__meter-fill'); if (fill1) fill1.style.width = `${(machine.throughput / machine.maxThroughput) * 100}%`;
      if (metricValues[1]) metricValues[1].textContent = `${machine.throughput}/hr`;
    }
    const hbTime = card.querySelector('.machine-card__heartbeat-time');
    if (hbTime && machine.lastHeartbeat) {
      hbTime.setAttribute('datetime', machine.lastHeartbeat.toISOString());
      const secsAgo = Math.floor((Date.now() - machine.lastHeartbeat.getTime()) / 1000);
      hbTime.textContent = secsAgo < 60 ? `${secsAgo}s ago` : secsAgo < 3600 ? `${Math.floor(secsAgo / 60)}m ago` : `${Math.floor(secsAgo / 3600)}h ago`;
    }
    dom.machinesGrid.appendChild(card);
  });
}

/* ═══════════════════════════════════════════════════════════
   KEYBOARD SHORTCUT HELP OVERLAY
   ═══════════════════════════════════════════════════════════ */

function toggleShortcutHelp() {
  var overlay = document.getElementById('shortcut-help');
  if (overlay) {
    overlay.remove();
    announce('Keyboard shortcut help closed');
    return;
  }
  overlay = document.createElement('div');
  overlay.id = 'shortcut-help';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Keyboard shortcuts');
  overlay.className = 'shortcut-help-overlay';
  overlay.innerHTML =
    '<div class="shortcut-help-overlay__backdrop"></div>' +
    '<div class="shortcut-help-overlay__content">' +
    '<h2>Keyboard Shortcuts</h2>' +
    '<dl>' +
    '<dt><kbd>1</kbd></dt><dd>Pipeline view</dd>' +
    '<dt><kbd>2</kbd></dt><dd>Graph view</dd>' +
    '<dt><kbd>3</kbd></dt><dd>Machines view</dd>' +
    '<dt><kbd>4</kbd></dt><dd>Admin view</dd>' +
    '<dt><kbd>/</kbd></dt><dd>Focus search</dd>' +
    '<dt><kbd>Esc</kbd></dt><dd>Close panel / modal</dd>' +
    '<dt><kbd>?</kbd></dt><dd>Toggle this help</dd>' +
    '<dt><kbd>r</kbd></dt><dd>Retry connection (when disconnected)</dd>' +
    '</dl>' +
    '<button class="btn btn--ghost" aria-label="Close shortcut help">Close</button>' +
    '</div>';
  document.body.appendChild(overlay);
  var closeBtn = overlay.querySelector('button');
  closeBtn.addEventListener('click', toggleShortcutHelp);
  overlay.querySelector('.shortcut-help-overlay__backdrop')
    .addEventListener('click', toggleShortcutHelp);
  closeBtn.focus();
  announce('Keyboard shortcut help opened');
}

/* ═══════════════════════════════════════════════════════════
   INITIALIZATION
   ═══════════════════════════════════════════════════════════ */

function init() {
  cacheDom();
  initTheme();
  readFiltersFromURL();
  syncFiltersToDOM();
  bindEvents();
  loadInitialData();
  connectSSE();
  startUptimeTimer();
  initAuthBadge();
  initConfirmationModal();
  initClaimsMonitor();
  initWorkbench();
  initMachines();

  /* Expose shared surface for pipeline.js & admin.js */
  window.ForgeOS = {
    registerHandler: registerHandler,
    unregisterHandler: unregisterHandler,
    getConnectionState: getConnectionState,
    reconnect: reconnectSSE,

    /* Shared utilities */
    state: state,
    dom: dom,
    $: $,
    $$: $$,
    announce: announce,
    escapeHtml: escapeHtml,
    formatDuration: formatDuration,
    formatRelativeTime: formatRelativeTime,
    formatLeaseRemaining: formatLeaseRemaining,
    formatTimestamp: formatTimestamp,
    formatLeaseCountdown: formatLeaseCountdown,
    getLeaseUrgency: getLeaseUrgency,
    getClaimStatus: getClaimStatus,
    debounce: debounce,
    fetchJSON: fetchJSON,
    getMachineColor: getMachineColor,
    hashString: hashString,
    showToast: showToast,
    openTicketDetail: openTicketDetail,
    openConfirmationModal: openConfirmationModal,

    /* Constants */
    STAGES_MAIN: STAGES_MAIN,
    STAGES_BOTTOM: STAGES_BOTTOM,
    ALL_STAGES: ALL_STAGES,
    TYPE_COLORS: TYPE_COLORS,
    TYPE_LABELS: TYPE_LABELS,
    PRIORITY_ORDER: PRIORITY_ORDER,
    MACHINE_PALETTE: MACHINE_PALETTE
  };
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
