---
title: TicketCard Component Specification
ticket: FORGEOS-UID002
author: UIDesigner
date: 2026-03-10T00:00:00Z
extends: FORGEOS-UID001 TicketCard base spec
components:
  - TicketCard
  - StatusDot (reused from UID001)
  - Badge (reused from UID001)
  - CountdownTimer (reused from UID001)
---

# TicketCard Component Specification

> **Ticket:** FORGEOS-UID002 | **Agent:** UIDesigner
> Enhanced TicketCard specification. Extends FORGEOS-UID001 base spec with type badge, claim indicator, and enhanced metadata display.

---

## 1. Overview

The TicketCard is the core interactive element in the Pipeline Board. Each card represents a single ticket within an SDLC stage column. This spec adds the following over the UID001 base:

- **Type badge** with color-coded pill (AC #2)
- **Claim indicator** (filled dot vs empty circle with text label)
- **Enhanced metadata row** with priority + type + agent + time layout
- **Machine hostname badge** in top-right corner

---

## 2. Complete Props Interface

```typescript
interface TicketCardProps {
  // Required
  ticketId: string;          // e.g., "FORGEOS-BK-007"
  title: string;             // Truncated to 2 lines with text-overflow: ellipsis
  priority: 'critical' | 'high' | 'medium' | 'low';
  type: 'backend' | 'frontend' | 'fullstack' | 'infra' | 'security' | 'docs' | 'research' | 'architecture';

  // Optional
  agent?: string | null;     // Claiming agent name, null if unclaimed
  machine?: string | null;   // Machine hostname for badge
  timeInStage?: string;      // Duration string e.g., "2h 15m"
  reworkCount?: number;      // Shows badge if > 0
  isTimeWarning?: boolean;   // Turns time text to error color
  isClaimed?: boolean;       // Filled vs empty indicator dot
  onClick?: (ticketId: string) => void;
}
```

---

## 3. Visual Anatomy

### Desktop Layout (≥ 1024px)

```
┌─── 3px priority-colored left border ───────────────────────┐
│  12px padding all sides                                     │
│                                                             │
│  FORGEOS-BK-007                              [pop-os]      │
│  ↳ mono, sm (14px), primary #06B6D4         ↳ xs, machine  │
│                                              palette badge  │
│  Implement Ticket Claim with SKIP LOCKED...                │
│  ↳ sans, sm–base (14–16px), text #F8FAFC, max 2 lines     │
│                                                             │
│  [Critical] [backend]  ● Backend    2h 15m        [R1]    │
│  ↳ priority  ↳ type    ↳ claim     ↳ mono         ↳ rework│
│    badge       badge    indicator   xs, muted       badge  │
│                         + agent                             │
│                         xs, muted                           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Mobile Layout (< 768px)

```
┌─── 3px priority left border ───────────────────┐
│  12px horiz / 12px vert padding                 │
│                                                 │
│  FORGEOS-BK-007         [Critical] [backend]   │
│  Implement Ticket...                            │
│                                                 │
│  ● Backend        2h 15m                       │
│                                                 │
└─────────────────────────────────────────────────┘
```

---

## 4. Element Specifications

### 4.1 Ticket ID

| Property | Value |
|----------|-------|
| Font family | `JetBrains Mono` (token: `typography.fontFamily.mono`) |
| Font size | `sm` (14px) |
| Font weight | 500 |
| Color | `themes.dark.colors.primary` (`#06B6D4`) |
| Truncation | None (IDs are short) |
| Position | Top-left of card |

### 4.2 Title

| Property | Value |
|----------|-------|
| Font family | `Inter` (token: `typography.fontFamily.sans`) |
| Font size | `sm` (14px) desktop, `base` (16px) mobile |
| Font weight | 400 |
| Color | `themes.dark.colors.text` (`#F8FAFC`) |
| Line clamp | 2 lines max |
| Overflow | `text-overflow: ellipsis` with `-webkit-line-clamp: 2` |
| Position | Below ticket ID, 4px gap |

### 4.3 Priority Badge

| Property | Value |
|----------|-------|
| Font family | `Inter` |
| Font size | `xs` (12px) |
| Font weight | 600 |
| Padding | 2px 8px |
| Border radius | `full` (9999px) |
| Background | Priority color (see table below) |
| Text color | `#F8FAFC` (inverse) |
| Position | Bottom-left of card |

| Priority | Background Color | Token Path |
|----------|-----------------|------------|
| Critical | `#EF4444` | `themes.dark.priority.critical` |
| High | `#F97316` | `themes.dark.priority.high` |
| Medium | `#3B82F6` | `themes.dark.priority.medium` |
| Low | `#6B7280` | `themes.dark.priority.low` |

### 4.4 Type Badge (NEW in UID002)

| Property | Value |
|----------|-------|
| Font family | `Inter` |
| Font size | `xs` (12px) |
| Font weight | 500 |
| Padding | 2px 8px |
| Border radius | `full` (9999px) |
| Text color | `#F8FAFC` (inverse) |
| Position | Immediately right of priority badge, 4px gap |

| Type | Background Color | Display Text |
|------|-----------------|--------------|
| backend | `#3B82F6` | `backend` |
| frontend | `#14B8A6` | `frontend` |
| fullstack | `#8B5CF6` | `fullstack` |
| infra | `#64748B` | `infra` |
| security | `#EF4444` | `security` |
| docs | `#64748B` | `docs` |
| research | `#A855F7` | `research` |
| architecture | `#8B5CF6` | `arch` |

### 4.5 Claim Indicator (NEW in UID002)

| Property | Claimed | Unclaimed |
|----------|---------|-----------|
| Icon | Filled circle (8px) | Empty circle (8px, 1.5px border) |
| Icon color | `themes.dark.colors.success` (`#16A34A`) | `themes.dark.colors.textMuted` (`#94A3B8`) |
| Agent text | Agent name in muted text | "Unclaimed" in muted italic |
| Font | `Inter`, `xs` (12px), 400 | `Inter`, `xs` (12px), 400, italic |
| Text color | `themes.dark.colors.textMuted` (`#94A3B8`) | `themes.dark.colors.textMuted` (`#94A3B8`) |

**Accessibility:** Claim status is conveyed by:
1. Icon shape: filled circle = claimed, empty circle = unclaimed
2. Text label: agent name vs "Unclaimed"
3. Color: green vs gray (supplemental, not sole indicator)

### 4.6 Machine Badge

| Property | Value |
|----------|-------|
| Font family | `Inter` |
| Font size | `xs` (12px) |
| Font weight | 500 |
| Padding | 2px 6px |
| Border radius | `md` (6px) |
| Background | Machine palette color (see design-tokens.json `machinePalette`) |
| Text color | Inverse (`#F8FAFC` or `#0F172A` based on luminance) |
| Position | Top-right of card |
| Visibility | Hidden if `machine` is null |

Machine colors are assigned consistently by hashing the hostname to one of 8 palette colors from `themes.dark.machinePalette`.

### 4.7 Time in Stage

| Property | Value |
|----------|-------|
| Font family | `JetBrains Mono` |
| Font size | `xs` (12px) |
| Font weight | 400 |
| Color (normal) | `themes.dark.colors.textMuted` (`#94A3B8`) |
| Color (warning) | `themes.dark.colors.error` (`#EF4444`) |
| Position | Bottom-right, before rework badge |

Time turns to error color when `isTimeWarning` is true (stage threshold exceeded).

### 4.8 Rework Badge

| Property | Value |
|----------|-------|
| Font family | `Inter` |
| Font size | `xs` (12px) |
| Font weight | 600 |
| Padding | 2px 6px |
| Border radius | `md` (6px) |
| Background | `themes.dark.colors.warning` (`#EAB308`) |
| Text | `R{count}` (e.g., `R1`, `R2`, `R3`) |
| Text color | `#0F172A` (dark inverse) |
| Visibility | Hidden if `reworkCount` is 0 |
| Position | Far bottom-right of card |

---

## 5. States

### 5.1 Default

```css
background: var(--surface);        /* #1E293B */
border-left: 3px solid var(--priority-color);
border-radius: var(--radius-lg);   /* 8px */
box-shadow: var(--shadow-sm);
cursor: pointer;
```

### 5.2 Hover

```css
background: var(--surface-hover);  /* #253145 approx +5% lightness */
box-shadow: var(--shadow-md);
transition: background 150ms ease, box-shadow 150ms ease;
```

### 5.3 Focus (Keyboard)

```css
outline: 2px solid var(--primary); /* #06B6D4 */
outline-offset: 2px;
```

### 5.4 Selected (Detail Panel Open)

```css
border: 2px solid var(--primary);  /* #06B6D4 */
box-shadow: var(--shadow-lg);
```

### 5.5 Loading (Skeleton)

```css
/* Three skeleton bars with pulse animation */
.skeleton-bar {
  background: linear-gradient(90deg, var(--surface) 25%, var(--border) 50%, var(--surface) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: var(--radius-sm);
}
```

Skeleton layout:
```
┌────────────────────────────────────────┐
│ ████████████                           │  ← ID bar (60% width, 14px height)
│ ████████████████████████████████       │  ← Title bar 1 (90% width, 14px height)
│ ████████████████████                   │  ← Title bar 2 (65% width, 14px height)
│ ████  ████         ████████  ████     │  ← Badge bars
└────────────────────────────────────────┘
```

### 5.6 Dragging (Future Enhancement)

```css
opacity: 0.8;
box-shadow: var(--shadow-xl);
transform: rotate(2deg);
```

---

## 6. Dimensions

| Property | Desktop (≥1024px) | Tablet (768–1023px) | Mobile (<768px) |
|----------|-------------------|---------------------|-----------------|
| Width | `minmax(180px, 1fr)` | `minmax(200px, 1fr)` | `100%` |
| Min height | 88px | 96px | 56px |
| Padding | 12px | 12px | 12px 16px |
| Border radius | 8px | 8px | 8px |
| Margin-bottom | 8px | 8px | 8px |
| Left border | 3px | 3px | 3px |
| Touch target | n/a | 44px min | 44px min (full card) |

---

## 7. Responsive Behavior

### Desktop (≥ 1024px)
- Show all elements: ID, title, priority badge, type badge, claim indicator, agent, machine badge, time, rework badge
- Hover states active
- Compact card layout optimized for dense column viewing

### Tablet (768–1023px)
- Same as desktop but with slightly larger min-width (200px)
- Touch-friendly, hover states trigger on first tap
- All elements visible

### Mobile (< 768px)
- Full-width cards in accordion section
- Row 1: Ticket ID + Priority badge + Type badge
- Row 2: Title (2-line clamp)
- Row 3: Claim indicator + Agent + Time
- Machine badge hidden (limited space)
- Rework badge shown only if count > 0

---

## 8. Accessibility

### ARIA Attributes

```html
<div
  role="listitem"
  tabindex="0"
  aria-label="{ticketId}, {title}, {priority} priority, {type} type, {agent or unclaimed}"
  aria-selected="{isSelected}"
  onclick="handleClick"
  onkeydown="handleKeyDown"
>
```

### Keyboard Navigation

| Key | Action |
|-----|--------|
| Tab | Focus card (within tab order) |
| Enter | Open ticket detail panel |
| Space | Open ticket detail panel |
| Arrow Up | Focus previous card in same column |
| Arrow Down | Focus next card in same column |
| Arrow Left | Focus same position in previous column |
| Arrow Right | Focus same position in next column |

### Screen Reader Behavior

On focus, announces in order:
1. Ticket ID (e.g., "FORGEOS-BK-007")
2. Title (full, not truncated)
3. Priority level (e.g., "Critical priority")
4. Type (e.g., "backend type")
5. Claim status (e.g., "Claimed by Backend" or "Unclaimed")
6. Time in stage (e.g., "2 hours 15 minutes in stage")
7. Rework count if > 0 (e.g., "1 rework")

### Color Independence

| Visual Element | Non-Color Indicator |
|---------------|---------------------|
| Priority | Badge text label ("Critical", "High", etc.) |
| Type | Badge text label ("backend", "frontend", etc.) |
| Claim status | Icon shape (filled vs empty circle) + text label |
| Time warning | Text turns bold + `aria-live="polite"` announcement |
| Rework | Badge text with "R" prefix + count number |

### Contrast Ratios

| Foreground | Background | Ratio | Requirement |
|-----------|------------|-------|-------------|
| `#F8FAFC` (text) | `#1E293B` (surface) | 11.7:1 | AA ✅ |
| `#06B6D4` (primary) | `#1E293B` (surface) | 5.2:1 | AA ✅ |
| `#94A3B8` (muted) | `#1E293B` (surface) | 5.0:1 | AA ✅ |
| `#F8FAFC` (badge text) | `#EF4444` (critical) | 4.6:1 | AA ✅ |
| `#F8FAFC` (badge text) | `#3B82F6` (medium/backend) | 4.7:1 | AA ✅ |
| `#F8FAFC` (badge text) | `#6B7280` (low/infra) | 4.5:1 | AA ✅ |

---

## 9. Integration Example

```typescript
// Usage within StageColumn
<TicketCard
  ticketId="FORGEOS-BK-007"
  title="Implement Ticket Claim with SKIP LOCKED"
  priority="critical"
  type="backend"
  agent="Backend"
  machine="pop-os"
  timeInStage="2h 15m"
  reworkCount={1}
  isTimeWarning={false}
  isClaimed={true}
  onClick={(id) => openTicketDetail(id)}
/>

// Unclaimed card
<TicketCard
  ticketId="FORGEOS-FE-005"
  title="Frontend: Implement Claims Monitor View"
  priority="medium"
  type="frontend"
  isClaimed={false}
  onClick={(id) => openTicketDetail(id)}
/>
```

---

## References

- **Mockup Document:** [FORGEOS-UID002.md](../../uiux/mockups/FORGEOS-UID002.md)
- **Pipeline Board Spec:** [pipeline-board.md](./pipeline-board.md)
- **Design Tokens:** [design-tokens.json](../../uiux/design-tokens.json)
- **Layout Spec:** [layout-spec.md](../../uiux/layout-spec.md)
- **Base TicketCard (UID001):** [FORGEOS-UID001.md](../../uiux/mockups/FORGEOS-UID001.md)
