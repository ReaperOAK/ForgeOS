---
title: Search Bar & Search Results Component Specification
ticket: FORGEOS-UID003
type: component-spec
author: UIDesigner
date: 2026-03-10T00:00:00Z
status: APPROVED
---

# Search Bar & Search Results — Component Specification

> **Ticket:** FORGEOS-UID003 | **Author:** UIDesigner | **Date:** 2026-03-10

---

## 1. SearchBar

**Description:** Global search field in the top bar, allowing users to search across
all tickets by ID or title. Includes type-ahead dropdown with 300ms debounce and
filter chips for stage, type, and priority.

### Props

| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `value` | `string` | no | `''` | Current search query text |
| `onSearch` | `(query: string) => void` | yes | — | Fires after debounce on input change |
| `onClear` | `() => void` | no | — | Called when clear/X button pressed |
| `onResultSelect` | `(ticketId: string) => void` | no | — | Called when user selects a result |
| `results` | `SearchResult[]` | no | `[]` | Suggestions to display in dropdown |
| `filters` | `SearchFilters` | no | `{}` | Active filter state |
| `onFilterChange` | `(filters: SearchFilters) => void` | no | — | Filter updated |
| `isLoading` | `boolean` | no | `false` | Show spinner in input field |
| `placeholder` | `string` | no | `'Search tickets...'` | Placeholder text |
| `maxResults` | `number` | no | `10` | Maximum results in dropdown |
| `debounceMs` | `number` | no | `300` | Debounce delay in milliseconds |

### TypeScript Types

```typescript
interface SearchResult {
  ticketId: string;
  title: string;
  stage: StageName;
  priority: 'critical' | 'high' | 'medium' | 'low';
  type: TicketType;
  matchField: 'id' | 'title';
  matchRanges: Array<{ start: number; end: number }>;
}

interface SearchFilters {
  stages?: StageName[];
  priorities?: ('critical' | 'high' | 'medium' | 'low')[];
  types?: TicketType[];
}
```

### Visual Layout

#### Collapsed (Desktop — Top Bar)

```
┌──────────────────────────────────────────────────┐
│  🔍  Search tickets...                         × │
│  [Stage ▼]  [Priority ▼]  [Type ▼]              │
└──────────────────────────────────────────────────┘
```

#### Expanded with Results (Desktop)

```
┌──────────────────────────────────────────────────┐
│  🔍  FOS-BE                                    × │
│  [Stage ▼]  [Priority ▼]  [Type ▼]              │
├──────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────┐    │
│  │ ⬤ FOS-BE-001  Database migration         │    │
│  │   BACKEND • Medium • backend              │    │
│  ├──────────────────────────────────────────┤    │
│  │ ⬤ FOS-BE-007  Connection pooling         │    │
│  │   BACKEND • High • backend                │    │
│  ├──────────────────────────────────────────┤    │
│  │ ⬤ FOS-BE-012  API rate limiting          │    │
│  │   QA • Medium • backend                   │    │
│  └──────────────────────────────────────────┘    │
│                                                  │
│  Showing 3 of 12 results  [View all →]          │
└──────────────────────────────────────────────────┘
```

#### Mobile Search

```
┌──────────────────────────────┐
│  🔍  Search tickets...    × │  ← Fixed top, full width
│  [Stage] [Priority] [Type]  │  ← Scrollable chip row
├──────────────────────────────┤
│  ⬤ FOS-BE-001               │
│    Database migration        │
│    BACKEND • Medium          │
├──────────────────────────────┤
│  ⬤ FOS-BE-007               │
│    Connection pooling        │
│    BACKEND • High            │
└──────────────────────────────┘
```

### Dimensions

| Property | Desktop | Tablet | Mobile |
|----------|---------|--------|--------|
| Width | 360px (can expand to 480px focused) | 320px | 100% (−32px padding) |
| Height | 40px (input) | 40px | 44px (touch-friendly) |
| Dropdown Max Height | 400px | 360px | 60vh |
| Border Radius | 8px | 8px | 8px |
| Input Padding | 12px 40px (icon space) | 12px 40px | 12px 40px |

### Colors

| Element | Dark Theme | Light Theme |
|---------|-----------|-------------|
| Background | `#1E293B` (surface) | `#FFFFFF` (surface) |
| Border (default) | `#334155` | `#E2E8F0` |
| Border (focused) | `#06B6D4` (primary) | `#2563EB` (primary) |
| Text | `#E2E8F0` | `#1E293B` |
| Placeholder | `#64748B` | `#94A3B8` |
| Icon | `#94A3B8` (muted) | `#64748B` |
| Dropdown bg | `#1E293B` | `#FFFFFF` |
| Match highlight | `#06B6D4` text with `rgba(6, 182, 212, 0.15)` bg | `#2563EB` text with `rgba(37, 99, 235, 0.1)` bg |

