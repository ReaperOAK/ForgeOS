'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useRouter } from 'next/navigation';
import type { Ticket } from '@/lib/api';
import { computeLayout, type GraphLayout, type GraphNode } from '@/lib/graph/layout';
import { GraphControls } from './GraphControls';

/** Stage → color matching the design-tokens.json dark theme stage palette */
const STAGE_COLORS: Record<string, string> = {
  READY: '#06B6D4',
  RESEARCH: '#A855F7',
  ARCHITECT: '#8B5CF6',
  PRODUCT_MANAGER: '#8B5CF6',
  UI_DESIGN: '#14B8A6',
  BACKEND: '#3B82F6',
  FRONTEND: '#14B8A6',
  QA: '#F97316',
  SECURITY: '#EF4444',
  CI: '#EAB308',
  DOCUMENTATION: '#64748B',
  VALIDATOR: '#16A34A',
  DONE: '#22C55E',
  ESCALATED: '#DC2626',
};

const MIN_SCALE = 0.2;
const MAX_SCALE = 3;
const ZOOM_STEP = 0.15;

/** Props for {@link DependencyGraph}. */
interface DependencyGraphProps {
  /** Complete list of tickets to render as a directed acyclic graph. */
  tickets: Ticket[];
}

/**
 * Truncate a title to fit inside a graph node.
 *
 * @param text  - Full title text.
 * @param maxLen - Maximum character length before truncation (default 18).
 * @returns The original text or a truncated version ending with "…".
 */
function abbreviate(text: string, maxLen = 18): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + '…';
}

/**
 * Interactive SVG dependency graph with zoom, pan, and touch support.
 *
 * Computes a Sugiyama-style layered layout via {@link computeLayout}, then
 * renders nodes (coloured by SDLC stage) and curved Bézier edges.  Clicking
 * a node navigates to the ticket detail page.  Supports mouse-wheel zoom,
 * click-drag pan, and two-finger pinch-zoom on touch devices.
 *
 * @see GraphControls — floating toolbar for zoom in/out/fit-to-view.
 */
