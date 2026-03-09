---
title: Dependency Graph Component Specification
ticket: FORGEOS-UID003
type: component-spec
author: UIDesigner
date: 2026-03-10T00:00:00Z
status: APPROVED
---

# Dependency Graph — Component Specification

> **Ticket:** FORGEOS-UID003 | **Author:** UIDesigner | **Date:** 2026-03-10

---

## 1. DependencyGraph (Container)

**Description:** Root container for the interactive DAG visualization. Manages D3.js force simulation, zoom/pan state, node selection, and edge rendering. Occupies the full main content area below the graph controls toolbar.

### Props

| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `tickets` | `TicketNode[]` | yes | — | Array of ticket data for nodes |
| `dependencies` | `DependencyEdge[]` | yes | — | Array of dependency relationships |
| `selectedNodeId` | `string \| null` | no | `null` | Currently selected node ID |
| `onNodeSelect` | `(ticketId: string \| null) => void` | no | — | Node selection callback |
| `onNodeClick` | `(ticketId: string) => void` | no | — | Navigate to ticket detail |
| `filters` | `GraphFilterState` | no | `{}` | Active graph filters |
| `layoutMode` | `'force' \| 'hierarchical' \| 'radial'` | no | `'force'` | Layout algorithm |
| `zoomLevel` | `number` | no | `1.0` | Current zoom level |
| `onZoomChange` | `(level: number) => void` | no | — | Zoom change callback |
| `showMinimap` | `boolean` | no | `true` | Display minimap navigator |
| `highlightCriticalPath` | `boolean` | no | `true` | Highlight longest blocking chain |

### TypeScript Types

```typescript
interface TicketNode {
  ticketId: string;
  title: string;
  stage: StageName;
  priority: 'critical' | 'high' | 'medium' | 'low';
  type: TicketType;
  assignee: string | null;
  dependentCount: number;
  blockedByCount: number;
}

interface DependencyEdgeData {
  sourceId: string;
  targetId: string;
  isResolved: boolean;
}

interface GraphFilterState {
  stages?: StageName[];
  priorities?: ('critical' | 'high' | 'medium' | 'low')[];
  types?: TicketType[];
  agents?: string[];
}

type StageName = 'READY' | 'ARCHITECT' | 'RESEARCH' | 'BACKEND' | 'FRONTEND'
  | 'QA' | 'SECURITY' | 'CI' | 'DOCS' | 'VALIDATION' | 'DONE' | 'ESCALATED';

type TicketType = 'backend' | 'frontend' | 'fullstack' | 'infra'
  | 'security' | 'docs' | 'research' | 'architecture';
```

### States

| State | Description | Visual |
|-------|-------------|--------|
| Loading | Fetching ticket/dependency data | Centered spinner with "Loading graph..." |
| Empty | No tickets match filters | Empty state: "No tickets to display. Adjust filters." |
| Rendered | Graph fully computed | Nodes + edges visible, force simulation running |
| Settled | Force simulation complete | Static layout, nodes draggable |
| Error | Data fetch failure | Error message with retry button |
| LargeGraph | > 500 tickets | Warning banner: "Large graph — consider filtering" |
| SubGraph | > 1000 tickets | Only filtered subset rendered, warning badge |

### D3 Force Simulation Parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| `forceLink.distance` | `100` | Base link distance (scales with depth) |
| `forceManyBody.strength` | `-300` | Node repulsion strength |
| `forceCollide.radius` | `30` | Minimum node spacing in px |
| `forceCenter` | viewport center | Centering force |
| `alpha` | `1.0` initial, decays to `0.001` | Simulation energy |
| `alphaDecay` | `0.0228` (default) | Energy decay rate |
| `velocityDecay` | `0.4` | Friction coefficient |

### Interactions

| Interaction | Input | Behavior |
|------------|-------|----------|
| Zoom | Scroll wheel / pinch | Zoom range: 25%–400%, centered on cursor |
| Pan | Click+drag background | Move viewport, updates minimap |
| Select node | Click node | Shows popover, highlights dependency chain |
| Deselect | Click background | Clears selection and highlights |
| Reset | Double-click background | Reset zoom to 100%, center graph, clear highlights |
| Drag node | Click+drag node | Reposition node, simulation relaxes around it |
| Highlight path | Select node | All upstream/downstream deps highlighted, others fade to 10% |