### States

| State | Visual | Behavior |
|-------|--------|----------|
| Default | Empty input with placeholder, search icon | — |
| Focused | Primary border glow, cursor in field | Dropdown opens if text present |
| Typing | Text appears, spinner after debounce starts | 300ms debounce before search fires |
| Loading | Small spinner in right side of input | Results pending |
| Results | Dropdown appears below input | Top 10 results shown |
| No Results | Dropdown with "No matching tickets" | Icon + message |
| Error | Red border, error text below | "Search failed. Try again." |
| Disabled | 50% opacity, no interaction | Used during offline mode |

### Keyboard Navigation

| Key | Action |
|-----|--------|
| `Ctrl+K` / `Cmd+K` | Focus search bar from anywhere |
| `Escape` | Clear search and close dropdown |
| `Arrow Down` | Move highlight to next result |
| `Arrow Up` | Move highlight to previous result |
| `Enter` | Select highlighted result / submit search |
| `Tab` | Move focus to filter chips area |

### Accessibility

| Aspect | Implementation |
|--------|----------------|
| ARIA Role | `role="combobox"` with `aria-expanded`, `aria-controls`, `aria-activedescendant` |
| Listbox | `role="listbox"` on result dropdown |
| Options | `role="option"` on each result with `aria-selected` |
| Label | `aria-label="Search tickets by ID or title"` |
| Live Region | `aria-live="polite"` announces result count: "3 results found" |
| Status | `aria-busy="true"` during loading |

---

## 2. SearchResultCard

**Description:** Individual result item in the search dropdown or full search results view.

### Props

| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `result` | `SearchResult` | yes | — | Search result data |
| `isHighlighted` | `boolean` | no | `false` | Keyboard highlight state |
| `onClick` | `(ticketId: string) => void` | yes | — | Selection callback |

### Visual Layout

```
┌──────────────────────────────────────────────────┐
│ ⬤  FORGEOS-BE-007  Database connection pooling   │
│    ┌────────┐ ┌────────┐ ┌──────┐               │
│    │BACKEND │ │ High   │ │ backend│              │
│    └────────┘ └────────┘ └──────┘               │
└──────────────────────────────────────────────────┘
```

### Text Highlighting

Matching substring ranges are highlighted using the `matchRanges` array:
- **Dark theme:** Primary text color (`#06B6D4`) + subtle background (`rgba(6, 182, 212, 0.15)`)
- **Light theme:** Primary text color (`#2563EB`) + subtle background (`rgba(37, 99, 235, 0.1)`)
- Uses `<mark>` element for semantic correctness with custom styling

### Dimensions

| Property | Value |
|----------|-------|
| Padding | 10px 14px |
| Border Bottom | 1px `#1E293B` (dark) / 1px `#F1F5F9` (light) |
| Min Height | 56px |
| Stage Badge | 8×8px circle, stage-colored (same palette as graph nodes) |
| Title Font | 14px/1.5 Inter, `textPrimary` color |
| ID Font | 13px/1.5 JetBrains Mono, `primary` color |
| Meta Font | 12px/1.5 Inter, `textMuted` color |

### States

| State | Visual |
|-------|--------|
| Default | Normal background |
| Highlighted (keyboard) | Background: `rgba(6, 182, 212, 0.08)` (dark), `rgba(37, 99, 235, 0.06)` (light) |
| Hovered | Background: `rgba(6, 182, 212, 0.08)` (dark), `rgba(37, 99, 235, 0.06)` (light) |
| Pressed | Background: `rgba(6, 182, 212, 0.12)` (dark), `rgba(37, 99, 235, 0.1)` (light) |

---

## 3. FilterChip

**Description:** Compact interactive chip for filtering search results or graph nodes by
stage, priority, type, or agent.

### Props

| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `label` | `string` | yes | — | Chip display text (e.g., "BACKEND") |
| `category` | `'stage' \| 'priority' \| 'type' \| 'agent'` | yes | — | Filter category |
| `isActive` | `boolean` | no | `false` | Whether filter is currently applied |
| `onToggle` | `(category: string, label: string) => void` | yes | — | Toggle callback |
| `color` | `string` | no | — | Override color (e.g., stage color) |
| `count` | `number` | no | — | Count badge (filtered results count) |
| `variant` | `'default' \| 'dropdown'` | no | `'default'` | Dropdown variant opens a multi-select |

### Visual Layout

#### Default Chip

```
┌───────────────┐     ┌───────────────────┐
│  BACKEND  (3) │     │ ✓ BACKEND  (3)   │
└───────────────┘     └───────────────────┘
     Inactive              Active
```

#### Dropdown Chip

