---
description: Comprehensive UI/UX design guide — 67 styles, 96 palettes, 57 font pairings, 99 UX guidelines, 25 chart types across 13 stacks, with priority-based recommendations.
argument-hint: Describe the screen/app to design and the target stack (e.g. "landing page, nextjs + shadcn")
---

Execute the **ui-ux-pro-max** design protocol. The full guide and its searchable
database live in `.github/prompts/ui-ux-pro-max/PROMPT.md` — read that file and
follow it. It drives Python search scripts under
`.github/prompts/ui-ux-pro-max/scripts/` (`search.py`, `design_system.py`,
`core.py`) over the CSV data in `.github/prompts/ui-ux-pro-max/data/`.

Run those scripts via Bash to retrieve priority-ranked style, color, typography,
and UX recommendations for the requested screen and stack, then synthesize the
design guidance.

User input for this run:

$ARGUMENTS