### Keyboard Navigation

| Key | Action |
|-----|--------|
| `Tab` | Move focus to next node (tab order by ticket ID) |
| `Shift+Tab` | Move focus to previous node |
| `Enter` | Select focused node (show popover) |
| `Escape` | Deselect node, close popover |
| `Arrow keys` | Navigate to adjacent connected nodes |
| `+` / `=` | Zoom in |
| `-` | Zoom out |
| `0` | Reset zoom to 100% |
| `f` | Fit to view |

### Accessibility

| Aspect | Requirement |
|--------|-------------|
| ARIA Role | `role="tree"` on graph container with `aria-label="Ticket dependency graph"` |
| Nodes | `role="treeitem"` with `aria-selected`, `aria-level` (depth in DAG) |
| Live Region | `aria-live="polite"` announces selected node details |
| Reduced Motion | `prefers-reduced-motion: reduce` → disable force animation, render static layout |
| High Contrast | `prefers-contrast: more` → thicker borders (3px), no transparency |

### Responsive Behavior

| Breakpoint | Layout | Node Size | Controls |
|------------|--------|-----------|----------|
| Mobile (< 768px) | Full screen, pinch zoom | 120×60px | FAB: Fit to View, bottom sheet for details |
| Tablet (768–1023px) | Full main area | 140×70px | Compact toolbar, touch-friendly controls |
| Desktop (≥ 1024px) | Full main area | 160×80px | Full toolbar with all controls |

---

## 2. DependencyGraphNode

**Description:** Individual ticket node rendered as a rounded rectangle in the DAG.

### Visual Specification

```
┌─────────────────────────────┐
│ ┃  FORGEOS-BE-007           │   ← Ticket ID (monospace, primary color)
│ ┃  Database conn pool       │   ← Title (truncated, text color)
│ ┃  [BACKEND]                │   ← Stage badge (stage color pill)
└─────────────────────────────┘
  ↑ 3px priority border (left)
```

### Dimensions

| Property | Desktop | Tablet | Mobile |
|----------|---------|--------|--------|
| Width | 160px | 140px | 120px |
| Height | 80px | 70px | 60px |
| Border Radius | 8px | 8px | 6px |
| Priority Border | 3px left | 3px left | 3px left |
| Padding | 12px | 10px | 8px |

### Color Mapping

Node fill color is determined by the ticket's current SDLC stage:

| Stage | Dark Theme Fill | Light Theme Fill |
|-------|----------------|-----------------|
| READY | `#06B6D4` | `#0891B2` |
| ARCHITECT | `#8B5CF6` | `#7C3AED` |
| RESEARCH | `#A855F7` | `#9333EA` |
| BACKEND | `#3B82F6` | `#2563EB` |
| FRONTEND | `#14B8A6` | `#0D9488` |
| QA | `#F97316` | `#EA580C` |
| SECURITY | `#EF4444` | `#DC2626` |
| CI | `#EAB308` | `#CA8A04` |
| DOCS | `#64748B` | `#475569` |
| VALIDATION | `#16A34A` | `#15803D` |
| DONE | `#22C55E` | `#16A34A` |
| ESCALATED | `#DC2626` | `#B91C1C` |

Text within nodes uses `#FFFFFF` (white) for readability on all stage colors. Exception: CI stage nodes use `#0F172A` (dark text) for contrast on yellow background.

### Priority Left Border Colors

| Priority | Color |
|----------|-------|
| Critical | `#EF4444` |
| High | `#F97316` |
| Medium | `#3B82F6` |
| Low | `#6B7280` |

---

## 3. DependencyEdge

**Description:** SVG path connecting two nodes with a directional arrowhead.

### Visual Styles

