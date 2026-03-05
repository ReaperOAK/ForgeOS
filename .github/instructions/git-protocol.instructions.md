---
name: Git Protocol
applyTo: '**'
description: Two-commit protocol, scoped git, commit format, push-based locking, lease mechanism, failure recovery.
---

# Git Protocol

## 1. Two-Commit Protocol

RULE: Every agent executes exactly two git commits per ticket stage.
RULE: Commit 1 (CLAIM) must complete before Commit 2 (WORK) begins.
PROHIBITED: Combining claim and work into one commit.
PROHIBITED: Skipping either commit.

## 2. Commit 1 — CLAIM (Distributed Lock)

REQUIRED: `git pull --rebase` before claim.
REQUIRED: Verify ticket exists in expected stage directory.
REQUIRED: Verify ticket is unclaimed or lease has expired.

REQUIRED: Update ticket JSON metadata:
- `claimed_by`: agent worker ID
- `machine_id`: hostname
- `operator`: human operator name
- `lease_expiry`: current time + 30 minutes

REQUIRED: Stage ONLY ticket JSON files:
```bash
git add .github/ticket-state/<STAGE>/<ticket-id>.json
git add .github/tickets/<ticket-id>.json
git commit -m "[<ticket-id>] CLAIM by <agent> on <machine> (<operator>)"
git push
```

RULE: Push success = lock acquired.
RULE: Push failure = another machine claimed first => ABORT. Try another ticket.
PROHIBITED: Any code changes during claim commit.

## 3. Commit 2 — WORK

REQUIRED: Execute agent work for the assigned stage.
REQUIRED: Write summary to `.github/agent-output/{AgentName}/{ticket-id}.md`.
REQUIRED: Delete previous stage summary after reading it.
REQUIRED: Move ticket JSON to next stage directory.
REQUIRED: Update ticket JSON with completion metadata.

REQUIRED: Stage explicit file list only:
```bash
git add <each-modified-file-explicitly>
git commit -m "[<ticket-id>] <STAGE> complete by <agent> on <machine>"
git push
```

## 4. Scoped Git Rules (Hard)

PROHIBITED: `git add .`
PROHIBITED: `git add -A`
PROHIBITED: `git add --all`
PROHIBITED: Wildcard or glob staging.
PROHIBITED: Force pushing.

REQUIRED: Explicit file-by-file staging only.
REQUIRED: Staged files must match ticket scope.
ALLOWED: `CHANGELOG.md` when policy permits.

## 5. Commit Message Format

REQUIRED: Message begins with `[TICKET-ID]`.
REQUIRED: Claim commit format: `[TICKET-ID] CLAIM by AGENT on MACHINE (OPERATOR)`
REQUIRED: Work commit format: `[TICKET-ID] STAGE complete by AGENT on MACHINE`

## 6. Lease Mechanism

RULE: Default lease duration is 30 minutes.
RULE: Expired lease makes ticket reclaimable by any machine.
RULE: `tickets.py --release-expired` clears stale claims.
REQUIRED: Any machine may reclaim an expired-lease ticket.

## 7. Failure Recovery

| Failure | Recovery |
|---------|----------|
| Crash after claim, before work | Lease expires => another machine reclaims |
| Crash during work | Uncommitted work lost => reclaim + restart |
| Push conflict on work commit | Investigate => likely protocol violation |
| Rework count > 3 | Escalate to human |

## 8. Summary Handoff Protocol

RULE: Each agent writes exactly one summary file per ticket.
RULE: Filename: `{ticket-id}.md`
RULE: Location: `.github/agent-output/{AgentName}/{ticket-id}.md`
RULE: Agent reads ONLY previous stage summary.
RULE: Agent deletes previous stage summary after processing.
PROHIBITED: Cross-stage summary reading.
PROHIBITED: Cross-agent summary reading outside the chain.

RULE: Summary directories:
```
.github/agent-output/
    Architect/  Research/  Backend/  Frontend/
    QA/  Security/  CIReviewer/  Documentation/
    Validator/  TODO/  DevOps/  ProductManager/  UIDesigner/
```

RULE: Context flows ONLY via filesystem. ReaperOAK does NOT inject context.
