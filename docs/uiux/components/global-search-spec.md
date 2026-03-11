---
title: Global Search — Component Specification
ticket: FORGEOS-FE007
type: component-spec
author: UIDesigner
date: 2026-03-11T00:00:00Z
status: APPROVED
references: FORGEOS-UID003
diataxis: reference
---

# Global Search — Component Specification

> **Ticket:** FORGEOS-FE007 | **Author:** UIDesigner | **Date:** 2026-03-11
> **Status:** APPROVED | **Design Reference:** FORGEOS-UID003

---

## 1. Component Inventory

| Component | File | Purpose |
|-----------|------|---------|
| `SearchBar` | `dashboard/src/components/search/SearchBar.tsx` | Top-bar search with combobox, type-ahead, filter chips, recent searches |
| `SearchResults` | `dashboard/src/components/search/SearchResults.tsx` | Full results list with match highlighting and skeleton loading |
| `SearchPage` | `dashboard/src/app/search/page.tsx` | Full search results page with URL-synced filters |

---

## 2. SearchBar

### Description
Global search input integrated into the TopBar. Provides type-ahead suggestions after 2+ characters with 300ms debounced API calls. Supports keyboard shortcut (Cmd/Ctrl+K) to focus from anywhere.

### Props (Self-contained)
The component manages its own state internally. No props required.

### Type Definitions

```typescript
interface SearchFilters {
  stages?: TicketStage[];
  priorities?: TicketPriority[];
  types?: TicketType[];
}

interface SearchResult {
  ticketId: string;
  title: string;
  stage: TicketStage;
  priority: TicketPriority;
  type: TicketType;
  matchField: 'id' | 'title';
  matchRanges: Array<{ start: number; end: number }>;
}
```

### States

| State | Description | Visual |
|-------|-------------|--------|
| Default | Empty input with placeholder | Search icon, "Search tickets... (⌘K)" |
| Focused | Input receives focus | Primary border ring, dropdown opens |
| Typing | User entering query | Text appears, debounce timer starts |
| Loading | Fetching results | Spinner icon in input |
| Results | Matches found | Dropdown with up to 10 results |
| No Results | No matches | Empty state with helpful message |
| Recent | No query, dropdown open | List of last 5 recent searches |

### Keyboard Navigation

| Key | Action |
|-----|--------|
| `Ctrl+K` / `Cmd+K` | Focus search from anywhere |
| `Escape` | Close dropdown, blur input |
| `Arrow Down` | Highlight next result |
| `Arrow Up` | Highlight previous result |
| `Enter` | Select highlighted result or submit |

### Filter Chips
Toggleable chips for Stage, Priority, and Type displayed in a collapsible panel below the input. Active chips are highlighted with primary color.

### Recent Searches
- Stored in `localStorage` under key `forgeos-recent-searches`
- Maximum 5 entries, FIFO eviction
- Each entry removable via X button
- Displayed when input focused with no query

### Accessibility

| Aspect | Implementation |
|--------|----------------|
| ARIA Role | `role="combobox"` with `aria-expanded`, `aria-controls`, `aria-activedescendant` |
| Listbox | `role="listbox"` on results dropdown |
| Options | `role="option"` with `aria-selected` on each result |
| Label | `aria-label="Search tickets by ID or title"` |
| Live Region | `aria-live="polite"` announces result count |
| Loading | `aria-busy="true"` during fetch |

---

## 3. SearchResults

### Description
Displays a list of matching tickets as card components with highlighted matching terms. Shows loading skeletons while fetching and an empty state with guidance when no results.

### Props

| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `tickets` | `Ticket[]` | yes | — | Array of matching tickets |
| `query` | `string` | yes | — | Current search query for highlighting |
| `isLoading` | `boolean` | yes | — | Show skeleton state |
| `totalCount` | `number` | yes | — | Total result count |

### Match Highlighting
- Search terms highlighted with `bg-warning/30` background
- Applied to ticket ID, title, and description fields
- Case-insensitive matching

### Result Card Layout
Each result card displays:
- Ticket ID (mono font, primary color)
- Priority badge
- Stage label
- Title
- Description excerpt (2-line clamp)
- Type, claimed_by, file count metadata

### States

| State | Visual |
|-------|--------|
| Loading | 5 skeleton cards with pulse animation |
| Empty (with query) | Search icon + "No tickets found" message |
| Empty (no query) | Search icon + "Search for tickets" invitation |
| Results | Card list with result count header |

---

## 4. SearchPage

### Description
Full-page search experience at `/search`. URL parameters synchronize filters bidirectionally. Wraps SearchResults with a full search bar and persistent filter chips.

### URL Parameters

| Param | Type | Description |
|-------|------|-------------|
| `q` | string | Search query text |
| `stage` | CSV string | Comma-separated stage filters |
| `priority` | CSV string | Comma-separated priority filters |
| `type` | CSV string | Comma-separated type filters |

### Features
- Deep-linkable search results via URL params
- Automatic search on mount from URL params
- Filter changes update URL without scroll reset
- Mobile back arrow for navigation
- Suspense boundary for SSR compatibility

---

## 5. Design Token References

All components use existing design tokens from `docs/uiux/design-tokens.json`:
- Colors: `primary`, `surface`, `border`, `muted`, `foreground`, `warning`, `error`, `info`, `success`
- Search-specific: `search.highlightBg` → implemented as `bg-warning/30`
- Layout: `search.debounceMs` = 300, `search.maxTypeahead` = 10

---

## 6. Responsive Behavior

| Breakpoint | SearchBar | SearchPage |
|------------|-----------|------------|
| Mobile (<640px) | Full width, compact chips | Full width, stacked cards, back arrow visible |
| Tablet (640–1024px) | max-w-md, scrollable chips | max-w-4xl, cards with metadata row |
| Desktop (>1024px) | max-w-lg, all chips visible | max-w-4xl, full card layout |

---

## 7. Acceptance Criteria Mapping

| AC# | Criterion | Component | Status |
|-----|-----------|-----------|--------|
| 1 | Cmd/Ctrl+K keyboard shortcut | SearchBar | ✅ |
| 2 | Type-ahead after 2+ chars with 300ms debounce | SearchBar | ✅ |
| 3 | Filter chips for stage, type, priority | SearchBar + SearchPage | ✅ |
| 4 | Results displayed as ticket cards | SearchResults | ✅ |
| 5 | Matching terms highlighted | SearchResults + SearchBar | ✅ |
| 6 | Recent searches in localStorage (last 5) | SearchBar | ✅ |
| 7 | Empty state with helpful placeholder | SearchBar + SearchResults | ✅ |