| Style | Line | Width | Arrowhead | Use Case |
|-------|------|-------|-----------|----------|
| Resolved | Solid | 1.5px | Filled triangle (6px) | Dependency is DONE |
| Unresolved | Dashed (4px on, 4px off) | 1.5px | Hollow triangle (6px) | Dependency not yet DONE |
| Critical Path | Solid | 3px | Filled triangle (8px) | Part of longest blocking chain |
| Faded | Solid/Dashed (original) | 1px | Same as original, 10% opacity | Not on highlighted path |

### Edge Colors

| Context | Dark Theme | Light Theme |
|---------|-----------|-------------|
| Resolved | `#475569` | `#94A3B8` |
| Unresolved | `#64748B` | `#CBD5E1` |
| Critical Path | `#06B6D4` | `#2563EB` |

### Hover Tooltip

When the cursor hovers near an edge (within 8px), show a tooltip:
```
FOS-BE-001 → FOS-BE-007
Status: Resolved ✓
```

---

## 4. GraphControlsToolbar

**Description:** Fixed toolbar (48px height) between top bar and graph area.

### Layout

```
┌─────────────────────────────────────────────────────────────────────────┐
│ [−] ━━━━●━━━━ [+] 100%  │ [Fit] [Reset] │ Layout: [Force ▼] │ 🔍 [...] │
│                          │               │                   │ [Stage▼] [Priority▼] [Type▼] │
└─────────────────────────────────────────────────────────────────────────┘
```

### Controls

| Control | Type | Description |
|---------|------|-------------|
| Zoom slider | Range input | 25%–400%, step 5% |
| Zoom − / + | Buttons | Decrease/increase by 25% |
| Zoom label | Text | Shows current percentage |
| Fit to View | Button | Fit all visible nodes in viewport |
| Reset | Button | Reset zoom, pan, selection, highlights |
| Layout dropdown | Select | Force-directed / Hierarchical / Radial |
| Node search | Text input | Highlight nodes matching query |
| Filter chips | Chip group | Stage, Priority, Type |

---

## 5. MinimapNavigator

**Description:** Small overview panel in the bottom-right corner of the graph area.

### Visual Specification

```
┌──────────────────────┐
│ ┌────────┐           │  ← Full graph extent (semi-transparent background)
│ │ ██████ │           │  ← Viewport rectangle (primary color, 40% opacity)
│ └────────┘           │
│            ·  ·      │  ← Miniature nodes (dots)
│         ·     ·      │
└──────────────────────┘
```

### Dimensions

| Property | Value |
|----------|-------|
| Width | 200px |
| Height | 120px |
| Position | Bottom-right, 16px margin |
| Background | `rgba(15, 23, 42, 0.8)` (dark) / `rgba(241, 245, 249, 0.9)` (light) |
| Border | 1px `#334155` (dark) / 1px `#E2E8F0` (light) |
| Border Radius | 8px |
| Viewport Color | `rgba(6, 182, 212, 0.4)` |
| Node Dots | 4px circles, stage-colored |

### Interactions

| Interaction | Behavior |
|------------|----------|
| Click minimap | Jump viewport to clicked position |
| Drag viewport rect | Pan main graph in real-time |
| Collapse toggle | Click toggle button to hide/show |

---

## 6. NodeTooltip / Popover

**Description:** Contextual information panel for graph nodes.

### Hover Tooltip (appears after 200ms)

```
┌──────────────────────────┐
│ FORGEOS-BE-007            │  ← Ticket ID (monospace, primary)
│ Database connection pool  │  ← Full title
│ ⬤ BACKEND  ● Medium      │  ← Stage badge + Priority badge
└──────────────────────────┘
```

### Selected Popover (appears on click)

```
┌──────────────────────────────┐
│ FORGEOS-BE-007                │  ← Ticket ID (monospace, primary)
│ Database connection pool      │  ← Full title
│ ⬤ BACKEND     ● Medium       │  ← Stage + Priority badges
│ ─────────────────────────── │
│ Assigned to: Backend Engineer │
│ Blocks: 3 tickets            │  ← dependentCount
│ Blocked by: 1 ticket         │  ← blockedByCount
│ ─────────────────────────── │
│ [View Detail]  [Highlight ↗] │  ← Action buttons
└──────────────────────────────┘
```

