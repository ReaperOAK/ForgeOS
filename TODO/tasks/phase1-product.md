# Phase 1 — Product Manager L3 Tickets

Source block: BLK-03-01 (Product Requirements Document)

---

## FORGEOS-PM001: Define User Personas for Orchestration Platform

**Type:** docs
**Priority:** critical
**Dependencies:** FORGEOS-RES009
**Files:** docs/product/user-personas.md
**Tags:** product, personas, phase1, BLK-03-01

### Description

Define the user personas for the ForgeOS distributed orchestration platform. Document 4 personas — Human Operator, AI Agent, Ticketer Dispatcher, and System Administrator — each with goals, constraints, interaction patterns, frequency of use, and pain points with the current filesystem-based system. These personas drive all subsequent user story and UX work.

### Acceptance Criteria

- [ ] Human Operator persona defined: goals (manage tickets, monitor agents), constraints (CLI + dashboard), interaction frequency (daily)
- [ ] AI Agent persona defined: goals (claim work, report results), constraints (programmatic only, no UI), interaction frequency (continuous)
- [ ] Ticketer Dispatcher persona defined: goals (dispatch agents, advance pipeline), constraints (stateless, no reasoning), interaction frequency (continuous)
- [ ] System Administrator persona defined: goals (maintain platform, handle escalations), constraints (full access), interaction frequency (weekly)
- [ ] Each persona has documented pain points with the current filesystem-based system
- [ ] Interaction pattern diagrams showing how each persona uses the platform
- [ ] Personas document delivered at docs/product/user-personas.md

---

## FORGEOS-PM002: Capture User Stories Across All Capabilities

**Type:** docs
**Priority:** high
**Dependencies:** FORGEOS-PM001
**Files:** docs/product/user-stories.md
**Tags:** product, user-stories, phase1, BLK-03-01

### Description

Capture user stories for the ForgeOS platform covering all capability domains. Produce at least 20 user stories across the 4 personas, covering ticket operations (claim, advance, rework), real-time monitoring, multi-machine coordination, authentication, webhook integration, and migration scenarios. Each story follows the format: As a [persona], I want to [action], so that [benefit].

### Acceptance Criteria

- [ ] At least 5 user stories for Human Operator persona covering: ticket status view, claim monitoring, manual intervention, dashboard interaction, migration control
- [ ] At least 5 user stories for AI Agent persona covering: claim ticket, advance ticket, heartbeat lease, report results, handle rework
- [ ] At least 5 user stories for Ticketer Dispatcher persona covering: scan ready tickets, dispatch agents, advance pipeline, handle escalations, sync state
- [ ] At least 5 user stories for System Administrator persona covering: configure auth, monitor health, manage agents, handle failures, audit trail
- [ ] Each user story has acceptance criteria (Given/When/Then format)
- [ ] Stories prioritized using MoSCoW method (Must/Should/Could/Won't)
- [ ] User stories document delivered at docs/product/user-stories.md

---

## FORGEOS-PM003: Define Non-Functional and Migration Requirements

**Type:** docs
**Priority:** high
**Dependencies:** FORGEOS-RES009, FORGEOS-RES010
**Files:** docs/product/nfr-migration-reqs.md
**Tags:** product, nfr, migration, phase1, BLK-03-01

### Description

Define the non-functional requirements (NFRs) and migration-specific acceptance criteria for the ForgeOS platform. Document measurable targets for performance, availability, scalability, security, and usability. Define the dual-mode migration acceptance criteria including rollback plan, data integrity verification, and cutover conditions.

### Acceptance Criteria

- [ ] Performance NFRs defined with measurable targets: claim latency, API response time, dashboard load time
- [ ] Availability NFRs defined: uptime target, recovery time objective, recovery point objective
- [ ] Scalability NFRs defined: maximum concurrent agents, maximum active tickets, horizontal scaling requirements
- [ ] Security NFRs defined: authentication requirement, authorization model, audit logging, secret management
- [ ] Migration acceptance criteria: dual-mode operation verified, rollback tested, data integrity confirmed
- [ ] Migration rollback plan: conditions that trigger rollback, rollback procedure, maximum rollback window
- [ ] Data integrity verification criteria: how to confirm JSON files and database records are in sync
- [ ] NFR document delivered at docs/product/nfr-migration-reqs.md

---

## FORGEOS-PM004: Define Dashboard UX Requirements and Priority Matrix

**Type:** docs
**Priority:** medium
**Dependencies:** FORGEOS-PM001, FORGEOS-PM002
**Files:** docs/product/dashboard-ux-reqs.md
**Tags:** product, dashboard, ux, priority-matrix, phase1, BLK-03-01

### Description

Define the dashboard UX requirements for the ForgeOS web interface, replacing the current static HTML dashboard (todo_visual.py). Document required views (pipeline overview, ticket detail, dependency graph, claim monitor, agent status), interaction patterns (filter, sort, search, drill-down), real-time update requirements (WebSocket feed), and multi-machine visibility. Create a priority matrix mapping all product requirements to L1 capabilities.

### Acceptance Criteria

- [ ] Pipeline overview view requirements: stage columns, ticket cards, drag-and-drop consideration, filtering
- [ ] Ticket detail view requirements: full ticket info, history timeline, file paths, acceptance criteria status
- [ ] Dependency graph view requirements: visual graph rendering, blocking path highlighting, zoom/pan
- [ ] Claim monitor view requirements: active claims, lease timers, machine identification, agent status
- [ ] Real-time update requirements: WebSocket subscription, optimistic UI updates, reconnection handling
- [ ] Multi-machine visibility: which machine holds which claim, operator identification, conflict indicators
- [ ] Priority matrix created: rows = requirements, columns = L1 capabilities, cells = priority (P0-P3)
- [ ] Dashboard UX requirements document delivered at docs/product/dashboard-ux-reqs.md