```
┌────────────────┐
│  Stage ▼       │  ← Click to open multi-select
└────────────────┘
        │
┌────────────────┐
│ ☐ READY        │
│ ☑ BACKEND      │
│ ☐ FRONTEND     │
│ ☐ QA           │
│ ...            │
│ ────────────── │
│ [Clear All]    │
└────────────────┘
```

### Dimensions

| Property | Value |
|----------|-------|
| Height | 28px (desktop) / 32px (mobile, 44px touch target with padding) |
| Padding | 4px 12px |
| Border Radius | 14px (pill shape) |
| Font | 12px/1.5 Inter, font-weight 500 |
| Gap between chips | 6px |
| Count Badge | 16px circle, font-size 10px, positioned inline after label text |

### Colors

| Element | Inactive (Dark) | Active (Dark) | Inactive (Light) | Active (Light) |
|---------|-----------------|---------------|-------------------|----------------|
| Background | `#334155` | `rgba(6, 182, 212, 0.2)` | `#E2E8F0` | `rgba(37, 99, 235, 0.12)` |
| Border | `#475569` | `#06B6D4` | `#CBD5E1` | `#2563EB` |
| Text | `#94A3B8` | `#06B6D4` | `#64748B` | `#2563EB` |
| Count Badge bg | `#475569` | `#06B6D4` | `#CBD5E1` | `#2563EB` |
| Count Badge text | `#E2E8F0` | `#FFFFFF` | `#1E293B` | `#FFFFFF` |

### States

| State | Visual |
|-------|--------|
| Inactive | Muted background, muted text |
| Active | Primary-tinted bg, primary border, primary text, optional ✓ icon |
| Hovered | Slightly brighter background |
| Focused | 2px solid focus ring (`primary` color) |
| Disabled | 50% opacity, no interaction |

### Accessibility

| Aspect | Implementation |
|--------|----------------|
| ARIA | `role="checkbox"` with `aria-checked` for toggle chips |
| ARIA | `role="button"` with `aria-haspopup="listbox"` for dropdown chips |
| Label | `aria-label="{category}: {label}"` (e.g., "Stage: BACKEND") |
| Keyboard | `Space` or `Enter` to toggle/open |
| Focus | Visible 2px solid ring on focus |
| Group | Chip containers use `role="group"` with `aria-label="Filter by {category}"` |

---

## 4. Full Search Results View

**Description:** When the user clicks "View all" or presses Enter in the search bar,
the dropdown transitions to a full results panel.

### Layout (Desktop)

```
┌──────────────────────────────────────────────────────────────┐
│  Results for "FOS-BE"                          12 results   │
│                                                              │
│  Sort: [Relevance ▼]  │  Filters: [Stage ▼] [Priority ▼]  │
│ ─────────────────────────────────────────────────────────── │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ ⬤ FORGEOS-BE-001  Database migration framework      │   │
│  │   BACKEND • Medium • backend                         │   │
│  ├──────────────────────────────────────────────────────┤   │
│  │ ⬤ FORGEOS-BE-007  Connection pooling setup           │   │
│  │   BACKEND • High • backend                           │   │
│  ├──────────────────────────────────────────────────────┤   │
│  │ ...                                                   │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ← 1  2  3 →                                                │
└──────────────────────────────────────────────────────────────┘
```

### Sort Options

| Option | Description |
|--------|-------------|
| Relevance | Default, based on match quality |
| Newest first | By creation date, descending |
| Priority (High→Low) | Critical → High → Medium → Low |
| Stage (Pipeline) | READY → ... → DONE |
| Alphabetical | By ticket ID, ascending |

### Pagination

| Property | Value |
|----------|-------|
| Items per page | 20 |
| Page controls | Previous / page numbers / Next |
| Current page | Highlighted with primary color |
| Keyboard | Arrow Left/Right to navigate pages |

---

## 5. Token References

All color tokens, spacing values, and typography scales reference the project-wide
design tokens at [`docs/uiux/design-tokens.json`](../../uiux/design-tokens.json).

### Search-Specific Token Extensions

```json
{
  "search": {
    "debounceMs": { "value": "300", "usage": "Type-ahead debounce delay" },
    "maxResults": { "value": "10", "usage": "Maximum inline dropdown results" },
    "dropdownMaxHeight": { "value": "400px", "usage": "Search dropdown max height (desktop)" },
    "inputHeight": { "value": "40px", "usage": "Search input height (desktop)" },
    "inputHeightMobile": { "value": "44px", "usage": "Search input height (mobile, touch-friendly)" },
    "chipHeight": { "value": "28px", "usage": "Filter chip height (desktop)" },
    "chipHeightMobile": { "value": "32px", "usage": "Filter chip height (mobile)" },
    "highlightBg": { "value": "rgba(6, 182, 212, 0.15)", "usage": "Match highlight background (dark)" },
    "highlightBgLight": { "value": "rgba(37, 99, 235, 0.1)", "usage": "Match highlight background (light)" }
  }
}
```