export function DependencyGraph({ tickets }: DependencyGraphProps) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  const layout: GraphLayout = useMemo(() => {
    const data = tickets.map((t) => ({
      id: t.ticket_id,
      title: t.title,
      stage: t.stage,
      dependsOn: t.depends_on ?? [],
    }));
    return computeLayout(data);
  }, [tickets]);

  const nodeMap = useMemo(
    () => new Map(layout.nodes.map((n) => [n.id, n])),
    [layout.nodes],
  );

  // Zoom via mouse wheel
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
      setScale((s) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s + delta)));
    },
    [],
  );

  // Pan — mouse down
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      // Only pan if clicking on empty canvas (svg background)
      if ((e.target as Element).tagName === 'svg' || (e.target as Element).tagName === 'rect') {
        setIsPanning(true);
        setPanStart({ x: e.clientX - translate.x, y: e.clientY - translate.y });
      }
    },
    [translate],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isPanning) return;
      setTranslate({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y,
      });
    },
    [isPanning, panStart],
  );

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
  }, []);

  // Touch pan + pinch zoom
  const lastTouches = useRef<{ x: number; y: number; dist: number } | null>(null);

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length === 1) {
        lastTouches.current = {
          x: e.touches[0].clientX - translate.x,
          y: e.touches[0].clientY - translate.y,
          dist: 0,
        };
      } else if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        lastTouches.current = {
          x: translate.x,
          y: translate.y,
          dist: Math.hypot(dx, dy),
        };
      }
    },
    [translate],
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!lastTouches.current) return;
      if (e.touches.length === 1) {
        setTranslate({
          x: e.touches[0].clientX - lastTouches.current.x,
          y: e.touches[0].clientY - lastTouches.current.y,
        });
      } else if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const newDist = Math.hypot(dx, dy);
        const ratio = newDist / (lastTouches.current.dist || 1);
        setScale((s) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s * ratio)));
        lastTouches.current.dist = newDist;
      }
    },
    [],
  );

  const handleTouchEnd = useCallback(() => {
    lastTouches.current = null;
  }, []);

  // Fit to view
  const fitToView = useCallback(() => {
    if (!containerRef.current || layout.nodes.length === 0) return;
    const containerRect = containerRef.current.getBoundingClientRect();
    const scaleX = containerRect.width / layout.width;
    const scaleY = containerRect.height / layout.height;
    const newScale = Math.min(scaleX, scaleY, 1) * 0.9;
    const newX = (containerRect.width - layout.width * newScale) / 2;
    const newY = (containerRect.height - layout.height * newScale) / 2;
    setScale(newScale);
    setTranslate({ x: newX, y: newY });
  }, [layout]);

  // Fit to view on initial render
  useEffect(() => {
    fitToView();
  }, [fitToView]);

  const zoomIn = useCallback(() => {
    setScale((s) => Math.min(MAX_SCALE, s + ZOOM_STEP));
  }, []);

  const zoomOut = useCallback(() => {
    setScale((s) => Math.max(MIN_SCALE, s - ZOOM_STEP));
  }, []);

  const handleNodeClick = useCallback(
    (ticketId: string) => {
      router.push(`/tickets/${encodeURIComponent(ticketId)}`);
    },
    [router],
  );

  /**
   * Compute a cubic-Bézier SVG path string for a dependency edge.
   *
   * @param fromNode - Source (upstream) graph node.
   * @param toNode   - Target (downstream) graph node.
   * @returns An SVG `d` attribute string for a `<path>` element.
   */
  function edgePath(fromNode: GraphNode, toNode: GraphNode): string {
    const x1 = fromNode.x + fromNode.width;
    const y1 = fromNode.y + fromNode.height / 2;
    const x2 = toNode.x;
    const y2 = toNode.y + toNode.height / 2;
    const midX = (x1 + x2) / 2;
    return `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
  }

  if (layout.nodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-96 text-muted">
        No tickets to display in the dependency graph.
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative w-full h-[calc(100vh-10rem)] bg-background border border-border rounded-lg overflow-hidden select-none"
      style={{ touchAction: 'none' }}
    >
      <svg
        ref={svgRef}
        className="w-full h-full"
        style={{ cursor: isPanning ? 'grabbing' : 'grab' }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        role="img"
        aria-label="Ticket dependency graph"
      >
        <defs>
          <marker
            id="arrowhead"
            markerWidth="8"
            markerHeight="6"
            refX="8"
            refY="3"
            orient="auto"
          >
            <polygon
              points="0 0, 8 3, 0 6"
              fill="var(--color-text-muted, #94a3b8)"
            />
          </marker>
        </defs>

        {/* Pan/zoom transform group */}
        <g
          transform={`translate(${translate.x}, ${translate.y}) scale(${scale})`}
        >
          {/* Background rect for pan target */}
          <rect
            x={-5000}
            y={-5000}
            width={10000}
            height={10000}
            fill="transparent"
          />

          {/* Edges */}
          {layout.edges.map((edge) => {
            const fromNode = nodeMap.get(edge.from);
            const toNode = nodeMap.get(edge.to);
            if (!fromNode || !toNode) return null;
            const isHighlighted =
              hoveredNode === edge.from || hoveredNode === edge.to;
            return (
              <path
                key={`${edge.from}-${edge.to}`}
                d={edgePath(fromNode, toNode)}
                fill="none"
                stroke={
                  isHighlighted
                    ? 'var(--color-primary, #06b6d4)'
                    : 'var(--color-text-muted, #94a3b8)'
                }
                strokeWidth={isHighlighted ? 2 : 1.5}
                strokeOpacity={isHighlighted ? 1 : 0.5}
                markerEnd="url(#arrowhead)"
                className="transition-all duration-fast"
              />
            );
          })}

          {/* Nodes */}
          {layout.nodes.map((node) => {
            const stageColor = STAGE_COLORS[node.stage] ?? '#64748B';
            const isHovered = hoveredNode === node.id;
            return (
              <g
                key={node.id}
                transform={`translate(${node.x}, ${node.y})`}
                onClick={() => handleNodeClick(node.id)}
                onMouseEnter={() => setHoveredNode(node.id)}
                onMouseLeave={() => setHoveredNode(null)}
                className="cursor-pointer"
                role="button"
                tabIndex={0}
                aria-label={`${node.id}: ${node.title} (${node.stage})`}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleNodeClick(node.id);
                  }
                }}
              >
                {/* Node background */}
                <rect
                  width={node.width}
                  height={node.height}
                  rx={8}
                  ry={8}
                  fill="var(--color-surface, #1e293b)"
                  stroke={isHovered ? 'var(--color-primary, #06b6d4)' : stageColor}
                  strokeWidth={isHovered ? 2.5 : 2}
                  className="transition-all duration-fast"
                />

                {/* Stage color indicator bar */}
                <rect
                  x={0}
                  y={0}
                  width={4}
                  height={node.height}
                  rx={2}
                  fill={stageColor}
                />

                {/* Ticket ID */}
                <text
                  x={14}
                  y={20}
                  fontSize={11}
                  fontWeight={600}
                  fontFamily="'JetBrains Mono', monospace"
                  fill={stageColor}
                >
                  {node.id}
                </text>

                {/* Abbreviated title */}
                <text
                  x={14}
                  y={40}
                  fontSize={11}
                  fill="var(--color-text, #f8fafc)"
                >
                  {abbreviate(node.title)}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      <GraphControls
        scale={scale}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onFitToView={fitToView}
      />
    </div>
  );
}
