#!/usr/bin/env bash
# Claude Code Stop adapter. Verifies the latest agent-output summary carries the
# required evidence (artifact paths, confidence). Advisory only — surfaces the
# evidence rule without blocking, so ordinary (non-ticket) Claude sessions are
# never held open. Flip the final `exit 0` to `exit 2` for hard enforcement.
set -uo pipefail
if ! bash .github/hooks/scripts/verify-evidence.sh 2>&1; then
    echo "[vibecoding] Evidence-rule reminder: every TASK_COMPLETED needs artifact paths, test results (or justified N/A), and a confidence level in agent-output/{Agent}/{ticket-id}.md."
fi
exit 0
