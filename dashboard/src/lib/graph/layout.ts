/**
 * DAG layout engine for the dependency graph.
 *
 * Performs topological sort followed by Sugiyama-style layer assignment
 * to produce readable, non-overlapping node positions.
 */

/** A positioned ticket node in the dependency graph. */
export interface GraphNode {
  /** Unique ticket identifier (e.g. `"FORGEOS-FE003"`). */
  id: string;
  /** Human-readable ticket title. */
  title: string;
  /** Current SDLC stage name. */
  stage: string;
  /** IDs of upstream dependencies this ticket depends on. */
  dependsOn: string[];
  /** Computed left-offset in SVG coordinates. */
  x: number;
  /** Computed top-offset in SVG coordinates. */
  y: number;
  /** Node width in pixels. */
  width: number;
  /** Node height in pixels. */
  height: number;
}

/** A directed edge between two graph nodes (dependency → dependent). */
export interface GraphEdge {
  /** Source node ID (the upstream dependency). */
  from: string;
  /** Target node ID (the downstream dependent). */
  to: string;
}

/** Complete graph layout ready for SVG rendering. */
export interface GraphLayout {
  /** All positioned nodes. */
  nodes: GraphNode[];
  /** All directed edges. */
  edges: GraphEdge[];
  /** Total canvas width in pixels. */
  width: number;
  /** Total canvas height in pixels. */
  height: number;
}

const NODE_WIDTH = 180;
const NODE_HEIGHT = 56;
const HORIZONTAL_GAP = 80;
const VERTICAL_GAP = 100;
const PADDING = 60;

/**
 * Topological sort via Kahn's algorithm.
 * Returns ordered node IDs from sources (no dependencies) to sinks.
 * Nodes in cycles are appended at the end.
 */
function topologicalSort(
  nodeIds: string[],
  edges: GraphEdge[],
): string[] {
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  const nodeSet = new Set(nodeIds);

  for (const id of nodeIds) {
    inDegree.set(id, 0);
    adjacency.set(id, []);
  }

  for (const edge of edges) {
    if (!nodeSet.has(edge.from) || !nodeSet.has(edge.to)) continue;
    adjacency.get(edge.from)!.push(edge.to);
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    const node = queue.shift()!;
    sorted.push(node);
    for (const neighbor of adjacency.get(node) ?? []) {
      const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }

  // Append any remaining nodes (cycles) at the end
  for (const id of nodeIds) {
    if (!sorted.includes(id)) sorted.push(id);
  }

  return sorted;
}

/**
 * Assign each node to a layer (column) based on longest path from a source.
 * This produces a Sugiyama-style layered layout.
 */
function assignLayers(
  sortedIds: string[],
  edges: GraphEdge[],
  nodeSet: Set<string>,
): Map<string, number> {
  const incomingEdges = new Map<string, string[]>();
  for (const id of sortedIds) {
    incomingEdges.set(id, []);
  }
  for (const edge of edges) {
    if (!nodeSet.has(edge.from) || !nodeSet.has(edge.to)) continue;
    incomingEdges.get(edge.to)?.push(edge.from);
  }

  const layer = new Map<string, number>();
  for (const id of sortedIds) {
    const deps = incomingEdges.get(id) ?? [];
    if (deps.length === 0) {
      layer.set(id, 0);
    } else {
      const maxParentLayer = Math.max(
        ...deps.map((d) => layer.get(d) ?? 0),
      );
      layer.set(id, maxParentLayer + 1);
    }
  }

  return layer;
}

/**
 * Compute a full graph layout from raw ticket data.
 *
 * @param tickets Array of objects with id, title, stage, and dependsOn fields
 * @returns Positioned nodes and edges ready for SVG rendering
 */
export function computeLayout(
  tickets: Array<{
    id: string;
    title: string;
    stage: string;
    dependsOn: string[];
  }>,
): GraphLayout {
  if (tickets.length === 0) {
    return { nodes: [], edges: [], width: 0, height: 0 };
  }

  const ticketMap = new Map(tickets.map((t) => [t.id, t]));
  const nodeIds = tickets.map((t) => t.id);
  const nodeSet = new Set(nodeIds);

  // Build edges: from dependency → to dependent
  const edges: GraphEdge[] = [];
  for (const ticket of tickets) {
    for (const dep of ticket.dependsOn) {
      if (nodeSet.has(dep)) {
        edges.push({ from: dep, to: ticket.id });
      }
    }
  }

  const sorted = topologicalSort(nodeIds, edges);
  const layers = assignLayers(sorted, edges, nodeSet);

  // Group nodes by layer
  const layerGroups = new Map<number, string[]>();
  for (const [id, layer] of layers) {
    if (!layerGroups.has(layer)) layerGroups.set(layer, []);
    layerGroups.get(layer)!.push(id);
  }

  const maxLayer = Math.max(...layers.values(), 0);

  // Position nodes: layers go left-to-right, nodes within a layer top-to-bottom
  const nodes: GraphNode[] = [];
  for (let col = 0; col <= maxLayer; col++) {
    const group = layerGroups.get(col) ?? [];
    for (let row = 0; row < group.length; row++) {
      const id = group[row];
      const ticket = ticketMap.get(id)!;
      nodes.push({
        id: ticket.id,
        title: ticket.title,
        stage: ticket.stage,
        dependsOn: ticket.dependsOn,
        x: PADDING + col * (NODE_WIDTH + HORIZONTAL_GAP),
        y: PADDING + row * (NODE_HEIGHT + VERTICAL_GAP),
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      });
    }
  }

  // Compute canvas bounds
  const maxX = Math.max(...nodes.map((n) => n.x + n.width), 0) + PADDING;
  const maxRowCounts = Math.max(
    ...Array.from(layerGroups.values()).map((g) => g.length),
    1,
  );
  const maxY =
    PADDING + maxRowCounts * (NODE_HEIGHT + VERTICAL_GAP) - VERTICAL_GAP + PADDING;

  return {
    nodes,
    edges,
    width: Math.max(maxX, 400),
    height: Math.max(maxY, 300),
  };
}
