---
title: Health Panel Component Specification
ticket: FORGEOS-UID005
type: component-spec
author: UIDesigner
date: 2026-03-10T02:00:00Z
status: APPROVED
parent_mockup: docs/uiux/mockups/FORGEOS-UID005.md
---

# Health Panel — Component Specification

> **Ticket:** FORGEOS-UID005 | **Agent:** UIDesigner | **Date:** 2026-03-10

---

## 1. Component Tree

```
SystemHealthPanel
├── HealthStatusBanner (mobile only)
│   └── StatusIndicator (×4: DB, MCP, WH, Alerts)
├── HealthPanelGrid (2×2 desktop, 1-col mobile)
│   ├── DatabaseHealthPanel
│   │   ├── PanelHeader ("Database", StatusIndicator)
│   │   ├── ConnectionPoolGauge
│   │   ├── MetricCardPair
│   │   │   ├── MetricCard (P50 Latency)
│   │   │   └── MetricCard (P99 Latency)
│   │   └── SlowQueriesTable (collapsible on mobile)
│   │       └── SlowQueryRow (×N)
│   ├── McpServerPanel
│   │   ├── PanelHeader ("MCP Server", StatusIndicator)
│   │   ├── UptimeDisplay
│   │   ├── MetricCard (Connected Agents)
│   │   ├── MetricCard (Requests/min + Sparkline)
│   │   └── TrendIndicator
│   ├── WebhookPanel
│   │   ├── PanelHeader ("Webhook Delivery", StatusIndicator)
│   │   ├── SuccessRateDonut
│   │   ├── MetricCard (Pending Queue)
│   │   ├── MetricCard (Failed Deliveries)
│   │   └── RetryButton
│   └── AlertsPanel
│       ├── PanelHeader ("Alerts", CountBadge)
│       ├── AlertList (scrollable)
│       │   └── AlertItem (×N)
│       └── EmptyState
```

---

## 2. PanelHeader

```typescript
interface PanelHeaderProps {
  title: string;
  statusIndicator?: StatusIndicatorProps;
  badge?: { count: number; color: string };
  collapsible?: boolean;        // mobile only
  collapsed?: boolean;
  onToggle?: () => void;
}
```

### Styling

| Property | Value |
|----------|-------|
| Height | 48px |
| Padding | `spacing.md` (16px) horizontal |
| Typography | `fontSize.xl` (20px), `fontWeight.semibold` |
| Border-bottom | 1px `borderSubtle` |
| Chevron (mobile) | 16px, `textMuted`, rotates 90° on expand |

### States

| State | Appearance |
|-------|-----------|
| Default | Title + status dot visible |
| Collapsed (mobile) | Chevron pointing right, content hidden |
| Expanded (mobile) | Chevron pointing down, content visible |

---

## 3. HealthPanelGrid

```typescript
interface HealthPanelGridProps {
  children: React.ReactNode;    // 4 panels
  loading?: boolean;
}
```

### Layout

| Breakpoint | Columns | Gap | Panel Min-Width |
|-----------|---------|-----|-----------------|
| Desktop (≥1024px) | 2 | 24px | 400px |
| Tablet (768–1023px) | 2 | 16px | 320px |
| Mobile (<768px) | 1 | 16px | 100% |

### CSS Grid

```css
.health-panel-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: var(--spacing-lg);
}

@media (max-width: 767px) {
  .health-panel-grid {
    grid-template-columns: 1fr;
    gap: var(--spacing-md);
  }
}
```

---

## 4. HealthStatusBanner (Mobile Only)

Quick-access horizontal strip at top of health view on mobile.

```typescript
interface HealthStatusBannerProps {
  panels: Array<{
    id: string;
    label: string;
    status: 'healthy' | 'degraded' | 'critical' | 'unknown';
    badgeCount?: number;
  }>;
  onPanelTap?: (id: string) => void;  // scroll to panel
}
```

### Styling

| Property | Value |
|----------|-------|
| Height | 48px |
| Background | `surface` |
| Border-bottom | 1px `border` |
| Item spacing | `spacing.md` between items |
| Status dot | 6px, centered above label |
| Label | `fontSize.xs`, `textMuted` |

### Visibility

| Breakpoint | Visible |
|-----------|---------|
| Desktop | Hidden |
| Tablet | Hidden |
| Mobile | Visible, sticky below top bar |

---

## 5. SlowQueriesTable

```typescript
interface SlowQueriesTableProps {
  queries: Array<{
    query: string;       // truncated SQL
    duration: number;    // milliseconds
    timestamp: string;   // ISO8601
  }>;
  maxRows?: number;      // default: 3
}
```

### Table Columns

| Column | Width | Font | Alignment |
|--------|-------|------|-----------|
| Query | flex | `fontFamily.mono`, `fontSize.xs` | Left |
| Duration | 80px | `fontFamily.mono`, `fontSize.xs` | Right |
| Time | 80px | `fontFamily.sans`, `fontSize.xs` | Right |

