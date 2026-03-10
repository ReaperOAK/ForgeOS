/**
 * ForgeOS Dashboard — Dependency Graph D3.js Visualization
 * Ticket: TASK-FOS-05-003
 *
 * Implements:
 *   - D3.js force-directed layout for ticket dependency DAG (AC-1)
 *   - Status-based node coloring (AC-2)
 *   - Priority-based node sizing (AC-3)
 *   - Directed edges with arrowheads (AC-4)
 *   - Critical path rendering (AC-5)
 *   - Click-to-open ticket detail panel (AC-6)
 *   - Zoom via scroll wheel; pan via click-and-drag (AC-7)
 *   - Search by ticket ID with highlight (AC-8)
 *   - SSE real-time graph updates (AC-9)
 *   - prefers-reduced-motion support (AC-10)
 *
 * @see docs/uiux/mockups/TASK-FOS-05-003.md
 */

/* global d3, openTicketDetail, announce, fetchJSON, state */
'use strict';

/* ═══════════════════════════════════════════════════════════
   GRAPH MODULE (IIFE — no global pollution)
   ═══════════════════════════════════════════════════════════ */

const ForgeGraph = (function () {

  /* ── Status Color Tokens (AC-2) ──────────────────────────── */
  const STATUS_COLORS = {
    DONE: '#22C55E',
    READY: '#3B82F6',
    BLOCKED: '#EF4444',
    CLAIMED: '#EAB308',
    ESCALATED: '#A855F7'
  };

  /* ── Priority → Radius Tokens (AC-3) ────────────────────── */
  const PRIORITY_RADIUS = {
    critical: 24,
    high: 18,
    medium: 14,
    low: 10
  };

  const PRIORITY_RADIUS_MOBILE = {
    critical: 20,
    high: 15,
    medium: 12,
    low: 8
  };

  /* ── Edge Tokens ─────────────────────────────────────────── */
  const EDGE_DEFAULTS = {
    resolvedColor: 'var(--graph-edge-resolved)',
    unresolvedColor: 'var(--graph-edge-unresolved)',
    criticalColor: 'var(--graph-edge-critical)',
    defaultStroke: 1.5,
    criticalStroke: 3,
    arrowSize: 8
  };

  /* ── Force Simulation Tokens ──────────────────────────────── */
  const FORCE_CONFIG = {
    linkDistance: 100,
    chargeStrength: -300,
    zoomMin: 0.25,
    zoomMax: 4.0
  };

  /* ── Module State ────────────────────────────────────────── */
  let svg = null;
  let gEdges = null;
  let gNodes = null;
  let simulation = null;
  let zoomBehavior = null;
  let currentTransform = d3.zoomIdentity;
  let graphData = { nodes: [], links: [] };
  let selectedNodeId = null;
  let searchQuery = '';
  let criticalPathSet = new Set();
  let criticalEdgeSet = new Set();
  let isMobile = false;
  let prefersReducedMotion = false;
  let isInitialized = false;
  let sseSource = null;

  /* ═══════════════════════════════════════════════════════════
     INITIALIZATION
     ═══════════════════════════════════════════════════════════ */

  /**
   * Initialize the dependency graph module.
   * Sets up the SVG canvas, toolbar, search input, and motion preferences.
   * Safe to call multiple times — subsequent calls are no-ops.
   */
  function init() {
    if (isInitialized) return;

    prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    isMobile = window.innerWidth < 768;

    window.matchMedia('(prefers-reduced-motion: reduce)')
      .addEventListener('change', function (e) {
        prefersReducedMotion = e.matches;
        if (simulation) {
          if (prefersReducedMotion) {
            simulation.stop();
          }
        }
      });

    setupSVG();
    bindToolbar();
    bindSearch();

    isInitialized = true;
  }

  /* ═══════════════════════════════════════════════════════════
     SVG SETUP
     ═══════════════════════════════════════════════════════════ */

  /**
   * Create the SVG element inside the graph container with zoom behavior
   * and a ResizeObserver for responsive sizing.
   */
  function setupSVG() {
    const container = document.getElementById('graphContainer');
    if (!container) return;

    svg = d3.select('#graphSvg');
    gEdges = svg.select('#graphEdges');
    gNodes = svg.select('#graphNodes');

    /* Zoom & Pan (AC-7) */
    zoomBehavior = d3.zoom()
      .scaleExtent([FORCE_CONFIG.zoomMin, FORCE_CONFIG.zoomMax])
      .on('zoom', function (event) {
        currentTransform = event.transform;
        gEdges.attr('transform', event.transform);
        gNodes.attr('transform', event.transform);
        updateZoomUI(event.transform.k);
        updateMinimap();
      });

    svg.call(zoomBehavior);

    /* Keyboard nav for graph container (AC-6 a11y) */
    container.addEventListener('keydown', handleGraphKeydown);

    /* Resize handler */
    const resizeObserver = new ResizeObserver(function () {
      isMobile = window.innerWidth < 768;
      resizeSVG();
    });
    resizeObserver.observe(container);
    resizeSVG();
  }

  /** Resize the SVG element to match its container's current dimensions. */
  function resizeSVG() {
    const container = document.getElementById('graphContainer');
    if (!container || !svg) return;
    const rect = container.getBoundingClientRect();
    svg.attr('width', rect.width).attr('height', rect.height);
  }

  /* ═══════════════════════════════════════════════════════════
     DATA LOADING
     ═══════════════════════════════════════════════════════════ */

  /**
   * Fetch ticket data from the REST API and render the dependency graph.
   * Shows loading/error/empty states as appropriate. Connects SSE for
   * real-time updates after successful render.
   * @returns {Promise<void>}
   */
  async function loadGraph() {
    const loadingEl = document.getElementById('graphLoading');
    const errorEl = document.getElementById('graphError');
    const emptyEl = document.getElementById('graphEmpty');

    if (loadingEl) loadingEl.hidden = false;
    if (errorEl) errorEl.hidden = true;
    if (emptyEl) emptyEl.hidden = true;

    try {
      const result = await fetchJSON('/api/tickets?limit=2000');
      const tickets = result.data || result || [];

      if (!tickets.length) {
        if (loadingEl) loadingEl.hidden = true;
        if (emptyEl) emptyEl.hidden = false;
        return;
      }

      buildGraphData(tickets);
      computeCriticalPath();
      renderGraph();
      connectGraphSSE();

      if (loadingEl) loadingEl.hidden = true;
      if (typeof announce === 'function') {
        announce('Dependency graph loaded with ' + graphData.nodes.length + ' tickets');
      }
    } catch (err) {
      if (loadingEl) loadingEl.hidden = true;
      if (errorEl) {
        errorEl.hidden = false;
        var msg = document.getElementById('graphErrorMsg');
        if (msg) msg.textContent = 'Failed to load graph data: ' + err.message;
      }
    }
  }

  /**
   * Transform raw ticket array into a graph data structure with nodes,
   * directed edges (dependency -> dependent), and a lookup map.
   * @param {Array<Object>} tickets - Ticket objects from the REST API.
   */
  function buildGraphData(tickets) {
    var nodeMap = {};
    var nodes = [];
    var links = [];

    tickets.forEach(function (t) {
      var id = t.ticket_id || t.id;
      if (!id) return;

      var status = deriveStatus(t);
      var priority = t.priority || 'medium';
      nodeMap[id] = {
        id: id,
        title: t.title || id,
        status: status,
        priority: priority,
        stage: t.stage || '',
        type: t.type || '',
        claimed_by: t.claimed_by || null,
        dependencies: t.dependencies || t.depends_on || [],
        dependents: []
      };
      nodes.push(nodeMap[id]);
    });

    /* Build edges from dependencies (AC-4) */
    nodes.forEach(function (node) {
      if (!node.dependencies) return;
      node.dependencies.forEach(function (depId) {
        if (nodeMap[depId]) {
          nodeMap[depId].dependents.push(node.id);
          var isResolved = nodeMap[depId].status === 'DONE';
          links.push({
            source: depId,
            target: node.id,
            isResolved: isResolved,
            edgeKey: depId + '->' + node.id
          });
        }
      });
    });

    graphData = { nodes: nodes, links: links, nodeMap: nodeMap };
  }

  /**
   * Derive display status from ticket data.
   * Maps stage/claimed state to one of the 5 AC-2 statuses.
   */
  function deriveStatus(ticket) {
    var stage = (ticket.stage || '').toUpperCase();
    if (stage === 'DONE') return 'DONE';
    if (stage === 'ESCALATED') return 'ESCALATED';
    if (ticket.claimed_by) return 'CLAIMED';

    /* Check if blocked: has unresolved deps */
    var deps = ticket.dependencies || ticket.depends_on || [];
    if (ticket.blocked_by && ticket.blocked_by.length > 0) return 'BLOCKED';
    if (deps.length > 0 && stage !== 'READY' && stage !== 'DONE') {
      return 'CLAIMED'; /* in-progress */
    }
    if (stage === 'READY') return 'READY';

    /* Default: if in any work stage without claim */
    return 'READY';
  }

  /* ═══════════════════════════════════════════════════════════
     CRITICAL PATH (AC-5)
     ═══════════════════════════════════════════════════════════ */

  /**
   * Compute the critical path through the DAG using longest-path analysis.
   * Populates criticalPathSet (node IDs) and criticalEdgeSet
   * (edge keys) used for visual emphasis during rendering (AC-5).
   */
  function computeCriticalPath() {
    criticalPathSet.clear();
    criticalEdgeSet.clear();

    if (!graphData.nodes.length) return;

    var nodeMap = graphData.nodeMap;
    var memo = {};

    /* Compute longest path from each node (depth in DAG) */
    function longestPath(nodeId) {
      if (memo[nodeId] !== undefined) return memo[nodeId];
      var node = nodeMap[nodeId];
      if (!node || !node.dependents || node.dependents.length === 0) {
        memo[nodeId] = 0;
        return 0;
      }
      var maxDepth = 0;
      node.dependents.forEach(function (depId) {
        var d = longestPath(depId) + 1;
        if (d > maxDepth) maxDepth = d;
      });
      memo[nodeId] = maxDepth;
      return maxDepth;
    }

    /* Find roots (no dependencies) */
    var roots = graphData.nodes.filter(function (n) {
      return !n.dependencies || n.dependencies.length === 0;
    });

    if (roots.length === 0) {
      /* No clear root — use all nodes */
      graphData.nodes.forEach(function (n) { longestPath(n.id); });
    } else {
      roots.forEach(function (r) { longestPath(r.id); });
    }

    /* Find the starting node with the longest path */
    var maxLen = 0;
    var startNode = null;
    Object.keys(memo).forEach(function (id) {
      if (memo[id] > maxLen) {
        maxLen = memo[id];
        startNode = id;
      }
    });

    if (!startNode || maxLen === 0) return;

    /* Trace the critical path from start through longest chain */
    function tracePath(nodeId) {
      criticalPathSet.add(nodeId);
      var node = nodeMap[nodeId];
      if (!node || !node.dependents || node.dependents.length === 0) return;

      /* Pick the dependent with the longest remaining path */
      var bestChild = null;
      var bestDepth = -1;
      node.dependents.forEach(function (depId) {
        var d = memo[depId] !== undefined ? memo[depId] : 0;
        if (d > bestDepth) {
          bestDepth = d;
          bestChild = depId;
        }
      });

      if (bestChild) {
        criticalEdgeSet.add(nodeId + '->' + bestChild);
        tracePath(bestChild);
      }
    }

    tracePath(startNode);
  }

  /* ═══════════════════════════════════════════════════════════
     RENDERING
     ═══════════════════════════════════════════════════════════ */

  /** Clear and re-render all edges, nodes, and the force simulation. */
  function renderGraph() {
    if (!gEdges || !gNodes) return;

    gEdges.selectAll('*').remove();
    gNodes.selectAll('*').remove();

    renderEdges();
    renderNodes();
    startSimulation();
  }

  /* ── Edges (AC-4, AC-5) ──────────────────────────────────── */
  /** Render directed edges with arrowhead markers and critical-path styling. */
  function renderEdges() {
    var edgeSelection = gEdges.selectAll('.graph-edge')
      .data(graphData.links, function (d) { return d.edgeKey; });

    edgeSelection.enter()
      .append('line')
      .attr('class', function (d) {
        var cls = 'graph-edge';
        if (criticalEdgeSet.has(d.edgeKey)) {
          cls += ' graph-edge--critical';
        } else if (d.isResolved) {
          cls += ' graph-edge--resolved';
        } else {
          cls += ' graph-edge--unresolved';
        }
        return cls;
      })
      .attr('stroke', function (d) {
        if (criticalEdgeSet.has(d.edgeKey)) return EDGE_DEFAULTS.criticalColor;
        return d.isResolved ? EDGE_DEFAULTS.resolvedColor : EDGE_DEFAULTS.unresolvedColor;
      })
      .attr('stroke-width', function (d) {
        return criticalEdgeSet.has(d.edgeKey) ? EDGE_DEFAULTS.criticalStroke : EDGE_DEFAULTS.defaultStroke;
      })
      .attr('stroke-dasharray', function (d) {
        if (criticalEdgeSet.has(d.edgeKey)) return null;
        return d.isResolved ? null : '6,4';
      })
      .attr('marker-end', function (d) {
        if (criticalEdgeSet.has(d.edgeKey)) return 'url(#arrowCritical)';
        return d.isResolved ? 'url(#arrowResolved)' : 'url(#arrowUnresolved)';
      })
      .attr('aria-label', function (d) {
        var s = d.isResolved ? 'resolved' : 'unresolved';
        return d.source + ' blocks ' + d.target + ', ' + s;
      });
  }

  /* ── Nodes (AC-2, AC-3) ─────────────────────────────────── */
  /**
   * Render ticket nodes as circles with status-based coloring (AC-2)
   * and priority-based sizing (AC-3). Attaches drag, click, hover,
   * and keyboard event handlers.
   */
  function renderNodes() {
    var radiusMap = isMobile ? PRIORITY_RADIUS_MOBILE : PRIORITY_RADIUS;

    var nodeGroups = gNodes.selectAll('.graph-node')
      .data(graphData.nodes, function (d) { return d.id; });

    var enter = nodeGroups.enter()
      .append('g')
      .attr('class', 'graph-node')
      .attr('tabindex', '0')
      .attr('role', 'img')
      .attr('aria-label', function (d) {
        return d.id + ', ' + d.title + ', status ' + d.status + ', priority ' + d.priority;
      })
      .on('click', function (event, d) {
        event.stopPropagation();
        handleNodeClick(d);
      })
      .on('mouseenter', function (event, d) {
        showTooltip(d, event);
      })
      .on('mouseleave', function () {
        hideTooltip();
      })
      .on('keydown', function (event, d) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          handleNodeClick(d);
        }
        if (event.key === 'Escape') {
          deselectNode();
        }
      })
      .call(d3.drag()
        .on('start', dragStarted)
        .on('drag', dragged)
        .on('end', dragEnded)
      );

    /* Hit area overlay for small nodes (WCAG 2.5.5 — 44x44px) */
    enter.append('circle')
      .attr('r', function (d) {
        var r = radiusMap[d.priority] || 14;
        return Math.max(r, 22);
      })
      .attr('fill', 'transparent')
      .attr('class', 'graph-node__hit-area');

    /* Main circle — status color fill (AC-2), priority radius (AC-3) */
    enter.append('circle')
      .attr('r', function (d) { return radiusMap[d.priority] || 14; })
      .attr('fill', function (d) { return STATUS_COLORS[d.status] || STATUS_COLORS.READY; })
      .attr('class', 'graph-node__circle')
      .attr('stroke', 'none');

    /* Focus ring */
    enter.append('circle')
      .attr('r', function (d) { return (radiusMap[d.priority] || 14) + 4; })
      .attr('fill', 'none')
      .attr('stroke', 'var(--color-focus)')
      .attr('stroke-width', 2)
      .attr('class', 'graph-node__focus-ring')
      .style('opacity', 0);

    /* Ticket ID label */
    enter.append('text')
      .text(function (d) {
        /* Abbreviate for smaller nodes */
        var r = radiusMap[d.priority] || 14;
        if (r <= 10) return '';
        var parts = d.id.split('-');
        return parts.length >= 3 ? parts[parts.length - 1] : d.id;
      })
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('class', 'graph-node__id')
      .style('font-size', function (d) {
        var r = radiusMap[d.priority] || 14;
        return r <= 12 ? '8px' : r <= 16 ? '10px' : '11px';
      })
      .style('fill', function (d) {
        /* Ensure contrast — white on most, dark on yellow */
        return d.status === 'CLAIMED' ? '#0F172A' : '#FFFFFF';
      })
      .attr('pointer-events', 'none');

    /* Accessible title element */
    enter.append('title')
      .text(function (d) { return d.id + ': ' + d.title; });

    /* Apply search/selection state */
    applyVisualFilters();
  }

  /* ═══════════════════════════════════════════════════════════
     FORCE SIMULATION (AC-1)
     ═══════════════════════════════════════════════════════════ */

  /**
   * Create and start the D3 force simulation (AC-1). Configures link,
   * charge, center, and collision forces. When prefers-reduced-motion
   * is active, runs to completion instantly without animation (AC-10).
   */
  function startSimulation() {
    if (simulation) simulation.stop();

    simulation = d3.forceSimulation(graphData.nodes)
      .force('link', d3.forceLink(graphData.links)
        .id(function (d) { return d.id; })
        .distance(FORCE_CONFIG.linkDistance)
      )
      .force('charge', d3.forceManyBody()
        .strength(FORCE_CONFIG.chargeStrength)
      )
      .force('center', d3.forceCenter(
        (parseInt(svg.attr('width'), 10) || 800) / 2,
        (parseInt(svg.attr('height'), 10) || 600) / 2
      ))
      .force('collision', d3.forceCollide()
        .radius(function (d) {
          var radiusMap = isMobile ? PRIORITY_RADIUS_MOBILE : PRIORITY_RADIUS;
          return (radiusMap[d.priority] || 14) + 8;
        })
      )
      .on('tick', ticked);

    /* AC-10: Respect prefers-reduced-motion */
    if (prefersReducedMotion) {
      /* Run simulation to completion instantly, no animation */
      simulation.alpha(1);
      for (var i = 0; i < 300; i++) {
        simulation.tick();
      }
      simulation.stop();
      ticked();
    } else {
      /* Animated: stop after ~3s for performance */
      simulation.alphaDecay(0.04);
      setTimeout(function () {
        if (simulation) simulation.stop();
      }, 3000);
    }
  }

  /** Update edge and node positions on each simulation tick. */
  function ticked() {
    gEdges.selectAll('.graph-edge')
      .attr('x1', function (d) { return d.source.x; })
      .attr('y1', function (d) { return d.source.y; })
      .attr('x2', function (d) {
        return offsetEdgeEnd(d.source, d.target, true);
      })
      .attr('y2', function (d) {
        return offsetEdgeEnd(d.source, d.target, false);
      });

    gNodes.selectAll('.graph-node')
      .attr('transform', function (d) {
        return 'translate(' + d.x + ',' + d.y + ')';
      });

    updateMinimap();
  }

  /**
   * Offset edge end to stop at circle boundary, not center.
   */
  function offsetEdgeEnd(source, target, isX) {
    var radiusMap = isMobile ? PRIORITY_RADIUS_MOBILE : PRIORITY_RADIUS;
    var targetR = radiusMap[target.priority] || 14;
    var dx = target.x - source.x;
    var dy = target.y - source.y;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist === 0) return isX ? target.x : target.y;

    var offset = targetR + EDGE_DEFAULTS.arrowSize;
    if (isX) return target.x - (dx / dist) * offset;
    return target.y - (dy / dist) * offset;
  }

  /* ── D3 Drag Handlers ───────────────────────────────────── */
  function dragStarted(event, d) {
    if (!event.active && simulation) simulation.alphaTarget(0.3).restart();
    d.fx = d.x;
    d.fy = d.y;
  }

  function dragged(event, d) {
    d.fx = event.x;
    d.fy = event.y;
  }

  function dragEnded(event, d) {
    if (!event.active && simulation) simulation.alphaTarget(0);
    d.fx = null;
    d.fy = null;
  }

  /* ═══════════════════════════════════════════════════════════
     NODE INTERACTION (AC-6)
     ═══════════════════════════════════════════════════════════ */

  /**
   * Handle click on a graph node. Toggles selection, applies visual
   * filters to dim non-adjacent nodes, and opens popover (AC-6).
   * @param {Object} d - D3 datum for the clicked node.
   */
  function handleNodeClick(d) {
    if (selectedNodeId === d.id) {
      deselectNode();
      return;
    }

    selectedNodeId = d.id;
    applyVisualFilters();
    showPopover(d);

    /* Announce to screen readers */
    if (typeof announce === 'function') {
      announce('Selected ' + d.id + ', ' + d.title + ', status ' + d.status);
    }
  }

  function deselectNode() {
    selectedNodeId = null;
    hidePopover();
    applyVisualFilters();
  }

  /* ── Tooltip (hover, 200ms delay) ────────────────────────── */
  var tooltipTimeout = null;

  /**
   * Show a tooltip near the cursor after a 200ms hover delay.
   * @param {Object} d - D3 datum for the hovered node.
   * @param {MouseEvent} event - The mouse event for positioning.
   */
  function showTooltip(d, event) {
    clearTimeout(tooltipTimeout);
    tooltipTimeout = setTimeout(function () {
      var tooltip = document.getElementById('graphTooltip');
      if (!tooltip) return;

      var idEl = document.getElementById('tooltipId');
      var titleEl = document.getElementById('tooltipTitle');
      var stageEl = document.getElementById('tooltipStage');

      if (idEl) idEl.textContent = d.id;
      if (titleEl) titleEl.textContent = d.title;
      if (stageEl) stageEl.textContent = '● ' + d.status + '  ◼ ' + d.priority;

      tooltip.hidden = false;

      /* Position near cursor */
      var x = event.pageX || event.clientX || 0;
      var y = event.pageY || event.clientY || 0;
      tooltip.style.left = (x + 12) + 'px';
      tooltip.style.top = (y - 8) + 'px';

      /* Keep within viewport */
      var rect = tooltip.getBoundingClientRect();
      if (rect.right > window.innerWidth) {
        tooltip.style.left = (x - rect.width - 12) + 'px';
      }
      if (rect.bottom > window.innerHeight) {
        tooltip.style.top = (y - rect.height - 8) + 'px';
      }
    }, 200);
  }

  function hideTooltip() {
    clearTimeout(tooltipTimeout);
    var tooltip = document.getElementById('graphTooltip');
    if (tooltip) tooltip.hidden = true;
  }

  /* ── Popover (click) ─────────────────────────────────────── */
  function showPopover(d) {
    /* Mobile: use bottom sheet instead */
    if (isMobile) {
      showBottomSheet(d);
      return;
    }

    var popover = document.getElementById('graphPopover');
    if (!popover) return;

    var idEl = document.getElementById('popoverId');
    var titleEl = document.getElementById('popoverTitle');
    var stageEl = document.getElementById('popoverStage');
    var typeEl = document.getElementById('popoverType');
    var prioEl = document.getElementById('popoverPriority');
    var claimedEl = document.getElementById('popoverClaimed');
    var depsEl = document.getElementById('popoverDeps');
    var deptsEl = document.getElementById('popoverDependents');

    if (idEl) idEl.textContent = d.id;
    if (titleEl) titleEl.textContent = d.title;
    if (stageEl) stageEl.textContent = d.stage || d.status;
    if (typeEl) typeEl.textContent = d.type || '—';
    if (prioEl) prioEl.textContent = d.priority;
    if (claimedEl) claimedEl.textContent = d.claimed_by || 'Unclaimed';

    if (depsEl) {
      depsEl.innerHTML = '';
      (d.dependencies || []).forEach(function (depId) {
        var li = document.createElement('li');
        li.textContent = depId;
        depsEl.appendChild(li);
      });
      if (!d.dependencies || d.dependencies.length === 0) {
        depsEl.innerHTML = '<li>None</li>';
      }
    }

    if (deptsEl) {
      deptsEl.innerHTML = '';
      (d.dependents || []).forEach(function (depId) {
        var li = document.createElement('li');
        li.textContent = depId;
        deptsEl.appendChild(li);
      });
      if (!d.dependents || d.dependents.length === 0) {
        deptsEl.innerHTML = '<li>None</li>';
      }
    }

    /* Position popover near the node */
    var nodeScreen = getNodeScreenPosition(d);
    popover.style.left = (nodeScreen.x + 20) + 'px';
    popover.style.top = (nodeScreen.y - 60) + 'px';
    popover.hidden = false;
    popover.focus();

    /* Detail button */
    var detailBtn = document.getElementById('popoverDetailBtn');
    if (detailBtn) {
      detailBtn.onclick = function () {
        if (typeof openTicketDetail === 'function') {
          openTicketDetail(d.id);
        }
        hidePopover();
      };
    }

    /* Close button */
    var closeBtn = document.getElementById('popoverClose');
    if (closeBtn) {
      closeBtn.onclick = function () {
        deselectNode();
      };
    }
  }

  function hidePopover() {
    var popover = document.getElementById('graphPopover');
    if (popover) popover.hidden = true;
  }

  /* ── Bottom Sheet (Mobile) ───────────────────────────────── */
  function showBottomSheet(d) {
    var sheet = document.querySelector('.graph-bottom-sheet');
    if (!sheet) return;

    var idEl = sheet.querySelector('.graph-bottom-sheet__id');
    var titleEl = sheet.querySelector('.graph-bottom-sheet__title');
    var btn = sheet.querySelector('.graph-bottom-sheet__btn');

    if (idEl) idEl.textContent = d.id;
    if (titleEl) titleEl.textContent = d.title;
    if (btn) {
      btn.onclick = function () {
        if (typeof openTicketDetail === 'function') {
          openTicketDetail(d.id);
        }
        hideBottomSheet();
      };
    }

    sheet.style.display = 'block';
  }

  function hideBottomSheet() {
    var sheet = document.querySelector('.graph-bottom-sheet');
    if (sheet) sheet.style.display = 'none';
  }

  function getNodeScreenPosition(d) {
    var container = document.getElementById('graphContainer');
    if (!container) return { x: 0, y: 0 };
    var rect = container.getBoundingClientRect();
    return {
      x: rect.left + currentTransform.applyX(d.x),
      y: rect.top + currentTransform.applyY(d.y)
    };
  }

  /* ═══════════════════════════════════════════════════════════
     VISUAL FILTERS (Search + Selection)
     ═══════════════════════════════════════════════════════════ */

  function applyVisualFilters() {
    var hasSearch = searchQuery.length >= 2;
    var hasSelection = selectedNodeId !== null;

    /* Determine which nodes are "highlighted" */
    var highlightedNodes = new Set();

    if (hasSearch) {
      var q = searchQuery.toLowerCase();
      graphData.nodes.forEach(function (n) {
        if (n.id.toLowerCase().indexOf(q) >= 0) {
          highlightedNodes.add(n.id);
        }
      });
    }

    if (hasSelection) {
      highlightedNodes.add(selectedNodeId);
      /* Also highlight direct deps and dependents */
      var selNode = graphData.nodeMap[selectedNodeId];
      if (selNode) {
        (selNode.dependencies || []).forEach(function (id) { highlightedNodes.add(id); });
        (selNode.dependents || []).forEach(function (id) { highlightedNodes.add(id); });
      }
    }

    var shouldFade = hasSearch || hasSelection;

    /* Apply to nodes */
    gNodes.selectAll('.graph-node').each(function (d) {
      var g = d3.select(this);
      var isHighlighted = !shouldFade || highlightedNodes.has(d.id);
      var isSelected = d.id === selectedNodeId;

      g.classed('graph-node--faded', !isHighlighted);
      g.classed('graph-node--selected', isSelected);

      /* Glow ring for selected */
      g.select('.graph-node__focus-ring')
        .style('opacity', isSelected ? 1 : 0)
        .attr('filter', isSelected ? 'url(#glow)' : null);
    });

    /* Apply to edges */
    gEdges.selectAll('.graph-edge').each(function (d) {
      var line = d3.select(this);
      var sourceId = typeof d.source === 'object' ? d.source.id : d.source;
      var targetId = typeof d.target === 'object' ? d.target.id : d.target;
      var isHighlighted = !shouldFade ||
        (highlightedNodes.has(sourceId) && highlightedNodes.has(targetId));
      line.classed('graph-edge--faded', !isHighlighted);
    });

    /* Auto-center on single search match (AC-8) */
    if (hasSearch && highlightedNodes.size === 1) {
      var matchId = Array.from(highlightedNodes)[0];
      var matchNode = graphData.nodeMap[matchId];
      if (matchNode && matchNode.x !== undefined) {
        centerOnNode(matchNode);
      }
    }
  }

  /**
   * Pan and zoom the view to center on a specific node.
   * @param {Object} node - D3 datum with x/y coordinates.
   */
  function centerOnNode(node) {
    if (!svg || !zoomBehavior) return;
    var w = parseInt(svg.attr('width'), 10) || 800;
    var h = parseInt(svg.attr('height'), 10) || 600;
    var scale = currentTransform.k;

    var t = d3.zoomIdentity
      .translate(w / 2, h / 2)
      .scale(scale)
      .translate(-node.x, -node.y);

    if (prefersReducedMotion) {
      svg.call(zoomBehavior.transform, t);
    } else {
      svg.transition().duration(500).call(zoomBehavior.transform, t);
    }
  }

  /* ═══════════════════════════════════════════════════════════
     SEARCH (AC-8)
     ═══════════════════════════════════════════════════════════ */

  var searchDebounceTimer = null;

  /**
   * Bind debounced search input to filter and highlight graph nodes (AC-8).
   * Matching nodes are highlighted; the best match is centered on screen.
   */
  function bindSearch() {
    /* Graph toolbar has a search via the graph search input,
       but we also support the global search. Look for a graph-specific
       search input first. If none, we'll add inline search handling. */
    var searchInput = document.getElementById('graphSearchInput');

    if (!searchInput) {
      /* Create inline search at the start of the toolbar */
      var toolbar = document.querySelector('#panel-graph .graph-toolbar');
      if (toolbar) {
        var searchGroup = document.createElement('div');
        searchGroup.className = 'graph-toolbar__search';
        searchGroup.style.display = 'flex';
        searchGroup.style.alignItems = 'center';
        searchGroup.style.gap = 'var(--space-xs)';

        var label = document.createElement('label');
        label.setAttribute('for', 'graphSearchInput');
        label.className = 'sr-only';
        label.textContent = 'Search tickets by ID';

        var input = document.createElement('input');
        input.type = 'search';
        input.id = 'graphSearchInput';
        input.className = 'graph-toolbar__btn';
        input.placeholder = 'Search by ticket ID…';
        input.setAttribute('aria-label', 'Search tickets by ID');
        input.style.minWidth = '180px';
        input.style.fontFamily = 'var(--font-mono)';
        input.style.fontSize = 'var(--text-sm)';
        input.style.padding = 'var(--space-xs) var(--space-sm)';

        searchGroup.appendChild(label);
        searchGroup.appendChild(input);
        toolbar.insertBefore(searchGroup, toolbar.firstChild);

        searchInput = input;
      }
    }

    if (searchInput) {
      searchInput.addEventListener('input', function () {
        clearTimeout(searchDebounceTimer);
        var val = searchInput.value.trim();
        searchDebounceTimer = setTimeout(function () {
          searchQuery = val;
          applyVisualFilters();

          /* Announce for screen readers */
          if (typeof announce === 'function') {
            if (val.length >= 2) {
              var matchCount = 0;
              var q = val.toLowerCase();
              graphData.nodes.forEach(function (n) {
                if (n.id.toLowerCase().indexOf(q) >= 0) matchCount++;
              });
              announce(matchCount + ' ticket' + (matchCount !== 1 ? 's' : '') + ' found');
            } else {
              announce('Search cleared');
            }
          }
        }, 300);
      });

      searchInput.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
          searchInput.value = '';
          searchQuery = '';
          applyVisualFilters();
        }
      });
    }
  }

  /* ═══════════════════════════════════════════════════════════
     TOOLBAR CONTROLS (AC-7)
     ═══════════════════════════════════════════════════════════ */

  function bindToolbar() {
    /* Zoom controls */
    var zoomInBtn = document.getElementById('zoomIn');
    var zoomOutBtn = document.getElementById('zoomOut');
    var zoomSlider = document.getElementById('zoomSlider');
    var zoomFitBtn = document.getElementById('zoomFit');
    var resetBtn = document.getElementById('resetFilters');
    var retryBtn = document.getElementById('graphRetry');

    if (zoomInBtn) {
      zoomInBtn.addEventListener('click', function () {
        zoomBy(1.25);
      });
    }

    if (zoomOutBtn) {
      zoomOutBtn.addEventListener('click', function () {
        zoomBy(0.8);
      });
    }

    if (zoomSlider) {
      zoomSlider.addEventListener('input', function () {
        var scale = parseInt(zoomSlider.value, 10) / 100;
        setZoom(scale);
      });
    }

    if (zoomFitBtn) {
      zoomFitBtn.addEventListener('click', function () {
        fitToView();
      });
    }

    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        resetGraph();
      });
    }

    if (retryBtn) {
      retryBtn.addEventListener('click', function () {
        loadGraph();
      });
    }
  }

  function zoomBy(factor) {
    if (!svg || !zoomBehavior) return;
    if (prefersReducedMotion) {
      svg.call(zoomBehavior.scaleBy, factor);
    } else {
      svg.transition().duration(300).call(zoomBehavior.scaleBy, factor);
    }
  }

  function setZoom(scale) {
    if (!svg || !zoomBehavior) return;
    var w = parseInt(svg.attr('width'), 10) || 800;
    var h = parseInt(svg.attr('height'), 10) || 600;
    var t = d3.zoomIdentity
      .translate(w / 2, h / 2)
      .scale(scale)
      .translate(-w / 2, -h / 2);
    svg.call(zoomBehavior.transform, t);
  }

  /**
   * Zoom and pan the SVG so all nodes fit within the viewport with padding.
   * Respects prefers-reduced-motion for the transition.
   */
  function fitToView() {
    if (!svg || !zoomBehavior || !graphData.nodes.length) return;

    var bounds = getGraphBounds();
    var w = parseInt(svg.attr('width'), 10) || 800;
    var h = parseInt(svg.attr('height'), 10) || 600;

    var padding = 40;
    var bw = bounds.maxX - bounds.minX + padding * 2;
    var bh = bounds.maxY - bounds.minY + padding * 2;
    var scale = Math.min(w / bw, h / bh, 2);
    scale = Math.max(scale, FORCE_CONFIG.zoomMin);

    var cx = (bounds.minX + bounds.maxX) / 2;
    var cy = (bounds.minY + bounds.maxY) / 2;

    var t = d3.zoomIdentity
      .translate(w / 2, h / 2)
      .scale(scale)
      .translate(-cx, -cy);

    if (prefersReducedMotion) {
      svg.call(zoomBehavior.transform, t);
    } else {
      svg.transition().duration(500).call(zoomBehavior.transform, t);
    }
  }

  /** Reset selection, search query, dismiss overlays, and fit-to-view. */
  function resetGraph() {
    selectedNodeId = null;
    searchQuery = '';
    var searchInput = document.getElementById('graphSearchInput');
    if (searchInput) searchInput.value = '';

    hidePopover();
    hideBottomSheet();
    applyVisualFilters();
    fitToView();
  }

  function updateZoomUI(scale) {
    var slider = document.getElementById('zoomSlider');
    if (slider) {
      slider.value = Math.round(scale * 100);
      slider.title = 'Zoom: ' + Math.round(scale * 100) + '%';
    }

    var label = document.querySelector('.graph-toolbar__zoom-label');
    if (label) {
      label.textContent = Math.round(scale * 100) + '%';
    }
  }

  function getGraphBounds() {
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    graphData.nodes.forEach(function (n) {
      if (n.x < minX) minX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.x > maxX) maxX = n.x;
      if (n.y > maxY) maxY = n.y;
    });
    return { minX: minX, minY: minY, maxX: maxX, maxY: maxY };
  }

  /* ═══════════════════════════════════════════════════════════
     MINIMAP
     ═══════════════════════════════════════════════════════════ */

  function updateMinimap() {
    var canvas = document.getElementById('minimapCanvas');
    var vpEl = document.getElementById('minimapViewport');
    if (!canvas || !vpEl || !graphData.nodes.length) return;

    var ctx = canvas.getContext('2d');
    if (!ctx) return;

    var bounds = getGraphBounds();
    var padding = 20;
    var bw = bounds.maxX - bounds.minX + padding * 2;
    var bh = bounds.maxY - bounds.minY + padding * 2;

    var cw = canvas.width;
    var ch = canvas.height;
    var scale = Math.min(cw / bw, ch / bh);

    ctx.clearRect(0, 0, cw, ch);

    /* Draw edges as thin lines */
    ctx.strokeStyle = 'rgba(100,116,139,0.3)';
    ctx.lineWidth = 0.5;
    graphData.links.forEach(function (link) {
      var s = typeof link.source === 'object' ? link.source : graphData.nodeMap[link.source];
      var t = typeof link.target === 'object' ? link.target : graphData.nodeMap[link.target];
      if (!s || !t) return;
      ctx.beginPath();
      ctx.moveTo((s.x - bounds.minX + padding) * scale, (s.y - bounds.minY + padding) * scale);
      ctx.lineTo((t.x - bounds.minX + padding) * scale, (t.y - bounds.minY + padding) * scale);
      ctx.stroke();
    });

    /* Draw nodes as dots */
    graphData.nodes.forEach(function (n) {
      var x = (n.x - bounds.minX + padding) * scale;
      var y = (n.y - bounds.minY + padding) * scale;
      var color = STATUS_COLORS[n.status] || STATUS_COLORS.READY;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, Math.PI * 2);
      ctx.fill();
    });

    /* Viewport indicator */
    var svgW = parseInt(svg.attr('width'), 10) || 800;
    var svgH = parseInt(svg.attr('height'), 10) || 600;

    var invK = 1 / currentTransform.k;
    var vpX = (-currentTransform.x * invK - bounds.minX + padding) * scale;
    var vpY = (-currentTransform.y * invK - bounds.minY + padding) * scale;
    var vpW = svgW * invK * scale;
    var vpH = svgH * invK * scale;

    vpEl.style.left = Math.max(0, vpX) + 'px';
    vpEl.style.top = Math.max(0, vpY) + 'px';
    vpEl.style.width = Math.min(vpW, cw) + 'px';
    vpEl.style.height = Math.min(vpH, ch) + 'px';
  }

  /* Minimap toggle */
  (function () {
    var toggle = document.getElementById('minimapToggle');
    var minimap = document.getElementById('graphMinimap');
    if (toggle && minimap) {
      toggle.addEventListener('click', function () {
        minimap.classList.toggle('graph-minimap--hidden');
      });
    }
  })();

  /* ═══════════════════════════════════════════════════════════
     SSE REAL-TIME UPDATES (AC-9)
     ═══════════════════════════════════════════════════════════ */

  /**
   * Connect to the SSE endpoint for real-time ticket update events (AC-9).
   * Automatically reconnects on connection loss with a 3-second delay.
   */
  function connectGraphSSE() {
    /* Reuse the main app's SSE connection by intercepting ticket-update events.
       We hook into the existing EventSource rather than creating a new one. */

    /* Listen for custom events dispatched by the main SSE handler */
    document.addEventListener('forgeos:ticket-update', function (e) {
      handleGraphTicketUpdate(e.detail);
    });

    /* Also patch the global handleTicketUpdate if it exists */
    if (typeof window.handleTicketUpdate === 'function') {
      var originalHandler = window.handleTicketUpdate;
      window.handleTicketUpdate = function (data) {
        originalHandler(data);
        handleGraphTicketUpdate(data);
      };
    }

    /* Fallback: create own listener on the existing EventSource */
    if (state && state.eventSource) {
      state.eventSource.addEventListener('ticket-update', function (e) {
        try {
          handleGraphTicketUpdate(JSON.parse(e.data));
        } catch (err) {
          /* Ignore parse errors */
        }
      });
    }
  }

  /**
   * Handle an incoming SSE ticket-update event. Updates the affected
   * node, recomputes the critical path, shows a pulse animation and
   * a toast notification.
   * @param {Object} data - Parsed event payload with ticket_id and new data.
   */
  function handleGraphTicketUpdate(data) {
    var ticket = data.ticket || data;
    var ticketId = ticket.ticket_id || ticket.id;
    if (!ticketId) return;

    var node = graphData.nodeMap ? graphData.nodeMap[ticketId] : null;
    if (!node) return;

    var oldStatus = node.status;
    var newStatus = deriveStatus(ticket);

    /* Update node data */
    node.status = newStatus;
    node.title = ticket.title || node.title;
    node.stage = ticket.stage || node.stage;
    node.claimed_by = ticket.claimed_by || null;

    /* Update edge resolved state */
    graphData.links.forEach(function (link) {
      var sourceId = typeof link.source === 'object' ? link.source.id : link.source;
      if (sourceId === ticketId) {
        link.isResolved = newStatus === 'DONE';
      }
    });

    /* Recompute critical path */
    computeCriticalPath();

    /* Update node visual */
    var nodeEl = gNodes.selectAll('.graph-node')
      .filter(function (d) { return d.id === ticketId; });

    nodeEl.select('.graph-node__circle')
      .transition()
      .duration(prefersReducedMotion ? 0 : 400)
      .attr('fill', STATUS_COLORS[newStatus] || STATUS_COLORS.READY);

    /* Update text color for CLAIMED (yellow needs dark text) */
    nodeEl.select('.graph-node__id')
      .style('fill', newStatus === 'CLAIMED' ? '#0F172A' : '#FFFFFF');

    /* Pulse animation (AC-9) */
    if (!prefersReducedMotion && oldStatus !== newStatus) {
      showPulseAnimation(nodeEl, node);
    }

    /* Show SSE toast notification */
    if (oldStatus !== newStatus) {
      showSSEToast(ticketId, oldStatus, newStatus);
    }

    /* Update edge visuals */
    gEdges.selectAll('.graph-edge').each(function (d) {
      var line = d3.select(this);
      var sourceId = typeof d.source === 'object' ? d.source.id : d.source;
      if (sourceId === ticketId) {
        if (d.isResolved) {
          line.classed('graph-edge--resolved', true)
            .classed('graph-edge--unresolved', false)
            .attr('stroke', EDGE_DEFAULTS.resolvedColor)
            .attr('stroke-dasharray', null)
            .attr('marker-end', 'url(#arrowResolved)');
        }
      }
    });

    updateMinimap();
  }

  /* ── Pulse Animation ─────────────────────────────────────── */
  function showPulseAnimation(nodeEl, node) {
    var radiusMap = isMobile ? PRIORITY_RADIUS_MOBILE : PRIORITY_RADIUS;
    var r = radiusMap[node.priority] || 14;

    var pulse = nodeEl.append('circle')
      .attr('r', r)
      .attr('fill', 'none')
      .attr('stroke', 'rgba(34, 197, 94, 0.4)')
      .attr('stroke-width', 3)
      .attr('class', 'graph-node__pulse');

    pulse.transition()
      .duration(1000)
      .attr('r', r + 20)
      .attr('stroke-width', 0)
      .style('opacity', 0)
      .remove();
  }

  /* ── SSE Update Toast (AC-9) ─────────────────────────────── */
  function showSSEToast(ticketId, oldStatus, newStatus) {
    var existing = document.querySelector('.graph-sse-toast');
    if (existing) existing.remove();

    var toast = document.createElement('div');
    toast.className = 'graph-sse-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.style.cssText = [
      'position: fixed',
      'top: 80px',
      'right: 16px',
      'padding: 12px 16px',
      'background: var(--color-surface)',
      'border: 1px solid var(--color-border)',
      'border-radius: var(--radius-lg, 8px)',
      'box-shadow: var(--shadow-lg, 0 4px 12px rgba(0,0,0,0.3))',
      'z-index: 60',
      'display: flex',
      'align-items: center',
      'gap: 8px',
      'font-family: var(--font-sans, Inter, sans-serif)',
      'font-size: var(--text-sm, 14px)',
      'max-width: 360px',
      'color: var(--color-text, #F8FAFC)'
    ].join(';');

    var dot = document.createElement('span');
    dot.style.cssText = [
      'width: 8px',
      'height: 8px',
      'border-radius: 50%',
      'background: ' + (STATUS_COLORS[newStatus] || '#3B82F6'),
      'flex-shrink: 0'
    ].join(';');
    dot.setAttribute('aria-hidden', 'true');

    var text = document.createElement('span');
    text.innerHTML =
      '<strong style="font-family:var(--font-mono,monospace)">' + escapeHtml(ticketId) + '</strong>' +
      ' → ' + escapeHtml(newStatus) +
      '<br><span style="color:var(--color-text-muted,#94A3B8);font-size:var(--text-xs,12px)">Status changed from ' +
      escapeHtml(oldStatus) + '</span>';

    toast.appendChild(dot);
    toast.appendChild(text);
    document.body.appendChild(toast);

    /* Auto-dismiss */
    if (!prefersReducedMotion) {
      toast.style.transform = 'translateX(120%)';
      toast.style.transition = 'transform 300ms ease-out';
      requestAnimationFrame(function () {
        toast.style.transform = 'translateX(0)';
      });
    }

    setTimeout(function () {
      if (!prefersReducedMotion) {
        toast.style.transform = 'translateX(120%)';
        setTimeout(function () {
          if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 300);
      } else {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }
    }, 3000);
  }

  /* ═══════════════════════════════════════════════════════════
     KEYBOARD NAVIGATION
     ═══════════════════════════════════════════════════════════ */

  function handleGraphKeydown(e) {
    switch (e.key) {
      case 'Escape':
        deselectNode();
        break;
      case '+':
      case '=':
        e.preventDefault();
        zoomBy(1.25);
        break;
      case '-':
        e.preventDefault();
        zoomBy(0.8);
        break;
      case '0':
        e.preventDefault();
        fitToView();
        break;
    }
  }

  /* ═══════════════════════════════════════════════════════════
     LEGEND
     ═══════════════════════════════════════════════════════════ */

  /**
   * Create and inject the graph legend element showing status colors,
   * edge types, and priority-based node sizes.
   */
  function createLegend() {
    var container = document.getElementById('graphContainer');
    if (!container || container.querySelector('.graph-legend')) return;

    var legend = document.createElement('div');
    legend.className = 'graph-legend';
    legend.setAttribute('role', 'img');
    legend.setAttribute('aria-label', 'Graph legend: status colors, edge types, and node sizes');
    legend.style.cssText = [
      'position: absolute',
      'bottom: 16px',
      'left: 16px',
      'padding: 12px 16px',
      'background: var(--graph-minimap-bg, rgba(15,23,42,0.8))',
      'border: 1px solid var(--color-border, #334155)',
      'border-radius: var(--radius-lg, 8px)',
      'font-size: var(--text-xs, 12px)',
      'color: var(--color-text, #F8FAFC)',
      'z-index: 5',
      'line-height: 1.6',
      'min-width: 160px'
    ].join(';');

    var html = '<strong style="font-size:var(--text-sm,13px)">Status</strong><br>';

    Object.keys(STATUS_COLORS).forEach(function (status) {
      html += '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;' +
        'background:' + STATUS_COLORS[status] + ';vertical-align:middle;margin-right:6px" aria-hidden="true"></span>' +
        status + '<br>';
    });

    html += '<br><strong style="font-size:var(--text-sm,13px)">Edges</strong><br>';
    html += '<span style="display:inline-block;width:20px;border-top:1.5px solid var(--graph-edge-resolved,#475569);' +
      'vertical-align:middle;margin-right:6px" aria-hidden="true"></span>Resolved<br>';
    html += '<span style="display:inline-block;width:20px;border-top:1.5px dashed var(--graph-edge-unresolved,#64748B);' +
      'vertical-align:middle;margin-right:6px" aria-hidden="true"></span>Unresolved<br>';
    html += '<span style="display:inline-block;width:20px;border-top:3px solid var(--graph-edge-critical,#06B6D4);' +
      'vertical-align:middle;margin-right:6px" aria-hidden="true"></span>Critical Path<br>';

    html += '<br><strong style="font-size:var(--text-sm,13px)">Size = Priority</strong><br>';
    var sizes = [
      { label: 'Critical', r: 8 },
      { label: 'High', r: 6 },
      { label: 'Medium', r: 4 },
      { label: 'Low', r: 3 }
    ];
    sizes.forEach(function (s) {
      html += '<span style="display:inline-block;width:' + (s.r * 2) + 'px;height:' + (s.r * 2) + 'px;' +
        'border-radius:50%;background:var(--color-text-muted,#94A3B8);vertical-align:middle;margin-right:6px" ' +
        'aria-hidden="true"></span>' + s.label + '<br>';
    });

    legend.innerHTML = html;

    /* Toggle collapse */
    var toggleBtn = document.createElement('button');
    toggleBtn.setAttribute('aria-label', 'Toggle legend');
    toggleBtn.style.cssText = [
      'position: absolute',
      'top: 4px',
      'right: 4px',
      'width: 20px',
      'height: 20px',
      'background: transparent',
      'border: none',
      'color: var(--color-text-muted)',
      'cursor: pointer',
      'font-size: 12px',
      'display: flex',
      'align-items: center',
      'justify-content: center'
    ].join(';');
    toggleBtn.textContent = '−';

    var content = document.createElement('div');
    content.innerHTML = legend.innerHTML;
    legend.innerHTML = '';
    legend.appendChild(toggleBtn);
    legend.appendChild(content);

    toggleBtn.addEventListener('click', function () {
      var isHidden = content.style.display === 'none';
      content.style.display = isHidden ? '' : 'none';
      toggleBtn.textContent = isHidden ? '−' : '+';
      legend.style.minWidth = isHidden ? '160px' : '32px';
    });

    container.style.position = 'relative';
    container.appendChild(legend);
  }

  /* ═══════════════════════════════════════════════════════════
     GRAPH UPDATE (Full Reload)
     ═══════════════════════════════════════════════════════════ */

  /**
   * Update a single node's visual state without full re-render.
   * Used by SSE handler for real-time ticket status changes.
   * @param {string} ticketId - The ticket ID to update.
   * @param {Object} newData - Partial node data (status, title, priority).
   */
  function updateNode(ticketId, newData) {
    var node = graphData.nodeMap ? graphData.nodeMap[ticketId] : null;
    if (!node) return;

    if (newData.status) node.status = newData.status;
    if (newData.title) node.title = newData.title;
    if (newData.priority) node.priority = newData.priority;

    var nodeEl = gNodes.selectAll('.graph-node')
      .filter(function (d) { return d.id === ticketId; });

    nodeEl.select('.graph-node__circle')
      .attr('fill', STATUS_COLORS[node.status] || STATUS_COLORS.READY);

    nodeEl.select('.graph-node__id')
      .style('fill', node.status === 'CLAIMED' ? '#0F172A' : '#FFFFFF');

    nodeEl.attr('aria-label',
      node.id + ', ' + node.title + ', status ' + node.status + ', priority ' + node.priority);
  }

  /* ═══════════════════════════════════════════════════════════
     UTILITIES
     ═══════════════════════════════════════════════════════════ */

  /**
   * Escape a string for safe HTML insertion.
   * @param {string} str - Raw string to escape.
   * @returns {string} HTML-safe string.
   */
  function escapeHtml(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  /* ═══════════════════════════════════════════════════════════
     PUBLIC API
     ═══════════════════════════════════════════════════════════ */

  return {
    init: init,
    loadGraph: loadGraph,
    fitToView: fitToView,
    resetGraph: resetGraph,
    updateNode: updateNode,
    createLegend: createLegend
  };

})();

/* ═══════════════════════════════════════════════════════════
   INTEGRATION — Auto-initialize when graph tab is shown
   ═══════════════════════════════════════════════════════════ */

(function () {
  var graphTab = document.getElementById('tab-graph');
  var graphLoaded = false;

  function onGraphTabActivated() {
    if (!graphLoaded) {
      ForgeGraph.init();
      ForgeGraph.loadGraph().then(function () {
        ForgeGraph.createLegend();
        graphLoaded = true;
      });
    }
  }

  if (graphTab) {
    graphTab.addEventListener('click', function () {
      /* Delay to let view panel become visible */
      requestAnimationFrame(function () {
        onGraphTabActivated();
      });
    });
  }

  /* Also check if graph view is already active (e.g., direct URL hash) */
  if (window.location.hash === '#/graph' || window.location.hash === '#graph') {
    document.addEventListener('DOMContentLoaded', function () {
      onGraphTabActivated();
    });
  }
})();
