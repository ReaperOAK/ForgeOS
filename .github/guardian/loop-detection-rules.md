---
id: loop-detection-rules
version: "1.0"
locked_by: ReaperOAK
---

# Loop Detection & Token Budget Rules

## Loop Detection

### Signal: Repeated Tool Calls
- DETECT: Same tool called with identical arguments ≥ 3 times within 10 steps
- ACTION: Halt agent, log loop signature, set task status to STALLED
- ESCALATE: Notify ReaperOAK with loop evidence (tool name, args, step numbers)

### Signal: Identical Output Cycles
- DETECT: Agent produces functionally identical output ≥ 2 consecutive times
- ACTION: Halt agent, set task status to STALLED
- ESCALATE: Notify ReaperOAK for re-scoping or alternative approach

### Signal: Retry Exhaustion
- DETECT: Task retried 3 times with same failure class
- ACTION: Set task status to BLOCKED, stop retries
- ESCALATE: Notify ReaperOAK → human escalation if unresolvable

### Signal: Oscillating State
- DETECT: Task status oscillates between two states ≥ 3 times (e.g. IMPLEMENTING → QA_REVIEW → REWORK → IMPLEMENTING)
- ACTION: Halt, force BLOCKED status
- ESCALATE: Root cause analysis required before retry

### Signal: TODO Progress Stall
- DETECT: Any task in `in_progress` status for > 2 full BUILD→VALIDATE cycles without status change
- ACTION: Set task status to STALLED, halt owning agent
- ESCALATE: ReaperOAK re-scopes or reassigns task; notify user if unresolvable

### Signal: Zero-Progress Cycle
- DETECT: A full BUILD→VALIDATE cycle completes with 0 tasks transitioning to `completed`
- ACTION: Halt pipeline, flag as systemic issue
- ESCALATE: Require user intervention — likely scope mismatch or under-decomposition

### Signal: Blocked Dependency Chain
- DETECT: 3+ tasks in a dependency chain are all `blocked`
- ACTION: Identify root blocker task, auto-escalate its priority to P0
- ESCALATE: ReaperOAK attempts to unblock root; if blocked > 1 full cycle → user notification

### Signal: Max-Task-Per-Cycle Violation
- DETECT: Agent receives > 3 tasks (or > 5 for SPEC-phase agents) in a single delegation cycle
- ACTION: Reject delegation batch, log violation
- ESCALATE: TODO Agent must further decompose the oversized batch

### Signal: Ticket State Skip
- DETECT: Agent attempts to advance a ticket past a state in the 9-state machine (READY → LOCKED → IMPLEMENTING → QA_REVIEW → VALIDATION → DOCUMENTATION → CI_REVIEW → COMMIT → DONE) without satisfying the guard condition for the transition (e.g., skipping QA_REVIEW to reach VALIDATION, or bypassing the post-execution chain)
- ACTION: Block the state transition, log the skip attempt with ticket ID and attempted transition, revert ticket to its last valid state
- ESCALATE: Notify ReaperOAK with evidence of attempted skip; ReaperOAK re-delegates with explicit state requirements and mandatory chain checks

### Signal: DoD Non-Compliance
- DETECT: Ticket advancement past QA_REVIEW attempted when DoD report has any item with `status: false`, or no DoD report exists at `docs/reviews/dod/{TASK_ID}-dod.yaml`, or `verdict != APPROVED`
- ACTION: Block advancement past QA_REVIEW, return ticket to REWORK → IMPLEMENTING, log non-compliance details (which DoD items failed)
- ESCALATE: Notify ReaperOAK; if repeated (≥ 2 advancement attempts with failing DoD), flag the owning agent for re-delegation or user intervention

### Signal: Initialization Skip
- DETECT: Agent enters IMPLEMENTING state for a ticket modifying a module that has no passing initialization checklist on disk (`allPassed: true` in `docs/reviews/init/{MODULE}-init.yaml` does not exist or is `false`)
- ACTION: Block IMPLEMENTING, return ticket to REWORK, log violation with module name and missing checklist items
- ESCALATE: Notify ReaperOAK to re-delegate with explicit initialization instructions; if module scaffolding cannot be completed after 2 attempts → user notification

### Signal: UI/UX Gate Bypass
- DETECT: Frontend ticket with `UI Touching: yes` enters IMPLEMENTING without: (a) a completed UIDesigner dependency ticket (`status: DONE`), or (b) design artifacts on disk at `docs/uiux/<feature>/` (mockup, interaction-spec, component-hierarchy, state-variations, accessibility-checklist)
- ACTION: Block the Frontend ticket from entering IMPLEMENTING, return to REWORK, log bypass attempt with ticket ID and missing artifact paths
- ESCALATE: Notify ReaperOAK; require UIDesigner ticket completion before unblocking. Override requires explicit user approval logged in `decisionLog.md`

### Signal: Validator Rejection Loop
- DETECT: Validator issues `REJECTED` verdict for the same task ≥ 3 times (rework count reaches maximum of 3)
- ACTION: Set task status to ESCALATED, halt all further rework attempts for this task, stop the delegated agent from re-entering IMPLEMENTING
- ESCALATE: Notify ReaperOAK → present full rejection history (all 3 rejection reports) to user with options: force-approve (override logged in `decisionLog.md`), cancel task, or reassign to a different agent

## Token Budget Enforcement

### Per-Task Budgets
- Each delegation packet declares `max_token_budget`
- Agents MUST track cumulative token usage against budget

### Threshold Actions

| Budget Used | Action |
|-------------|--------|
| 0-69% | Normal operation |
| 70-79% | WARNING: Agent warned, must prioritize completion |
| 80-89% | RESTRICT: Essential operations only — no exploration |
| 90-94% | URGENT: Wrap up, deliver partial results if needed |
| 95-100% | HARD STOP: Force completion, return partial output |
| >100% | VIOLATION: Task killed, escalate to ReaperOAK |

### Session-Level Budgets
- Total session budget tracked across all agents
- ReaperOAK monitors aggregate burn rate
- If session budget exceeds 80%, no new delegations permitted
- At 95%, all agents must wrap up current tasks


## Circuit Breaker: STOP_ALL

- File: `.github/guardian/STOP_ALL`
- Format: `STATUS TIMESTAMP` (first line)
- Values: `CLEAR` (normal), `STOP` (halt all), `PAUSE` (finish current, no new)
- All agents MUST check STOP_ALL before:
  - Starting a new task
  - Making write operations
  - Delegating to subagents
- Only ReaperOAK or human may set/clear STOP_ALL

## Human Notification

### Notification Triggers
- Any agent enters STALLED state
- Token budget exceeds 80% for any task
- Session budget exceeds 70%
- Loop detected
- 3 consecutive task failures
- Guardian STOP activated

### Notification Content
```yaml
notification:
  type: "LOOP_DETECTED | BUDGET_WARNING | STALL | FAILURE"
  agent: "<agent name>"
  task_id: "<packet_id>"
  evidence: "<specific evidence>"
  recommendation: "<suggested action>"
  urgency: "LOW | MEDIUM | HIGH | CRITICAL"
```
