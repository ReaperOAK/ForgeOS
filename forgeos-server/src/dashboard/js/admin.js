/**
 * ForgeOS Dashboard — Admin Panel Module
 * Ticket: TASK-FOS-05-004
 *
 * Responsibilities:
 *   - Force-release tickets with confirmation modal & reason
 *   - Machine status polling (Active / Stale / Offline)
 *   - System health display (DB pool gauge, uptime, expired leases)
 *   - SSE handler for health_update, agent_connected, agent_disconnected
 *   - Replaces #panel-admin placeholder with interactive admin panel
 *   - WCAG 2.2 AA accessible (ARIA landmarks, live regions, keyboard)
 */

'use strict';

(function AdminModule() {
  /* ── Wait for app.js to expose ForgeOS ── */
  function boot() {
    if (!window.ForgeOS) {
      setTimeout(boot, 50);
      return;
    }
    initAdmin();
  }

  /* ═══════════════════════════════════════════════════════════
     CONSTANTS & REFS
     ═══════════════════════════════════════════════════════════ */

  var FOS;

  /** Polling interval handle for machines & health. */
  var pollIntervalId = null;

  /** Poll period in ms. */
  var POLL_INTERVAL = 15000;

  /** Machine staleness thresholds (ms). */
  var STALE_THRESHOLD = 30110;
  var OFFLINE_THRESHOLD = 301100;

  /** DB pool gauge color thresholds (percentage). */
  var DB_GAUGE_OK = 0.7;
  var DB_GAUGE_WARN = 0.9;

  /** Cached DOM refs created during buildDOM(). */
  var els = {};

  /** Last-known machine list for diffing. */
  var machinesCache = [];

  /* ═══════════════════════════════════════════════════════════
     INITIALIZATION
     ═══════════════════════════════════════════════════════════ */

  function initAdmin() {
    FOS = window.ForgeOS;

    buildDOM();
    attachEvents();
    fetchMachines();
    fetchHealth();

    pollIntervalId = setInterval(function () {
      fetchMachines();
      fetchHealth();
    }, POLL_INTERVAL);

    FOS.registerHandler('admin', {
      handleEvent: handleSSEEvent
    });
  }

  /* ═══════════════════════════════════════════════════════════
     DOM CONSTRUCTION — replaces placeholder
     ═══════════════════════════════════════════════════════════ */

  function buildDOM() {
    var panel = document.getElementById('panel-admin');
    if (!panel) return;

    panel.innerHTML =
      '<div class="admin-grid">' +

      /* Force-Release Section */
      '<section class="admin-section admin-section--force-release" aria-labelledby="admin-force-title">' +
      '<h2 class="section-heading" id="admin-force-title">' +
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">' +
      '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>' +
      ' Force Release' +
      '</h2>' +
      '<div class="admin-force-release">' +
      '<label for="admin-force-ticket" class="admin-force-release__label">Ticket ID</label>' +
      '<div class="admin-force-release__row">' +
      '<input type="text" id="admin-force-ticket" class="input admin-force-release__input" ' +
      'placeholder="e.g. TASK-FOS-05-001" autocomplete="off" ' +
      'aria-describedby="admin-force-hint" />' +
      '<button class="btn btn--danger admin-force-release__btn" id="admin-force-btn" ' +
      'aria-label="Force release ticket claim">Release</button>' +
      '</div>' +
      '<p class="admin-force-release__hint" id="admin-force-hint">' +
      'Forcefully releases another operator\'s claim. Requires confirmation.</p>' +
      '<div class="admin-force-release__result" id="admin-force-result" ' +
      'role="status" aria-live="polite" hidden></div>' +
      '</div>' +
      '</section>' +

      /* Machine Status Section */
      '<section class="admin-section admin-section--machines" aria-labelledby="admin-machines-title">' +
      '<h2 class="section-heading" id="admin-machines-title">' +
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">' +
      '<rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>' +
      ' Machine Status' +
      '</h2>' +
      '<div class="admin-machines" id="admin-machines-grid" role="list" ' +
      'aria-label="Connected machines"></div>' +
      '<p class="admin-machines__empty" id="admin-machines-empty" role="status">' +
      'No machines reporting.</p>' +
      '</section>' +

      /* System Health Section */
      '<section class="admin-section admin-section--health" aria-labelledby="admin-health-title">' +
      '<h2 class="section-heading" id="admin-health-title">' +
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">' +
      '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>' +
      ' System Health' +
      '</h2>' +
      '<div class="admin-health">' +
      '<div class="admin-health__card" aria-label="Database pool usage">' +
      '<span class="admin-health__label">DB Pool</span>' +
      '<div class="admin-health__gauge" id="admin-db-gauge" role="meter" ' +
      'aria-valuenow="0" aria-valuemin="0" aria-valuemax="20" ' +
      'aria-label="Database connections: 0 of 20 active">' +
      '<div class="admin-health__gauge-track">' +
      '<div class="admin-health__gauge-fill" id="admin-db-gauge-fill"></div>' +
      '</div>' +
      '<span class="admin-health__gauge-text" id="admin-db-gauge-text">0 / 20</span>' +
      '</div>' +
      '</div>' +
      '<div class="admin-health__card" aria-label="Server uptime">' +
      '<span class="admin-health__label">Uptime</span>' +
      '<span class="admin-health__value" id="admin-uptime">--</span>' +
      '</div>' +
      '<div class="admin-health__card" aria-label="Expired lease count">' +
      '<span class="admin-health__label">Expired Leases</span>' +
      '<span class="admin-health__value admin-health__value--count" ' +
      'id="admin-expired-count">0</span>' +
      '</div>' +
      '</div>' +
      '</section>' +

      '</div>';

    /* Cache element refs */
    els.forceInput = document.getElementById('admin-force-ticket');
    els.forceBtn = document.getElementById('admin-force-btn');
    els.forceResult = document.getElementById('admin-force-result');
    els.machinesGrid = document.getElementById('admin-machines-grid');
    els.machinesEmpty = document.getElementById('admin-machines-empty');
    els.dbGauge = document.getElementById('admin-db-gauge');
    els.dbGaugeFill = document.getElementById('admin-db-gauge-fill');
    els.dbGaugeText = document.getElementById('admin-db-gauge-text');
    els.uptime = document.getElementById('admin-uptime');
    els.expiredCount = document.getElementById('admin-expired-count');
  }

  /* ═══════════════════════════════════════════════════════════
     EVENT BINDING
     ═══════════════════════════════════════════════════════════ */

  function attachEvents() {
    if (els.forceBtn) {
      els.forceBtn.addEventListener('click', onForceReleaseClick);
    }
    if (els.forceInput) {
      els.forceInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          onForceReleaseClick();
        }
      });
    }
  }

  /* ═══════════════════════════════════════════════════════════
     FORCE RELEASE
     ═══════════════════════════════════════════════════════════ */

  function onForceReleaseClick() {
    var ticketId = (els.forceInput ? els.forceInput.value.trim() : '');
    if (!ticketId) {
      showForceResult('error', 'Please enter a ticket ID.');
      if (els.forceInput) els.forceInput.focus();
      return;
    }

    FOS.openConfirmationModal(
      'Force Release: ' + ticketId,
      'WARNING: This will forcefully release the claim on this ticket. ' +
      'The current operator will lose their work lock. Use only when absolutely necessary.',
      function (reason) {
        executeForceRelease(ticketId, reason);
      }
    );
  }

  function executeForceRelease(ticketId, reason) {
    showForceResult('info', 'Releasing claim on ' + FOS.escapeHtml(ticketId) + '…');
    if (els.forceBtn) els.forceBtn.disabled = true;

    FOS.fetchJSON('/api/tickets/' + encodeURIComponent(ticketId) + '/release?force=true', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: reason })
    })
      .then(function (result) {
        showForceResult('success', 'Claim on ' + FOS.escapeHtml(ticketId) + ' has been released.');
        if (els.forceInput) els.forceInput.value = '';
        FOS.announce('Force release successful for ' + ticketId);
      })
      .catch(function (err) {
        var status = err.status || 0;
        var msg;
        if (status === 403) {
          msg = 'Access denied. You do not have permission to force-release tickets.';
        } else if (status === 404) {
          msg = 'Ticket ' + FOS.escapeHtml(ticketId) + ' not found or has no active claim.';
        } else if (status === 409) {
          msg = 'Conflict: the claim has already changed. Please refresh and try again.';
        } else {
          msg = 'Error releasing ticket: ' + FOS.escapeHtml(err.message || 'Unknown error');
        }
        showForceResult('error', msg);
        FOS.announce('Force release failed: ' + msg);
      })
      .finally(function () {
        if (els.forceBtn) els.forceBtn.disabled = false;
      });
  }

  function showForceResult(type, message) {
    if (!els.forceResult) return;
    els.forceResult.hidden = false;
    els.forceResult.className = 'admin-force-release__result admin-force-release__result--' + type;
    els.forceResult.innerHTML = FOS.escapeHtml(message);
  }

  /* ═══════════════════════════════════════════════════════════
     MACHINE STATUS
     ═══════════════════════════════════════════════════════════ */

  function fetchMachines() {
    FOS.fetchJSON('/api/admin/machines')
      .then(function (result) {
        var data = result.data || result;
        if (!Array.isArray(data)) data = [];
        machinesCache = data;
        renderMachines(data);
      })
      .catch(function () {
        /* silently keep previous cache on failure */
      });
  }

  function renderMachines(machines) {
    if (!els.machinesGrid) return;

    if (machines.length === 0) {
      els.machinesGrid.innerHTML = '';
      if (els.machinesEmpty) els.machinesEmpty.hidden = false;
      return;
    }
    if (els.machinesEmpty) els.machinesEmpty.hidden = true;

    var now = Date.now();
    els.machinesGrid.innerHTML = machines.map(function (m) {
      var lastSeen = m.last_seen ? new Date(m.last_seen).getTime() : 0;
      var age = now - lastSeen;
      var statusClass, statusLabel;

      if (age < STALE_THRESHOLD) {
        statusClass = 'active';
        statusLabel = 'Active';
      } else if (age < OFFLINE_THRESHOLD) {
        statusClass = 'stale';
        statusLabel = 'Stale';
      } else {
        statusClass = 'offline';
        statusLabel = 'Offline';
      }

      var machineColor = FOS.getMachineColor(m.machine_id || m.id || '');
      var relTime = lastSeen ? FOS.formatRelativeTime(m.last_seen) : 'never';

      return '<div class="admin-machine-card admin-machine-card--' + statusClass + '" ' +
        'role="listitem" aria-label="' + FOS.escapeHtml(m.machine_id || m.id || 'Unknown') +
        ': ' + statusLabel + '">' +
        '<div class="admin-machine-card__header">' +
        '<span class="admin-machine-card__dot admin-machine-card__dot--' + statusClass + '" ' +
        'aria-hidden="true"></span>' +
        '<span class="admin-machine-card__name" style="color:' + machineColor + '">' +
        FOS.escapeHtml(m.machine_id || m.id || 'Unknown') + '</span>' +
        '<span class="admin-machine-card__status badge badge--' + statusClass + '">' +
        statusLabel + '</span>' +
        '</div>' +
        '<div class="admin-machine-card__meta">' +
        '<span class="admin-machine-card__detail">Agent: ' +
        FOS.escapeHtml(m.agent || m.claimed_by || '—') + '</span>' +
        '<span class="admin-machine-card__detail">Operator: ' +
        FOS.escapeHtml(m.operator || '—') + '</span>' +
        '<span class="admin-machine-card__detail">Last seen: ' +
        FOS.escapeHtml(relTime) + '</span>' +
        (m.active_tickets != null ?
          '<span class="admin-machine-card__detail">Tickets: ' + m.active_tickets + '</span>' : '') +
        '</div>' +
        '</div>';
    }).join('');
  }

  /* ═══════════════════════════════════════════════════════════
     SYSTEM HEALTH
     ═══════════════════════════════════════════════════════════ */

  function fetchHealth() {
    /* Parallel fetch for /health and /api/stages */
    Promise.all([
      FOS.fetchJSON('/health').catch(function () { return null; }),
      FOS.fetchJSON('/api/stages').catch(function () { return null; })
    ]).then(function (results) {
      var health = results[0];
      var stages = results[1];

      if (health) updateHealthDisplay(health);
      if (stages) updateExpiredCount(stages);
    });
  }

  function updateHealthDisplay(data) {
    /* DB pool gauge */
    var pool = data.database || data.dbPool || {};
    var active = pool.activeConnections || pool.active || 0;
    var total = pool.totalConnections || pool.total || pool.max || 20;
    var pct = total > 0 ? active / total : 0;

    if (els.dbGauge) {
      els.dbGauge.setAttribute('aria-valuenow', active);
      els.dbGauge.setAttribute('aria-valuemax', total);
      els.dbGauge.setAttribute('aria-label',
        'Database connections: ' + active + ' of ' + total + ' active');
    }
    if (els.dbGaugeFill) {
      els.dbGaugeFill.style.width = Math.min(pct * 100, 100) + '%';

      /* Color by utilization */
      var gaugeColor;
      if (pct <= DB_GAUGE_OK) {
        gaugeColor = 'var(--color-success, #16A34A)';
      } else if (pct <= DB_GAUGE_WARN) {
        gaugeColor = 'var(--color-warning, #EAB308)';
      } else {
        gaugeColor = 'var(--color-error, #EF4444)';
      }
      els.dbGaugeFill.style.backgroundColor = gaugeColor;
    }
    if (els.dbGaugeText) {
      els.dbGaugeText.textContent = active + ' / ' + total;
    }

    /* Uptime */
    var uptimeMs = data.uptime || data.uptimeMs || 0;
    if (typeof uptimeMs === 'number' && uptimeMs > 0) {
      if (els.uptime) els.uptime.textContent = FOS.formatDuration(uptimeMs);
    }
  }

  function updateExpiredCount(stagesData) {
    /* stagesData may be { stages: [...] } or [...] */
    var stages = Array.isArray(stagesData) ? stagesData : (stagesData.stages || stagesData.data || []);
    var expired = 0;

    if (Array.isArray(stages)) {
      stages.forEach(function (s) {
        expired += s.expired_leases || s.expiredLeases || 0;
      });
    } else if (typeof stagesData === 'object' && stagesData.expired_leases != null) {
      expired = stagesData.expired_leases;
    }

    if (els.expiredCount) {
      els.expiredCount.textContent = expired;
      /* Warn if there are expired leases */
      if (expired > 0) {
        els.expiredCount.classList.add('admin-health__value--warn');
      } else {
        els.expiredCount.classList.remove('admin-health__value--warn');
      }
    }
  }

  /* ═══════════════════════════════════════════════════════════
     SSE EVENT HANDLER
     ═══════════════════════════════════════════════════════════ */

  function handleSSEEvent(eventType, data) {
    switch (eventType) {
      case 'health_update':
        if (data) updateHealthDisplay(data);
        break;

      case 'agent_connected': {
        /* Add or update machine in cache */
        var found = false;
        var machineId = data.machine_id || data.machineId;
        for (var i = 0; i < machinesCache.length; i++) {
          if ((machinesCache[i].machine_id || machinesCache[i].id) === machineId) {
            machinesCache[i].last_seen = data.timestamp || new Date().toISOString();
            machinesCache[i].agent = data.agent || machinesCache[i].agent;
            machinesCache[i].operator = data.operator || machinesCache[i].operator;
            found = true;
            break;
          }
        }
        if (!found && machineId) {
          machinesCache.push({
            machine_id: machineId,
            agent: data.agent || '',
            operator: data.operator || '',
            last_seen: data.timestamp || new Date().toISOString(),
            active_tickets: data.active_tickets || 0
          });
        }
        renderMachines(machinesCache);
        FOS.announce('Agent connected: ' + (data.agent || '') + ' on ' + (machineId || ''));
        break;
      }

      case 'agent_disconnected': {
        var disconnectId = data.machine_id || data.machineId;
        for (var j = 0; j < machinesCache.length; j++) {
          if ((machinesCache[j].machine_id || machinesCache[j].id) === disconnectId) {
            /* Mark stale/offline by setting last_seen far in past */
            machinesCache[j].last_seen = new Date(Date.now() - OFFLINE_THRESHOLD - 1).toISOString();
            break;
          }
        }
        renderMachines(machinesCache);
        FOS.announce('Agent disconnected: ' + (data.agent || '') + ' on ' + (disconnectId || ''));
        break;
      }
    }
  }

  /* ── Boot ── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