### Styling

| Property | Value |
|----------|-------|
| Row height | 32px |
| Row background | alternating `surface` / `surfaceAlt` |
| Query truncation | `text-overflow: ellipsis`, `max-width: 200px` |
| Duration color | `warning` if >100ms, `error` if >500ms, `text` otherwise |

---

## 6. UptimeDisplay

```typescript
interface UptimeDisplayProps {
  seconds: number;       // total uptime in seconds
  format?: 'long' | 'short';  // "14d 3h 22m" vs "14d"
}
```

### Styling

| Property | Value |
|----------|-------|
| Font | `fontFamily.mono`, `fontSize.2xl`, `fontWeight.bold` |
| Color | `text` |
| Label | "Uptime" in `textMuted`, `fontSize.sm`, above value |

---

## 7. TrendIndicator

```typescript
interface TrendIndicatorProps {
  direction: 'up' | 'down' | 'flat';
  value: string;              // "+12 /min"
  semantics: 'positive' | 'negative' | 'neutral';
}
```

### Color Mapping

| Direction + Semantics | Color | Icon |
|----------------------|-------|------|
| Up + Positive | `success` | ↑ |
| Up + Negative | `error` | ↑ |
| Down + Positive | `success` | ↓ |
| Down + Negative | `error` | ↓ |
| Flat + Neutral | `textMuted` | → |

### Styling

| Property | Value |
|----------|-------|
| Font | `fontFamily.mono`, `fontSize.xs` |
| Arrow | 12px SVG icon |
| Layout | Inline, arrow + value |

---

## 8. RetryButton

```typescript
interface RetryButtonProps {
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
}
```

### States

| State | Appearance |
|-------|-----------|
| Default | Ghost button, `border` outline, "Retry Failed" text in `textMuted` |
| Hover | `borderSubtle` → `border`, text → `text` |
| Loading | Spinner icon replaces text, disabled |
| Disabled | Opacity 0.5, cursor not-allowed |

### Styling

| Property | Value |
|----------|-------|
| Height | 32px |
| Padding | `spacing.sm` horizontal |
| Border | 1px `border` |
| Border-radius | `borderRadius.md` (6px) |
| Font | `fontSize.xs`, `fontWeight.medium` |

---

## 9. CountBadge

```typescript
interface CountBadgeProps {
  count: number;
  color?: string;        // default: error
  max?: number;          // display "9+" if count > max
}
```

### Styling

| Property | Value |
|----------|-------|
| Size | min-width 20px, height 20px |
| Background | `error` (red) or prop-specified |
| Text | `fontSize.xs`, `fontWeight.bold`, white |
| Border-radius | `borderRadius.full` |
| Position | inline-end of header text |

---

## 10. Design Token Additions

The following tokens extend `docs/uiux/design-tokens.json` for the health dashboard:

```json
{
  "health": {
    "gauge": {
      "trackColor": { "dark": "#334155", "light": "#E2E8F0", "usage": "Gauge background arc" },
      "strokeWidth": { "value": "12px", "usage": "Gauge arc stroke width" }
    },
    "sparkline": {
      "defaultColor": { "dark": "#06B6D4", "light": "#2563EB", "usage": "Default sparkline color" },
      "areaOpacity": { "value": "0.1", "usage": "Fill area below sparkline" },
      "height": { "value": "40px", "usage": "Default sparkline height" }
    },
    "alert": {
      "itemMinHeight": { "desktop": "48px", "mobile": "56px", "usage": "Alert item minimum height" },
      "swipeDismissThreshold": { "value": "100px", "usage": "Swipe distance to trigger dismiss" }
    },
    "donut": {
      "strokeWidth": { "value": "10px", "usage": "Donut ring stroke width" },
      "arcDegrees": { "value": "270", "usage": "Donut arc sweep angle" }
    }
  }
}
```

These tokens should be merged into the existing `design-tokens.json` by the Frontend Engineer.

---

## 11. Keyboard Navigation Order

```
Tab Order (within System Health Panel):
1. Database Panel Header (if collapsible)
2. Connection Pool Gauge
3. P50 Metric Card
4. P99 Metric Card
5. Slow Queries table rows
6. MCP Server Panel Header
7. Connected Agents Metric Card
8. Requests/min Metric Card
9. Webhook Panel Header
10. Success Rate Donut
11. Pending Queue Metric Card
12. Failed Deliveries Metric Card
13. Retry Button
14. Alerts Panel Header
15. Alert Item 1 → Dismiss
16. Alert Item 2 → Dismiss
17. Alert Item 3 → Dismiss
...
```

**Keyboard Shortcuts (within health view):**
- `1`–`4`: Focus respective panel
- `Escape`: Collapse all panels (mobile)
- `D`: Dismiss focused alert
