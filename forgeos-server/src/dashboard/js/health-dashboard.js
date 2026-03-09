/**
 * Health Dashboard Module — FORGEOS-UID005
 *
 * Renders the System Health Dashboard with 4 panels:
 *  - Database Health (connection pool gauge, P50/P99 latency, slow queries)
 *  - MCP Server Health (uptime, connected agents, requests/min sparkline)
 *  - Webhook Delivery (success rate donut, pending/failed counts, retry)
 *  - System Alerts (severity-coded alert list with dismiss)
 *
 * WCAG 2.2 AA compliant. Design-token-driven. No hardcoded styles.
 */

/* global document, window, fetch, EventSource */

(function healthDashboard() {
  'use strict';

  // ── Configuration ──────────────────────────────────────────
  var POLL_INTERVAL_MS = 15000;
  var SPARKLINE_MAX_POINTS = 60;
  var ALERT_AUTO_EXPIRE_MS = 86400000; // 24h

  // ── State ──────────────────────────────────────────────────
  var state = {
    db: {
      used: 0, max: 20, idle: 0, waiting: 0,
      p50: 0, p99: 0,
      p50History: [], p99History: [],
      slowQueries: [],
      status: 'unknown'
    },
    mcp: {
      uptime: 0,
      connectedAgents: 0,
      reqPerMin: 0,
      reqHistory: [],
      status: 'unknown'
    },
    webhook: {
      successRate: 0,
      total: 0,
      pending: 0,
      failed: 0,
      status: 'unknown'
    },
    alerts: [],
    alertIdCounter: 0
  };

  // ── DOM References ─────────────────────────────────────────
  var els = {};

  function cacheDom() {
    els.dbGauge = document.getElementById('dbGauge');
    els.dbGaugeFill = document.getElementById('dbGaugeFill');
    els.dbGaugeValue = document.getElementById('dbGaugeValue');
    els.dbStatusDot = document.getElementById('dbStatusDot');
    els.dbStatusLabel = document.getElementById('dbStatusLabel');
    els.metricP50 = document.getElementById('metricP50');
    els.metricP50Value = document.getElementById('metricP50Value');
    els.metricP50Change = document.getElementById('metricP50Change');
    els.metricP99 = document.getElementById('metricP99');
    els.metricP99Value = document.getElementById('metricP99Value');
    els.metricP99Change = document.getElementById('metricP99Change');
    els.sparklineP50 = document.getElementById('sparklineP50');
    els.sparklineP99 = document.getElementById('sparklineP99');
    els.slowQueriesBody = document.getElementById('slowQueriesBody');
    els.slowQueryCount = document.getElementById('slowQueryCount');
    els.slowQueriesDetails = document.getElementById('slowQueriesDetails');

    els.mcpStatusDot = document.getElementById('mcpStatusDot');
    els.mcpStatusLabel = document.getElementById('mcpStatusLabel');
    els.mcpUptimeValue = document.getElementById('mcpUptimeValue');
    els.metricAgentsValue = document.getElementById('metricAgentsValue');
    els.metricReqMinValue = document.getElementById('metricReqMinValue');
    els.metricReqMinChange = document.getElementById('metricReqMinChange');
    els.sparklineReqMin = document.getElementById('sparklineReqMin');

    els.webhookStatusDot = document.getElementById('webhookStatusDot');
    els.webhookStatusLabel = document.getElementById('webhookStatusLabel');
    els.webhookDonut = document.getElementById('webhookDonut');
    els.webhookDonutFill = document.getElementById('webhookDonutFill');
    els.webhookDonutValue = document.getElementById('webhookDonutValue');
    els.metricPendingValue = document.getElementById('metricPendingValue');
    els.metricFailedValue = document.getElementById('metricFailedValue');
    els.retryFailedBtn = document.getElementById('retryFailedBtn');

    els.alertList = document.getElementById('alertList');
    els.alertEmpty = document.getElementById('alertEmpty');
    els.alertCountBadge = document.getElementById('alertCountBadge');
    els.alertBannerBadge = document.getElementById('alertBannerBadge');

    els.healthPanelGrid = document.getElementById('healthPanelGrid');
  }

  // ── Utility Functions ──────────────────────────────────────

  function formatUptime(totalSeconds) {
    if (totalSeconds <= 0) { return '—'; }
    var days = Math.floor(totalSeconds / 86400);
    var hours = Math.floor((totalSeconds % 86400) / 3600);
    var minutes = Math.floor((totalSeconds % 3600) / 60);
    var parts = [];
    if (days > 0) { parts.push(days + 'd'); }
    if (hours > 0 || days > 0) { parts.push(hours + 'h'); }
    parts.push(minutes + 'm');
    return parts.join(' ');
  }

  function relativeTime(isoString) {
    var diff = Date.now() - new Date(isoString).getTime();
    if (diff < 60000) { return '<1m ago'; }
    if (diff < 3600000) { return Math.floor(diff / 60000) + 'm ago'; }
    if (diff < 86400000) { return Math.floor(diff / 3600000) + 'h ago'; }
    return Math.floor(diff / 86400000) + 'd ago';
  }

  function computeDbStatus(used, max) {
    var pct = (max > 0) ? (used / max) * 100 : 0;
    if (pct > 90) { return 'critical'; }
    if (pct > 70) { return 'degraded'; }
    return 'healthy';
  }

  function computeWebhookStatus(rate) {
    if (rate >= 99) { return 'healthy'; }
    if (rate >= 95) { return 'degraded'; }
    return 'critical';
  }

  function setStatusIndicator(dotEl, labelEl, status) {
    var classMap = {
      healthy: 'status-indicator--healthy',
      degraded: 'status-indicator--degraded',
      critical: 'status-indicator--critical',
      unknown: 'status-indicator--unknown',
      disabled: 'status-indicator--disabled'
    };
    var labelMap = {
      healthy: 'Healthy',
      degraded: 'Degraded',
      critical: 'Critical',
      unknown: 'Unknown',
      disabled: 'Disabled'
    };
    var tooltipMap = {
      healthy: 'All systems operational',
      degraded: 'Performance below threshold',
      critical: 'Immediate attention required',
      unknown: 'Status unavailable',
      disabled: 'Monitoring disabled'
    };

    // Remove all status classes
    Object.keys(classMap).forEach(function(key) {
      dotEl.classList.remove(classMap[key]);
    });
    dotEl.classList.add(classMap[status] || classMap.unknown);

    if (labelEl) {
      labelEl.textContent = labelMap[status] || 'Unknown';
    }

    var panelName = dotEl.id.replace('StatusDot', '');
    dotEl.setAttribute('aria-label', panelName + ' status: ' + (labelMap[status] || 'unknown'));
    dotEl.setAttribute('data-tooltip', tooltipMap[status] || tooltipMap.unknown);
  }

  // ── Gauge Rendering ────────────────────────────────────────

  var GAUGE_ARC_LENGTH = 251.33; // computed for r=80, 180° arc

  function renderGauge(used, max) {
    var pct = (max > 0) ? Math.min(used / max, 1) : 0;
    var offset = GAUGE_ARC_LENGTH * (1 - pct);

    els.dbGaugeFill.setAttribute('stroke-dashoffset', offset.toFixed(2));

    // Color by threshold
    els.dbGaugeFill.classList.remove('gauge-fill--warning', 'gauge-fill--critical');
    if (pct > 0.9) {
      els.dbGaugeFill.classList.add('gauge-fill--critical');
    } else if (pct > 0.7) {
      els.dbGaugeFill.classList.add('gauge-fill--warning');
    }

    els.dbGaugeValue.textContent = used + ' / ' + max;
    els.dbGauge.setAttribute('aria-valuenow', used);
    els.dbGauge.setAttribute('aria-valuemax', max);
    els.dbGauge.setAttribute('aria-label', 'Connection pool: ' + used + ' of ' + max + ' active');
  }

  // ── Donut Rendering ────────────────────────────────────────

  var DONUT_ARC_LENGTH = 259.18; // computed for r=55, 270° arc

  function renderDonut(rate) {
    var pct = Math.min(Math.max(rate, 0), 100) / 100;
    var fillLength = DONUT_ARC_LENGTH * pct;
    var offset = DONUT_ARC_LENGTH - fillLength;

    els.webhookDonutFill.setAttribute('stroke-dashoffset', offset.toFixed(2));

    els.webhookDonutFill.classList.remove('donut-fill--warning', 'donut-fill--critical');
    if (rate < 95) {
      els.webhookDonutFill.classList.add('donut-fill--critical');
    } else if (rate < 99) {
      els.webhookDonutFill.classList.add('donut-fill--warning');
    }

    els.webhookDonutValue.textContent = rate.toFixed(1) + '%';
    els.webhookDonut.setAttribute('aria-valuenow', rate.toFixed(1));
    els.webhookDonut.setAttribute('aria-label', 'Webhook success rate: ' + rate.toFixed(1) + '% over last 24h');
  }

  // ── Sparkline Rendering ────────────────────────────────────

  function renderSparkline(svgEl, data, variant) {
    if (!svgEl || !data || data.length < 2) { return; }

    // Clear existing
    while (svgEl.firstChild) { svgEl.removeChild(svgEl.firstChild); }

    var viewW = 120;
    var viewH = 40;
    var padding = 2;
    var w = viewW - padding * 2;
    var h = viewH - padding * 2;

    var min = Math.min.apply(null, data);
    var max = Math.max.apply(null, data);
    var range = max - min || 1;

    var points = data.map(function(val, i) {
      var x = padding + (i / (data.length - 1)) * w;
      var y = padding + h - ((val - min) / range) * h;
      return { x: x, y: y };
    });

    // Build path
    var lineD = 'M ' + points.map(function(p) { return p.x.toFixed(1) + ' ' + p.y.toFixed(1); }).join(' L ');

    // Area path
    var areaD = lineD + ' L ' + points[points.length - 1].x.toFixed(1) + ' ' + (viewH - padding) + ' L ' + points[0].x.toFixed(1) + ' ' + (viewH - padding) + ' Z';

    var variantClass = variant ? '--' + variant : '';

    var area = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    area.setAttribute('d', areaD);
    area.setAttribute('class', 'sparkline-area' + (variantClass ? ' sparkline-area' + variantClass : ''));
    svgEl.appendChild(area);

    var line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    line.setAttribute('d', lineD);
    line.setAttribute('class', 'sparkline-line' + (variantClass ? ' sparkline-line' + variantClass : ''));
    svgEl.appendChild(line);

    // Last point dot
    var lastPt = points[points.length - 1];
    var dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('cx', lastPt.x.toFixed(1));
    dot.setAttribute('cy', lastPt.y.toFixed(1));
    dot.setAttribute('r', '2');
    dot.setAttribute('class', 'sparkline-dot' + (variantClass ? ' sparkline-dot' + variantClass : ''));
    svgEl.appendChild(dot);
  }

  // ── Change Indicator ───────────────────────────────────────

  function renderChange(changeEl, current, previous, unit, semantics) {
    if (!changeEl) { return; }
    var diff = current - previous;
    var arrow = '→';
    var dirClass = 'flat';

    if (diff > 0.01) {
      arrow = '↑';
      dirClass = 'up';
    } else if (diff < -0.01) {
      arrow = '↓';
      dirClass = 'down';
    }

    var sem = semantics || 'neutral';
    changeEl.className = 'health-metric-card__change health-metric-card__change--' + dirClass + '-' + sem;

    var arrowSpan = changeEl.querySelector('.change-arrow');
    var valueSpan = changeEl.querySelector('.change-value');

    if (arrowSpan) { arrowSpan.textContent = arrow; }
    if (valueSpan) { valueSpan.textContent = Math.abs(diff).toFixed(1) + (unit || ''); }

    changeEl.setAttribute('aria-label', 'Change: ' + dirClass + ' ' + Math.abs(diff).toFixed(1) + (unit || ''));
  }

  // ── Alert Management ───────────────────────────────────────

  function addAlert(severity, message) {
    state.alertIdCounter++;
    var alert = {
      id: 'alert-' + state.alertIdCounter,
      severity: severity,
      message: message.length > 120 ? message.substring(0, 117) + '...' : message,
      timestamp: new Date().toISOString()
    };
    state.alerts.unshift(alert);
    renderAlerts();
    announceToScreenReader('New ' + severity + ' alert: ' + alert.message);
  }

  function dismissAlert(alertId) {
    state.alerts = state.alerts.filter(function(a) { return a.id !== alertId; });
    renderAlerts();
  }

  function renderAlerts() {
    // Remove expired alerts
    var now = Date.now();
    state.alerts = state.alerts.filter(function(a) {
      return (now - new Date(a.timestamp).getTime()) < ALERT_AUTO_EXPIRE_MS;
    });

    var list = els.alertList;
    if (!list) { return; }

    // Clear
    while (list.firstChild) { list.removeChild(list.firstChild); }

    var count = state.alerts.length;

    // Update badges
    if (els.alertCountBadge) {
      els.alertCountBadge.textContent = count;
      els.alertCountBadge.setAttribute('aria-label', count + ' active alerts');
    }
    if (els.alertBannerBadge) {
      els.alertBannerBadge.textContent = count;
      if (count > 0) {
        els.alertBannerBadge.removeAttribute('hidden');
      } else {
        els.alertBannerBadge.setAttribute('hidden', '');
      }
    }

    // Show/hide empty state
    if (els.alertEmpty) {
      if (count === 0) {
        els.alertEmpty.removeAttribute('hidden');
      } else {
        els.alertEmpty.setAttribute('hidden', '');
      }
    }

    // Render each alert
    state.alerts.forEach(function(alert) {
      var li = document.createElement('li');
      li.className = 'alert-item';
      li.setAttribute('role', 'alert');
      li.setAttribute('data-alert-id', alert.id);

      var dot = document.createElement('span');
      dot.className = 'alert-item__dot alert-item__dot--' + alert.severity;
      dot.setAttribute('aria-hidden', 'true');

      var msg = document.createElement('span');
      msg.className = 'alert-item__message';
      msg.textContent = alert.message;

      var time = document.createElement('span');
      time.className = 'alert-item__time';
      time.textContent = relativeTime(alert.timestamp);

      var dismissBtn = document.createElement('button');
      dismissBtn.className = 'alert-item__dismiss';
      dismissBtn.setAttribute('aria-label', 'Dismiss alert: ' + alert.message);
      dismissBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>';
      dismissBtn.addEventListener('click', function() {
        dismissAlert(alert.id);
      });

      li.appendChild(dot);
      li.appendChild(msg);
      li.appendChild(time);
      li.appendChild(dismissBtn);
      list.appendChild(li);
    });
  }

  // ── Slow Queries Rendering ─────────────────────────────────

  function renderSlowQueries(queries) {
    var tbody = els.slowQueriesBody;
    if (!tbody) { return; }

    while (tbody.firstChild) { tbody.removeChild(tbody.firstChild); }

    if (els.slowQueryCount) {
      els.slowQueryCount.textContent = queries.length;
    }

    if (queries.length === 0) {
      var emptyTr = document.createElement('tr');
      emptyTr.className = 'slow-queries__empty-row';
      var emptyTd = document.createElement('td');
      emptyTd.setAttribute('colspan', '3');
      emptyTd.textContent = 'No slow queries detected';
      emptyTr.appendChild(emptyTd);
      tbody.appendChild(emptyTr);
      return;
    }

    queries.slice(0, 3).forEach(function(q) {
      var tr = document.createElement('tr');

      var queryTd = document.createElement('td');
      queryTd.textContent = q.query || '—';
      queryTd.title = q.query || '';

      var durTd = document.createElement('td');
      durTd.textContent = (q.duration || 0) + 'ms';
      if (q.duration > 500) {
        durTd.className = 'slow-queries__dur--critical';
      } else if (q.duration > 100) {
        durTd.className = 'slow-queries__dur--warning';
      }

      var timeTd = document.createElement('td');
      timeTd.textContent = q.timestamp ? relativeTime(q.timestamp) : '—';

      tr.appendChild(queryTd);
      tr.appendChild(durTd);
      tr.appendChild(timeTd);
      tbody.appendChild(tr);
    });
  }

  // ── Screen Reader Announcer ────────────────────────────────

  function announceToScreenReader(message) {
    var announcer = document.getElementById('liveAnnouncer');
    if (announcer) {
      announcer.textContent = message;
      setTimeout(function() { announcer.textContent = ''; }, 3000);
    }
  }

  // ── Full Dashboard Render ──────────────────────────────────

  function renderDashboard() {
    // Database panel
    var dbStatus = computeDbStatus(state.db.used, state.db.max);
    state.db.status = dbStatus;
    setStatusIndicator(els.dbStatusDot, els.dbStatusLabel, dbStatus);
    renderGauge(state.db.used, state.db.max);

    els.metricP50Value.textContent = state.db.p50.toFixed(1);
    els.metricP99Value.textContent = state.db.p99.toFixed(1);
    els.metricP50.setAttribute('aria-label', 'P50 Latency: ' + state.db.p50.toFixed(1) + ' ms');
    els.metricP99.setAttribute('aria-label', 'P99 Latency: ' + state.db.p99.toFixed(1) + ' ms');

    if (state.db.p50History.length > 1) {
      var prev50 = state.db.p50History[state.db.p50History.length - 2];
      renderChange(els.metricP50Change, state.db.p50, prev50, 'ms', 'negative');
    }
    if (state.db.p99History.length > 1) {
      var prev99 = state.db.p99History[state.db.p99History.length - 2];
      renderChange(els.metricP99Change, state.db.p99, prev99, 'ms', 'negative');
    }

    renderSparkline(els.sparklineP50, state.db.p50History);
    renderSparkline(els.sparklineP99, state.db.p99History);
    renderSlowQueries(state.db.slowQueries);

    // Latency severity classes
    updateMetricSeverity(els.metricP50, state.db.p50, 50, 200);
    updateMetricSeverity(els.metricP99, state.db.p99, 100, 500);

    // MCP Server panel
    setStatusIndicator(els.mcpStatusDot, els.mcpStatusLabel, state.mcp.status);
    els.mcpUptimeValue.textContent = formatUptime(state.mcp.uptime);
    els.metricAgentsValue.textContent = state.mcp.connectedAgents;
    els.metricReqMinValue.textContent = state.mcp.reqPerMin;

    if (state.mcp.reqHistory.length > 1) {
      var prevReq = state.mcp.reqHistory[state.mcp.reqHistory.length - 2];
      renderChange(els.metricReqMinChange, state.mcp.reqPerMin, prevReq, ' /min', 'positive');
    }

    renderSparkline(els.sparklineReqMin, state.mcp.reqHistory);

    // Webhook panel
    var whStatus = computeWebhookStatus(state.webhook.successRate);
    state.webhook.status = whStatus;
    setStatusIndicator(els.webhookStatusDot, els.webhookStatusLabel, whStatus);
    renderDonut(state.webhook.successRate);
    els.metricPendingValue.textContent = state.webhook.pending;
    els.metricFailedValue.textContent = state.webhook.failed;

    // Enable/disable retry button
    if (els.retryFailedBtn) {
      els.retryFailedBtn.disabled = state.webhook.failed === 0;
    }

    // Alerts
    renderAlerts();

    // Update mobile banner status dots
    updateBannerDots();
  }

  function updateMetricSeverity(cardEl, value, warnThreshold, critThreshold) {
    if (!cardEl) { return; }
    cardEl.classList.remove('health-metric-card--warning', 'health-metric-card--critical');
    if (value > critThreshold) {
      cardEl.classList.add('health-metric-card--critical');
    } else if (value > warnThreshold) {
      cardEl.classList.add('health-metric-card--warning');
    }
  }

  function updateBannerDots() {
    var bannerItems = document.querySelectorAll('.health-status-banner__item');
    var statuses = [state.db.status, state.mcp.status, state.webhook.status, 'unknown'];

    // Compute alerts status
    var hasCritical = state.alerts.some(function(a) { return a.severity === 'critical'; });
    var hasWarning = state.alerts.some(function(a) { return a.severity === 'warning'; });
    if (hasCritical) {
      statuses[3] = 'critical';
    } else if (hasWarning) {
      statuses[3] = 'degraded';
    } else if (state.alerts.length === 0) {
      statuses[3] = 'healthy';
    }

    bannerItems.forEach(function(item, i) {
      var dot = item.querySelector('.status-indicator');
      if (dot) {
        Object.keys({ healthy: 1, degraded: 1, critical: 1, unknown: 1, disabled: 1 }).forEach(function(s) {
          dot.classList.remove('status-indicator--' + s);
        });
        dot.classList.add('status-indicator--' + (statuses[i] || 'unknown'));
      }
    });
  }

  // ── Data Fetching ──────────────────────────────────────────

  function fetchHealthData() {
    fetch('/api/health')
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (data.database) {
          state.db.used = data.database.pool_used || data.database.pool_total || 0;
          state.db.max = data.database.pool_max || 20;
          state.db.idle = data.database.pool_idle || 0;
          state.db.waiting = data.database.pool_waiting || 0;
          state.db.p50 = data.database.latency_p50 || 0;
          state.db.p99 = data.database.latency_p99 || 0;

          pushHistory(state.db.p50History, state.db.p50);
          pushHistory(state.db.p99History, state.db.p99);

          if (data.database.slow_queries) {
            state.db.slowQueries = data.database.slow_queries;
          }
        }

        if (data.mcp) {
          state.mcp.uptime = data.mcp.uptime_seconds || 0;
          state.mcp.connectedAgents = data.mcp.connected_agents || 0;
          state.mcp.reqPerMin = data.mcp.requests_per_minute || 0;
          state.mcp.status = data.mcp.status || 'healthy';

          pushHistory(state.mcp.reqHistory, state.mcp.reqPerMin);
        }

        if (data.webhooks) {
          state.webhook.successRate = data.webhooks.success_rate || 0;
          state.webhook.total = data.webhooks.total || 0;
          state.webhook.pending = data.webhooks.pending || 0;
          state.webhook.failed = data.webhooks.failed || 0;
        }

        if (data.alerts && Array.isArray(data.alerts)) {
          data.alerts.forEach(function(a) {
            var exists = state.alerts.some(function(existing) {
              return existing.message === a.message;
            });
            if (!exists) {
              addAlert(a.severity || 'info', a.message || 'Unknown alert');
            }
          });
        }

        renderDashboard();
      })
      .catch(function() {
        // On fetch failure, mark all as unknown
        state.db.status = 'unknown';
        state.mcp.status = 'unknown';
        state.webhook.status = 'unknown';
        renderDashboard();
      });
  }

  function pushHistory(arr, value) {
    arr.push(value);
    if (arr.length > SPARKLINE_MAX_POINTS) {
      arr.shift();
    }
  }

  // ── SSE Integration ────────────────────────────────────────

  function connectSSE() {
    if (typeof EventSource === 'undefined') { return; }

    var source;
    try {
      source = new EventSource('/api/events');
    } catch (e) {
      return;
    }

    source.addEventListener('health_update', function(e) {
      try {
        var data = JSON.parse(e.data);
        if (data.database) {
          state.db.used = data.database.pool_used || state.db.used;
          state.db.max = data.database.pool_max || state.db.max;
          state.db.p50 = data.database.latency_p50 || state.db.p50;
          state.db.p99 = data.database.latency_p99 || state.db.p99;
          pushHistory(state.db.p50History, state.db.p50);
          pushHistory(state.db.p99History, state.db.p99);
          if (data.database.slow_queries) {
            state.db.slowQueries = data.database.slow_queries;
          }
        }
        if (data.mcp) {
          state.mcp.uptime = data.mcp.uptime_seconds || state.mcp.uptime;
          state.mcp.connectedAgents = data.mcp.connected_agents || state.mcp.connectedAgents;
          state.mcp.reqPerMin = data.mcp.requests_per_minute || state.mcp.reqPerMin;
          state.mcp.status = data.mcp.status || state.mcp.status;
          pushHistory(state.mcp.reqHistory, state.mcp.reqPerMin);
        }
        if (data.webhooks) {
          state.webhook.successRate = data.webhooks.success_rate || state.webhook.successRate;
          state.webhook.pending = data.webhooks.pending || state.webhook.pending;
          state.webhook.failed = data.webhooks.failed || state.webhook.failed;
        }
        renderDashboard();
      } catch (err) {
        /* ignore parse errors */
      }
    });

    source.addEventListener('alert', function(e) {
      try {
        var data = JSON.parse(e.data);
        addAlert(data.severity || 'info', data.message || 'System alert');
      } catch (err) {
        /* ignore */
      }
    });

    source.addEventListener('agent_connected', function() {
      state.mcp.connectedAgents++;
      renderDashboard();
    });

    source.addEventListener('agent_disconnected', function() {
      state.mcp.connectedAgents = Math.max(0, state.mcp.connectedAgents - 1);
      renderDashboard();
    });

    source.onerror = function() {
      // Will auto-reconnect via EventSource spec
    };
  }

  // ── Panel Collapse (Mobile) ────────────────────────────────

  function initCollapseHandlers() {
    var headers = document.querySelectorAll('.health-panel__header[role="button"]');
    headers.forEach(function(header) {
      header.addEventListener('click', function() {
        if (window.innerWidth >= 768) { return; }
        var expanded = header.getAttribute('aria-expanded') === 'true';
        header.setAttribute('aria-expanded', expanded ? 'false' : 'true');
      });

      header.addEventListener('keydown', function(e) {
        if (window.innerWidth >= 768) { return; }
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          header.click();
        }
      });
    });
  }

  // ── Status Banner Navigation ───────────────────────────────

  function initBannerNavigation() {
    var bannerItems = document.querySelectorAll('.health-status-banner__item[data-panel-target]');
    bannerItems.forEach(function(item) {
      item.addEventListener('click', function() {
        var targetId = item.getAttribute('data-panel-target');
        var target = document.getElementById(targetId);
        if (target) {
          // Expand the panel if collapsed
          var header = target.querySelector('.health-panel__header[role="button"]');
          if (header && header.getAttribute('aria-expanded') === 'false') {
            header.setAttribute('aria-expanded', 'true');
          }
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          target.focus();
        }
      });
    });
  }

  // ── Retry Button Handler ───────────────────────────────────

  function initRetryHandler() {
    if (!els.retryFailedBtn) { return; }

    els.retryFailedBtn.addEventListener('click', function() {
      els.retryFailedBtn.classList.add('health-retry-btn--loading');
      els.retryFailedBtn.disabled = true;
      els.retryFailedBtn.textContent = '';

      fetch('/api/webhooks/retry', { method: 'POST' })
        .then(function(res) {
          if (res.ok) {
            state.webhook.failed = 0;
            state.webhook.pending += state.webhook.failed;
            renderDashboard();
            announceToScreenReader('Failed webhook deliveries have been queued for retry');
          }
        })
        .catch(function() {
          announceToScreenReader('Failed to retry webhook deliveries');
        })
        .finally(function() {
          els.retryFailedBtn.classList.remove('health-retry-btn--loading');
          els.retryFailedBtn.textContent = 'Retry Failed';
          els.retryFailedBtn.disabled = state.webhook.failed === 0;
        });
    });
  }

  // ── Keyboard Shortcuts ─────────────────────────────────────

  function initKeyboardShortcuts() {
    document.addEventListener('keydown', function(e) {
      // Only active when health dashboard is visible
      var agentsPanel = document.getElementById('panel-agents');
      if (!agentsPanel || agentsPanel.hidden) { return; }

      var panels = ['healthDbPanel', 'healthMcpPanel', 'healthWebhookPanel', 'healthAlertsPanel'];

      // 1-4 to focus panels
      if (e.key >= '1' && e.key <= '4' && !e.ctrlKey && !e.altKey && !e.metaKey) {
        var target = e.target;
        if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA') {
          return;
        }
        var panelId = panels[parseInt(e.key, 10) - 1];
        var panel = document.getElementById(panelId);
        if (panel) {
          e.preventDefault();
          panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
          var firstFocusable = panel.querySelector('[tabindex="0"], button, a');
          if (firstFocusable) { firstFocusable.focus(); }
        }
      }

      // D to dismiss focused alert
      if (e.key === 'd' || e.key === 'D') {
        var active = document.activeElement;
        if (active && active.closest && active.closest('.alert-item')) {
          e.preventDefault();
          var alertId = active.closest('.alert-item').getAttribute('data-alert-id');
          if (alertId) { dismissAlert(alertId); }
        }
      }

      // Escape to collapse all panels on mobile
      if (e.key === 'Escape' && window.innerWidth < 768) {
        var headers = document.querySelectorAll('.health-panel__header[role="button"]');
        headers.forEach(function(h) { h.setAttribute('aria-expanded', 'false'); });
      }
    });
  }

  // ── Demo Data (fallback when API not available) ────────────

  function loadDemoData() {
    // Seed with realistic demo data
    state.db.used = 12;
    state.db.max = 20;
    state.db.idle = 8;
    state.db.waiting = 0;
    state.db.p50 = 4.2;
    state.db.p99 = 18.7;
    state.db.p50History = [3.8, 4.0, 3.9, 4.1, 4.3, 4.0, 3.7, 4.2, 4.5, 4.1, 3.9, 4.2, 4.0, 4.3, 4.2];
    state.db.p99History = [16.2, 17.1, 18.3, 17.8, 19.2, 18.0, 17.5, 18.7, 20.1, 19.5, 18.3, 18.7, 17.9, 18.5, 18.7];
    state.db.slowQueries = [
      { query: 'SELECT * FROM tickets WHERE stage = $1 ORDER BY created_at DESC LIMIT 50', duration: 234, timestamp: new Date(Date.now() - 300000).toISOString() },
      { query: 'UPDATE ticket_state SET claimed_by = $1, lease_expiry = $2 WHERE id = $3', duration: 189, timestamp: new Date(Date.now() - 600000).toISOString() },
      { query: 'INSERT INTO agent_output (ticket_id, agent, summary) VALUES ($1, $2, $3)', duration: 156, timestamp: new Date(Date.now() - 1200000).toISOString() }
    ];

    state.mcp.uptime = 1222920; // 14d 3h 22m
    state.mcp.connectedAgents = 6;
    state.mcp.reqPerMin = 142;
    state.mcp.status = 'healthy';
    state.mcp.reqHistory = [128, 135, 130, 138, 142, 140, 145, 139, 148, 142, 137, 144, 140, 146, 142];

    state.webhook.successRate = 99.2;
    state.webhook.total = 1247;
    state.webhook.pending = 3;
    state.webhook.failed = 2;

    // Seed alerts
    addAlert('critical', 'DB Latency Spike — P99 exceeded 50ms threshold');
    addAlert('warning', 'Queue Growth Warning — Pending webhooks above normal');
    addAlert('info', 'Agent Restart — Backend agent reconnected after scheduled maintenance');

    renderDashboard();
  }

  // ── Initialization ─────────────────────────────────────────

  function init() {
    cacheDom();
    initCollapseHandlers();
    initBannerNavigation();
    initRetryHandler();
    initKeyboardShortcuts();

    // Try to fetch real data, fall back to demo
    fetch('/api/health')
      .then(function(res) {
        if (!res.ok) { throw new Error('not ok'); }
        return res.json();
      })
      .then(function() {
        fetchHealthData();
        connectSSE();
        setInterval(fetchHealthData, POLL_INTERVAL_MS);
      })
      .catch(function() {
        // No API available — load demo data
        loadDemoData();
      });
  }

  // Wait for DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // ── Public API (for testing) ───────────────────────────────
  window.healthDashboard = {
    getState: function() { return state; },
    addAlert: addAlert,
    dismissAlert: dismissAlert,
    renderDashboard: renderDashboard,
    formatUptime: formatUptime,
    relativeTime: relativeTime,
    computeDbStatus: computeDbStatus,
    computeWebhookStatus: computeWebhookStatus,
    loadDemoData: loadDemoData
  };

})();