### Dimensions

| Property | Hover Tooltip | Selected Popover |
|----------|--------------|-----------------|
| Width | auto (max 280px) | 300px |
| Padding | 8px 12px | 16px |
| Background | `surface` token | `surface` token |
| Border | 1px `border` token | 1px `border` token |
| Border Radius | 6px | 8px |
| Shadow | `md` token | `lg` token |
| Z-Index | `tooltip` (70) | `slideOver` (40) |

---

## 7. Mobile-Specific Components

### 7.1 GraphBottomSheet

**Description:** Bottom sheet panel on mobile that slides up from the bottom when a graph node is tapped.

#### Layout

```
┌───────────────────────────┐
│         ━━━━━             │  ← Drag handle (40×4px, centered)
│ FORGEOS-BE-007             │  ← Ticket ID (monospace, primary)
│ Database connection pool   │  ← Full title
│                            │
│ ⬤ BACKEND    ● Medium     │  ← Stage + Priority badges
│ Assigned to: Backend       │
│                            │
│ ↑ Blocks: 3 tickets       │
│ ↓ Blocked by: 1 ticket    │
│                            │
│ ┌──────────────────────┐  │
│ │   View Full Detail   │  │  ← Primary button, full width
│ └──────────────────────┘  │
└───────────────────────────┘
```

#### Interactions

| Interaction | Behavior |
|------------|----------|
| Swipe down | Dismiss bottom sheet |
| Tap outside | Dismiss bottom sheet |
| Tap "View Full Detail" | Navigate to ticket detail |
| Drag handle | Resize between half and full screen |

#### Dimensions

| Property | Value |
|----------|-------|
| Width | 100% |
| Height | Auto (content-driven), max 60vh |
| Border Radius | 16px (top-left and top-right only) |
| Drag Handle | 40×4px, centered, `#475569` color |
| Padding | 24px |
| Background | `surface` token |
| Z-Index | `slideOver` (40) |

### 7.2 FloatingActionButton (Fit to View)

| Property | Value |
|----------|-------|
| Size | 48×48px |
| Position | Bottom-right, 16px from edges (above bottom sheet if open) |
| Background | `primary` token |
| Icon | Expand/fit icon (white) |
| Shadow | `lg` token |
| Border Radius | `full` (circular) |
| Touch Target | 48×48px (meets 44px minimum) |

---

## 8. Token References

All tokens referenced in this spec are defined in [`docs/uiux/design-tokens.json`](../../uiux/design-tokens.json).

### Graph-Specific Token Extensions

```json
{
  "graph": {
    "nodeWidth": { "value": "160px", "usage": "Desktop DAG node width" },
    "nodeHeight": { "value": "80px", "usage": "Desktop DAG node height" },
    "nodeWidthMobile": { "value": "120px", "usage": "Mobile DAG node width" },
    "nodeHeightMobile": { "value": "60px", "usage": "Mobile DAG node height" },
    "edgeResolved": { "value": "#475569", "usage": "Resolved dependency edge color" },
    "edgeUnresolved": { "value": "#64748B", "usage": "Unresolved dependency edge color" },
    "edgeCriticalPath": { "value": "#06B6D4", "usage": "Critical path edge highlight (dark)" },
    "nodeGlow": { "value": "rgba(6, 182, 212, 0.3)", "usage": "Selected node glow (dark)" },
    "minimapBg": { "value": "rgba(15, 23, 42, 0.8)", "usage": "Minimap background (dark)" },
    "minimapViewport": { "value": "rgba(6, 182, 212, 0.4)", "usage": "Minimap viewport indicator" },
    "linkDistance": { "value": "100", "usage": "D3 force link distance base" },
    "chargeStrength": { "value": "-300", "usage": "D3 charge force repulsion" },
    "collisionRadius": { "value": "30", "usage": "Minimum node spacing in px" },
    "zoomMin": { "value": "0.25", "usage": "25% minimum zoom" },
    "zoomMax": { "value": "4.0", "usage": "400% maximum zoom" }
  }
}
```
