---
id: merge-protocol
version: "1.0"
locked_by: ReaperOAK
immutable: true
---

# Merge Protocol

## Overview

All agent-produced code changes flow through an auditable, sandbox-first merge
pipeline. No code reaches `main` without human approval.

## Patch Output Convention

- Patches are written to: `.github/tasks/outputs/<packet_id>.<agent>.patch`
- Format: standard unified diff (`git diff --cached` output)
- One patch per delegation packet — no multi-packet bundles

## Lifecycle

```
1. Agent completes work on delegation packet
2. Agent generates patch:
   git diff --cached > .github/tasks/outputs/<packet_id>.<agent>.patch
3. Agent updates claim status to COMPLETED
4. CI workflow ai-sandbox-merge.yml triggers:
   a. Creates ephemeral branch: sandbox/<packet_id>
   b. Applies patch with git apply --check first
   c. Runs lint, test, build checks
   d. Creates PR targeting main with label needs-human-review
5. ReaperOAK reviews PR:
   a. Validates patch scope matches delegation packet allowed_paths
   b. Confirms no forbidden_paths were touched
   c. Verifies evidence_requirements from packet are met
   d. Adds validation_signature to PR comment
6. Human approves and merges PR
7. Claim status updated to MERGED
```

## Validation Checks

### Scope Verification
- REQUIRE: Every changed file matches `allowed_paths` glob from delegation packet
- DENY: Any changed file matching `forbidden_paths`
- VERIFY: No files outside declared scope were modified

### Evidence Verification
- REQUIRE: Test output attached if `evidence_requirements` includes tests
- REQUIRE: Lint clean output if `evidence_requirements` includes lint
- VERIFY: Self-reflection score ≥ 7/10 reported in claim

### Integrity Verification
- REQUIRE: Patch applies cleanly to HEAD of main
- REQUIRE: No merge conflicts
- VERIFY: SHA-256 of patch file matches claim record

## Auto-Merge Prevention

- PRs created by sandbox workflow carry label `needs-human-review`
- Branch protection on `main` requires at least 1 human approval
- ReaperOAK validation_signature is necessary but NOT sufficient — human must also approve
- No GitHub Actions bot may merge to main

## Conflict Resolution

If patch does not apply cleanly:
1. Claim status set to FAILED with reason: CONFLICT
2. Agent is notified via delegation retry (max 3 retries)
3. After 3 failures, escalate to ReaperOAK for manual resolution
4. ReaperOAK may re-delegate with updated base

## Rollback Protocol

If a merged change causes regression:
1. Create revert PR from main
2. Mark original claim as REVERTED
3. Log incident in riskRegister.md
4. Re-delegate with corrected scope if retry warranted
