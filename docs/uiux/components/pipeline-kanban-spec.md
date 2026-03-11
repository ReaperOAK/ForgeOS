---
title: Pipeline Kanban View — Component Spec
ticket: FORGEOS-FE003
author: UIDesigner + FrontendEngineer
date: 2026-03-11T00:00:00Z
status: APPROVED
components:
  - PipelineBoard
  - StageColumn
  - TicketCard
---

# Pipeline Kanban View — Component Specification

> **Ticket:** FORGEOS-FE003 | **Status:** APPROVED

## Components

### PipelineBoard

**File:** `dashboard/src/components/pipeline/PipelineBoard.tsx`

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `tickets` | `Ticket[]` | yes | Full ticket list from API |
| `isLoading` | `boolean` | yes | Initial loading state |

**States:** Loading (11 skeleton columns), Populated (grouped by stage), Empty (columns show "No tickets")

**Layout:** Horizontal scrollable flex container with 11 columns in SDLC order. Each column is 200–280px wide. Tickets are sorted by priority (critical first) then by updated_at descending.

**Stage Order:** READY → RESEARCH → ARCHITECT → BACKEND → FRONTEND → QA → SECURITY → CI → DOCS → VALIDATION → DONE

### StageColumn

**File:** `dashboard/src/components/pipeline/StageColumn.tsx`

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `stage` | `string` | yes | Stage key (e.g. `READY`) |
| `label` | `string` | yes | Display name |
| `accentColor` | `string` | yes | Hex color for top border |
| `tickets` | `Ticket[]` | yes | Tickets in this stage |

**Visual:** 3px colored top border, header with stage name + count badge, scrollable card area, empty placeholder at 50% opacity.

### TicketCard

**File:** `dashboard/src/components/pipeline/TicketCard.tsx`

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `ticketId` | `string` | yes | Human-readable ticket ID |
| `title` | `string` | yes | Truncated to 50 chars |
| `type` | `TicketType` | yes | Color-coded badge |
| `priority` | `TicketPriority` | yes | Left border + dot color |
| `claimedBy` | `string \| null` | yes | Agent name or null |
| `machineId` | `string \| null` | yes | Machine badge |
| `reworkCount` | `number` | yes | Rework badge if > 0 |

**Type Badge Colors:** backend=blue-500, frontend=teal-500, fullstack=purple-500, infra=orange-500, security=red-500, docs=gray-500

**Navigation:** Entire card is a `<Link>` to `/tickets/{ticketId}`.

## Page

**File:** `dashboard/src/app/pipeline/page.tsx`

Client component. Fetches all tickets via `fetchTickets({ limit: 500 })` on mount. Manual refresh button with spinning icon. Error banner with retry.

## Accessibility

- Cards are focusable links with descriptive aria-label
- Stage columns have `aria-label` with stage name and ticket count
- Loading state uses `aria-busy`
- Count badges have `aria-label`
- Priority conveyed by color + tooltip text, not color alone
