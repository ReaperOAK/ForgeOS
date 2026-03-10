/**
 * ForgeOS Dashboard — Pipeline (Kanban) Module
 * Ticket: TASK-FOS-05-004
 *
 * Responsibilities:
 *   - Fetch initial ticket data from GET /api/tickets
 *   - Render Kanban board with ticket cards (individual updates, no full re-render)
 *   - SSE event handling for ticket lifecycle events
 *   - Lease countdown timers (MM:SS remaining / EXPIRED)
 *   - Client-side filtering with URL sync and AND logic
 *   - Event delegation for card clicks & filter changes
 *   - WCAG 2.2 AA accessible (aria-live, keyboard nav, reduced motion)
 */

'use strict';

(function PipelineModule() {
  /* ── Wait for app.js to expose ForgeOS ── */
  function boot() {
    if (!window.ForgeOS) {
      setTimeout(boot, 50);
      return;
    }
    initPipeline();
  }

  /* ═══════════════════════════════════════════════════════════
     CONSTANTS & REFS
     ═══════════════════════════════════════════════════════════ */

  var FOS;
  var STAGES_MAIN;
  var STAGES_BOTTOM;
  var ALL_STAGES;
  var PRIORITY_ORDER;
  var TYPE_COLORS;
  var TYPE_LABELS;

  /** Map<ticketId, TicketData> — source of truth for pipeline state */
  var ticketsMap = new Map();

  /** Map<ticketId, number> — lease expiry timestamps (Date.now() ms) */
  var leaseTimers = new Map();

  /** Global lease tick interval */
  var leaseIntervalId = null;

  /** Current filter state */
  var filters = {
    stage: '',
    type: '',
    priority: '',
    machine: '',
    agent: '',
    search: ''
  };

  /** Filter count badge element (lazy-created) */
  var filterCountBadge = null;

  /* ═══════════════════════════════════════════════════════════
     INITIALIZATION
     ═══════════════════════════════════════════════════════════ */

  function initPipeline() {
    FOS = window.ForgeOS;
    STAGES_MAIN = FOS.STAGES_MAIN;
    STAGES_BOTTOM = FOS.STAGES_BOTTOM;
    ALL_STAGES = FOS.ALL_STAGES;
    PRIORITY_ORDER = FOS.PRIORITY_ORDER;
    TYPE_COLORS = FOS.TYPE_COLORS;
    TYPE_LABELS = FOS.TYPE_LABELS;

    /* Read initial filters from URL */
    readFiltersFromURL();

    /* Set up event delegation for the board */
    setupEventDelegation();

    /* Fetch initial data */
    fetchInitialTickets();

    /* Start global lease countdown ticker (1 s) */
    leaseIntervalId = setInterval(tickLeaseCountdowns, 1000);

    /* Register as SSE handler */
    FOS.registerHandler('pipeline', {
      handleEvent: handleSSEEvent
    });
  }

  /* ═══════════════════════════════════════════════════════════
     INITIAL DATA FETCH
     ═══════════════════════════════════════════════════════════ */

  function fetchInitialTickets() {
    FOS.fetchJSON('/api/tickets?limit=500')
      .then(function (result) {
        var data = result.data || result;
        if (!Array.isArray(data)) data = [];

        ticketsMap.clear();
        data.forEach(function (t) {
          ticketsMap.set(t.id, t);
        });

        renderFullBoard();
        startLeaseTimersForAll();
        FOS.announce('Pipeline loaded with ' + ticketsMap.size + ' tickets');
      })
      .catch(function () {
        showBoardError();
      });
  }

  /* ═══════════════════════════════════════════════════════════
     SSE EVENT HANDLER
     ═══════════════════════════════════════════════════════════ */

  function handleSSEEvent(eventType, data) {
    switch (eventType) {
      /* Legacy compat: full snapshot replaces all */
      case 'snapshot': {
        var tickets = data.recent_tickets;
        if (Array.isArray(tickets)) {
          ticketsMap.clear();
          tickets.forEach(function (t) { ticketsMap.set(t.id, t); });
          renderFullBoard();
          startLeaseTimersForAll();
        }
        break;
      }

      /* Legacy compat: generic ticket-update */
      case 'ticket-update':
      case 'ticket_update': {
        var ticket = data.ticket || data;
        if (ticket && ticket.id) {
          ticketsMap.set(ticket.id, Object.assign(ticketsMap.get(ticket.id) || {}, ticket));
          updateCardInDOM(ticket.id);
        }
        break;
      }

      case 'ticket_created': {
        var t = data.ticket || data;
        if (t && t.id) {
          ticketsMap.set(t.id, t);
          addCardToColumn(t.id);
        }
        break;
      }

      case 'ticket_claimed': {
        var existing = ticketsMap.get(data.ticketId);
        if (existing) {
          existing.claimed_by = data.agent || existing.claimed_by;
          existing.machine_id = data.machine || existing.machine_id;
          existing.lease_expiry = data.leaseExpiry || existing.lease_expiry;
          updateCardInDOM(data.ticketId);
          if (existing.lease_expiry) {
            startLeaseTimer(data.ticketId, existing.lease_expiry);
          }
        }
        break;
      }

      case 'stage_advanced': {
        var ex = ticketsMap.get(data.ticketId);
        if (ex) {
          var oldStage = ex.stage;
          ex.stage = data.toStage || ex.stage;
          moveCardBetweenColumns(data.ticketId, oldStage, ex.stage);
        }
        break;
      }

      case 'ticket_rejected': {
        var rej = ticketsMap.get(data.ticketId);
        if (rej) {
          rej.rework_count = data.reworkCount || (rej.rework_count || 0) + 1;
          flashCard(data.ticketId, 'rejected');
          updateCardInDOM(data.ticketId);
        }
        break;
      }

      case 'ticket_completed': {
        var comp = ticketsMap.get(data.ticketId);
        if (comp) {
          var fromStage = comp.stage;
          comp.stage = 'DONE';
          moveCardBetweenColumns(data.ticketId, fromStage, 'DONE');
          stopLeaseTimer(data.ticketId);
        }
        break;
      }

      case 'lease_expired': {
        var le = ticketsMap.get(data.ticketId);
        if (le) {
          le.lease_expiry = new Date(0).toISOString(); // force expired
          updateCardInDOM(data.ticketId);
          stopLeaseTimer(data.ticketId);
        }
        break;
      }

      case 'lease_extended': {
        var ext = ticketsMap.get(data.ticketId);
        if (ext) {
          ext.lease_expiry = data.newExpiry;
          startLeaseTimer(data.ticketId, data.newExpiry);
          updateCardInDOM(data.ticketId);
        }
        break;
      }

      case 'ticket_escalated': {
        var esc = ticketsMap.get(data.ticketId);
        if (esc) {
          var prevStage = esc.stage;
          esc.stage = 'ESCALATED';
          moveCardBetweenColumns(data.ticketId, prevStage, 'ESCALATED');
        }
        break;
      }
    }
  }

  /* ═══════════════════════════════════════════════════════════
     RENDERING — FULL BOARD (initial + snapshot)
     ═══════════════════════════════════════════════════════════ */

  function renderFullBoard() {
    ALL_STAGES.forEach(function (stage) {
      var col = document.getElementById('col-' + stage);
      if (!col) return;
      col.innerHTML = '';
    });

    /* Sort tickets by priority then time */
    var sorted = Array.from(ticketsMap.values()).sort(function (a, b) {
      var pa = PRIORITY_ORDER[a.priority] != null ? PRIORITY_ORDER[a.priority] : 4;
      var pb = PRIORITY_ORDER[b.priority] != null ? PRIORITY_ORDER[b.priority] : 4;
      if (pa !== pb) return pa - pb;
      var ta = a.claimed_at ? new Date(a.claimed_at).getTime() : 0;
      var tb = b.claimed_at ? new Date(b.claimed_at).getTime() : 0;
      return tb - ta;
    });

    sorted.forEach(function (ticket) {
      var col = document.getElementById('col-' + ticket.stage);
      if (!col) return;
      var card = createCard(ticket);
      col.appendChild(card);
    });

    applyFiltersToDOM();
    updateAllColumnCounts();
  }

  /* ═══════════════════════════════════════════════════════════
     RENDERING — INDIVIDUAL CARD CREATE / UPDATE
     ═══════════════════════════════════════════════════════════ */

  function createCard(ticket) {
    var card = document.createElement('article');
    card.className = 'ticket-card';
    card.setAttribute('role', 'listitem');
    card.setAttribute('tabindex', '0');
    card.dataset.ticketId = ticket.id || '';
    card.dataset.stage = ticket.stage || '';
    card.dataset.priority = ticket.priority || '';
    card.dataset.type = ticket.type || '';
    card.dataset.machine = ticket.machine_id || '';
    card.dataset.agent = ticket.claimed_by || '';

    populateCardContent(card, ticket);
    return card;
  }

  function populateCardContent(card, ticket) {
    var claimStatus = FOS.getClaimStatus(ticket);
    card.dataset.claimStatus = claimStatus;

    /* Clear class modifiers and re-apply */
    card.className = 'ticket-card ticket-card--' + claimStatus;

    /* Header row */
    var header = '<div class="ticket-card__header">' +
      '<span class="ticket-card__id">' + FOS.escapeHtml(ticket.id) + '</span>';
    if (ticket.machine_id) {
      header += '<span class="ticket-card__machine-badge" ' +
        'style="background-color:' + FOS.getMachineColor(ticket.machine_id) + '">' +
        FOS.escapeHtml(ticket.machine_id) + '</span>';
    }
    header += '</div>';

    /* Title */
    var title = '<div class="ticket-card__title">' + FOS.escapeHtml(ticket.title || '') + '</div>';

    /* Meta row */
    var meta = '<div class="ticket-card__meta">';
    if (ticket.priority) {
      meta += '<span class="ticket-card__priority-badge badge--priority-' + ticket.priority + '">' +
        FOS.escapeHtml(ticket.priority) + '</span>';
    }
    if (ticket.type) {
      var typeLabel = TYPE_LABELS[ticket.type] || ticket.type;
      meta += '<span class="ticket-card__type" style="background-color:' +
        (TYPE_COLORS[ticket.type] || 'var(--color-secondary)') +
        ';color:var(--color-text-inverse)">' + FOS.escapeHtml(typeLabel) + '</span>';
    }
    if (ticket.claimed_by) {
      meta += '<span class="ticket-card__agent">' +
        '<span class="claim-dot claim-dot--claimed" aria-hidden="true"></span> ' +
        FOS.escapeHtml(ticket.claimed_by) + '</span>';
    } else {
      meta += '<span class="ticket-card__agent">' +
        '<span class="claim-dot claim-dot--unclaimed" aria-hidden="true"></span> ' +
        '<em>Unclaimed</em></span>';
    }
    /* Time in stage */
    var timeText = '';
    if (ticket.claimed_at) {
      var elapsed = Date.now() - new Date(ticket.claimed_at).getTime();
      timeText = FOS.formatDuration(elapsed);
    } else if (ticket.created_at) {
      timeText = FOS.formatRelativeTime(ticket.created_at);
    }
    if (timeText) {
      meta += '<span class="ticket-card__time-in-stage">' + FOS.escapeHtml(timeText) + '</span>';
    }
    meta += '</div>';

    /* Rework badge */
    var rework = '';
    var reworkCount = ticket.rework_count || 0;
    if (reworkCount > 0) {
      rework = '<span class="ticket-card__rework">R' + reworkCount + '</span>';
    }

    /* Lease countdown */
    var lease = '';
    if (ticket.claimed_by && ticket.lease_expiry) {
      var remaining = new Date(ticket.lease_expiry).getTime() - Date.now();
      var display, urgency;
      if (remaining <= 0) {
        display = 'EXPIRED';
        urgency = 'expired';
      } else {
        display = formatCountdown(remaining);
        urgency = FOS.getLeaseUrgency(Math.floor(remaining / 1000));
      }
      lease = '<div class="ticket-card__lease" aria-label="Lease remaining: ' +
        display + '">' +
        '<span class="ticket-card__countdown countdown--' + urgency + '">' + display + '</span>' +
        '<span class="ticket-card__countdown-label">' +
        (remaining <= 0 ? '' : 'remaining') + '</span></div>';
    }

    card.innerHTML = header + title + meta + rework + lease;

    /* ARIA label */
    var ariaLabel = [
      ticket.id, ticket.title,
      ticket.priority ? ticket.priority + ' priority' : '',
      ticket.type ? ticket.type + ' type' : '',
      ticket.claimed_by ? 'Claimed by ' + ticket.claimed_by : 'Unclaimed'
    ].filter(Boolean).join(', ');
    card.setAttribute('aria-label', ariaLabel);
  }

  /** Update an existing card in-place (no re-render of entire column). */
  function updateCardInDOM(ticketId) {
    var ticket = ticketsMap.get(ticketId);
    if (!ticket) return;

    var card = document.querySelector('.ticket-card[data-ticket-id="' + ticketId + '"]');
    if (!card) {
      addCardToColumn(ticketId);
      return;
    }

    /* Update data attributes for filtering */
    card.dataset.stage = ticket.stage || '';
    card.dataset.priority = ticket.priority || '';
    card.dataset.type = ticket.type || '';
    card.dataset.machine = ticket.machine_id || '';
    card.dataset.agent = ticket.claimed_by || '';

    populateCardContent(card, ticket);
    applyFilterToCard(card);
  }

  /** Add a new card to the correct column. */
  function addCardToColumn(ticketId) {
    var ticket = ticketsMap.get(ticketId);
    if (!ticket) return;

    /* Remove existing if present */
    var existing = document.querySelector('.ticket-card[data-ticket-id="' + ticketId + '"]');
    if (existing) existing.remove();

    var col = document.getElementById('col-' + ticket.stage);
    if (!col) return;

    /* Remove empty message if present */
    var emptyMsg = col.querySelector('.stage-column__empty');
    if (emptyMsg) emptyMsg.remove();

    var card = createCard(ticket);

    /* Reduced-motion check */
    var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reducedMotion) {
      card.style.opacity = '0';
      card.style.transform = 'translateY(8px)';
    }

    col.appendChild(card);

    if (!reducedMotion) {
      requestAnimationFrame(function () {
        card.style.transition = 'opacity 250ms ease-in-out, transform 250ms ease-in-out';
        card.style.opacity = '1';
        card.style.transform = 'translateY(0)';
      });
    }

    applyFilterToCard(card);
    updateColumnCount(ticket.stage);

    /* Start lease timer if applicable */
    if (ticket.lease_expiry && ticket.claimed_by) {
      startLeaseTimer(ticketId, ticket.lease_expiry);
    }
  }

  /** Move a card from one column to another. */
  function moveCardBetweenColumns(ticketId, fromStage, toStage) {
    var card = document.querySelector('.ticket-card[data-ticket-id="' + ticketId + '"]');
    var ticket = ticketsMap.get(ticketId);
    if (!ticket) return;

    if (card) card.remove();

    ticket.stage = toStage;

    var targetCol = document.getElementById('col-' + toStage);
    if (!targetCol) return;

    var emptyMsg = targetCol.querySelector('.stage-column__empty');
    if (emptyMsg) emptyMsg.remove();

    var newCard = createCard(ticket);
    targetCol.appendChild(newCard);
    applyFilterToCard(newCard);

    updateColumnCount(fromStage);
    updateColumnCount(toStage);

    /* Check if source column needs empty message */
    var sourceCol = document.getElementById('col-' + fromStage);
    if (sourceCol && sourceCol.querySelectorAll('.ticket-card').length === 0) {
      var empty = document.createElement('p');
      empty.className = 'stage-column__empty';
      empty.textContent = 'No tickets in this stage';
      sourceCol.appendChild(empty);
    }
  }

  /** Flash a card with a visual indicator (e.g. rejection). */
  function flashCard(ticketId, flashType) {
    var card = document.querySelector('.ticket-card[data-ticket-id="' + ticketId + '"]');
    if (!card) return;

    var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion) return;

    card.classList.add('ticket-card--flash-' + flashType);
    setTimeout(function () {
      card.classList.remove('ticket-card--flash-' + flashType);
    }, 500);
  }

  /* ═══════════════════════════════════════════════════════════
     LEASE COUNTDOWN TIMERS
     ═══════════════════════════════════════════════════════════ */

  function startLeaseTimersForAll() {
    leaseTimers.clear();
    ticketsMap.forEach(function (ticket, id) {
      if (ticket.lease_expiry && ticket.claimed_by) {
        leaseTimers.set(id, new Date(ticket.lease_expiry).getTime());
      }
    });
  }

  function startLeaseTimer(ticketId, expiryISO) {
    leaseTimers.set(ticketId, new Date(expiryISO).getTime());
  }

  function stopLeaseTimer(ticketId) {
    leaseTimers.delete(ticketId);
  }

  /** Global tick — update every active countdown display. */
  function tickLeaseCountdowns() {
    var now = Date.now();

    leaseTimers.forEach(function (expiry, ticketId) {
      var remaining = expiry - now;
      var seconds = Math.floor(remaining / 1000);
      var urgency = FOS.getLeaseUrgency(seconds);
      var display = remaining <= 0 ? 'EXPIRED' : formatCountdown(remaining);

      var card = document.querySelector('.ticket-card[data-ticket-id="' + ticketId + '"]');
      if (!card) return;

      var countdownEl = card.querySelector('.ticket-card__countdown');
      if (countdownEl) {
        countdownEl.textContent = display;
        countdownEl.className = 'ticket-card__countdown countdown--' + urgency;
      }

      var labelEl = card.querySelector('.ticket-card__countdown-label');
      if (labelEl) {
        labelEl.textContent = remaining <= 0 ? '' : 'remaining';
      }

      /* Update ARIA label every 15 s to avoid verbosity */
      var leaseDiv = card.querySelector('.ticket-card__lease');
      if (leaseDiv && seconds % 15 === 0) {
        leaseDiv.setAttribute('aria-label', 'Lease remaining: ' + display);
      }

      card.dataset.claimStatus = urgency === 'expired' ? 'expired' :
        (urgency === 'critical' || urgency === 'warning') ? 'expiring' : 'claimed';

      if (remaining <= 0) {
        leaseTimers.delete(ticketId);
      }
    });
  }

  /** Format remaining ms as MM:SS. */
  function formatCountdown(ms) {
    if (ms <= 0) return 'EXPIRED';
    var totalSec = Math.floor(ms / 1000);
    var m = Math.floor(totalSec / 60);
    var s = totalSec % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  /* ═══════════════════════════════════════════════════════════
     FILTERING
     ═══════════════════════════════════════════════════════════ */

  function readFiltersFromURL() {
    var params = new URLSearchParams(window.location.search);
    filters.stage = params.get('stage') || '';
    filters.type = params.get('type') || '';
    filters.priority = params.get('priority') || '';
    filters.machine = params.get('machine') || '';
    filters.agent = params.get('assignee') || '';
    filters.search = params.get('search') || '';
  }

  function syncFiltersToURL() {
    var params = new URLSearchParams();
    if (filters.stage) params.set('stage', filters.stage);
    if (filters.type) params.set('type', filters.type);
    if (filters.priority) params.set('priority', filters.priority);
    if (filters.machine) params.set('machine', filters.machine);
    if (filters.agent) params.set('assignee', filters.agent);
    if (filters.search) params.set('search', filters.search);
    var query = params.toString();
    var url = window.location.pathname + (query ? '?' + query : '');
    window.history.replaceState(null, '', url);
  }

  /** Apply show/hide to all cards based on current filters (no re-render). */
  function applyFiltersToDOM() {
    var cards = document.querySelectorAll('.ticket-card');
    cards.forEach(function (card) {
      applyFilterToCard(card);
    });
    updateAllColumnCounts();
    updateFilterBadge();
  }

  function applyFilterToCard(card) {
    var match = true;
    if (filters.stage && card.dataset.stage !== filters.stage) match = false;
    if (filters.type && card.dataset.type !== filters.type) match = false;
    if (filters.priority && card.dataset.priority !== filters.priority) match = false;
    if (filters.machine && card.dataset.machine !== filters.machine) match = false;
    if (filters.agent && card.dataset.agent !== filters.agent) match = false;
    if (filters.search) {
      var term = filters.search.toLowerCase();
      var id = (card.dataset.ticketId || '').toLowerCase();
      var titleEl = card.querySelector('.ticket-card__title');
      var titleText = titleEl ? titleEl.textContent.toLowerCase() : '';
      if (!id.includes(term) && !titleText.includes(term)) match = false;
    }
    card.style.display = match ? '' : 'none';
  }

  function updateAllColumnCounts() {
    ALL_STAGES.forEach(function (stage) {
      updateColumnCount(stage);
    });
  }

  function updateColumnCount(stage) {
    var col = document.getElementById('col-' + stage);
    if (!col) return;
    var visible = col.querySelectorAll('.ticket-card:not([style*="display: none"])').length;

    /* Stage column header count */
    var colParent = col.closest('.stage-column');
    if (colParent) {
      var badge = colParent.querySelector('.stage-column__count');
      if (badge) {
        badge.textContent = visible;
        badge.setAttribute('aria-label', visible + ' tickets');
      }
      colParent.setAttribute('aria-label', stage + ' stage, ' + visible + ' tickets');
    }

    /* Compact stage (bottom row) */
    var compact = document.querySelector('.compact-stage[data-stage="' + stage + '"]');
    if (compact) {
      var cBadge = compact.querySelector('.compact-stage__count');
      if (cBadge) cBadge.textContent = visible;
      compact.setAttribute('aria-label', stage + ' stage, ' + visible + ' tickets');
    }
  }

  function updateFilterBadge() {
    var active = [filters.stage, filters.type, filters.priority,
      filters.machine, filters.agent, filters.search].filter(Boolean).length;

    if (!filterCountBadge) {
      filterCountBadge = document.getElementById('filterCountBadge');
      if (!filterCountBadge) {
        /* Create badge if missing from HTML */
        var clearBtn = document.getElementById('clearFilters');
        if (clearBtn) {
          filterCountBadge = document.createElement('span');
          filterCountBadge.id = 'filterCountBadge';
          filterCountBadge.className = 'filter-count-badge';
          filterCountBadge.setAttribute('aria-live', 'polite');
          clearBtn.parentNode.insertBefore(filterCountBadge, clearBtn);
        }
      }
    }

    if (filterCountBadge) {
      if (active > 0) {
        filterCountBadge.textContent = active + ' filter' + (active > 1 ? 's' : '') + ' active';
        filterCountBadge.hidden = false;
      } else {
        filterCountBadge.textContent = '';
        filterCountBadge.hidden = true;
      }
    }
  }

  function onFilterChange(name, value) {
    filters[name] = value || '';
    syncFiltersToURL();
    applyFiltersToDOM();
    FOS.announce('Filters updated');
  }

  function clearAllFilters() {
    filters = { stage: '', type: '', priority: '', machine: '', agent: '', search: '' };
    syncFiltersToURL();
    applyFiltersToDOM();

    /* Reset filter controls */
    ['filter-stage', 'filter-type', 'filter-priority', 'filter-machine', 'filter-agent'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.value = '';
    });
    var search = document.getElementById('filter-search');
    if (search) search.value = '';

    FOS.announce('All filters cleared');
  }

  /* ═══════════════════════════════════════════════════════════
     EVENT DELEGATION
     ═══════════════════════════════════════════════════════════ */

  function setupEventDelegation() {
    /* Board card clicks */
    var kanban = document.getElementById('kanbanColumns');
    if (kanban) {
      kanban.addEventListener('click', function (e) {
        var card = e.target.closest('.ticket-card');
        if (card && card.dataset.ticketId) {
          FOS.openTicketDetail(card.dataset.ticketId);
        }
      });

      kanban.addEventListener('keydown', function (e) {
        var card = e.target.closest('.ticket-card');
        if (!card) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          FOS.openTicketDetail(card.dataset.ticketId);
        }
      });
    }

    /* Filter controls via delegation */
    var filterBar = document.querySelector('.filter-bar');
    if (filterBar) {
      filterBar.addEventListener('change', function (e) {
        var el = e.target;
        if (el.id === 'filter-stage') onFilterChange('stage', el.value);
        else if (el.id === 'filter-type') onFilterChange('type', el.value);
        else if (el.id === 'filter-priority') onFilterChange('priority', el.value);
        else if (el.id === 'filter-machine') onFilterChange('machine', el.value);
        else if (el.id === 'filter-agent') onFilterChange('agent', el.value);
      });

      var searchInput = filterBar.querySelector('#filter-search');
      if (searchInput) {
        searchInput.addEventListener('input', FOS.debounce(function () {
          onFilterChange('search', searchInput.value);
        }, 300));
      }

      var clearBtn = filterBar.querySelector('#clearFilters');
      if (clearBtn) {
        clearBtn.addEventListener('click', clearAllFilters);
      }
    }
  }

  /* ═══════════════════════════════════════════════════════════
     ERROR STATE
     ═══════════════════════════════════════════════════════════ */

  function showBoardError() {
    var kanban = document.getElementById('kanbanColumns');
    if (!kanban) return;

    var errorEl = document.createElement('div');
    errorEl.className = 'pipeline-error';
    errorEl.setAttribute('role', 'alert');
    errorEl.innerHTML =
      '<p>Failed to load ticket data.</p>' +
      '<button class="btn btn--ghost pipeline-error__retry" aria-label="Retry loading tickets">Retry</button>';
    errorEl.querySelector('button').addEventListener('click', function () {
      errorEl.remove();
      fetchInitialTickets();
    });
    kanban.prepend(errorEl);
    FOS.announce('Failed to load pipeline data');
  }

  /* ── Boot ── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
