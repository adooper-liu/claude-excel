---
applyTo: "**/*.{md,ts,tsx,js,py}"
---

Review with evidence-first discipline.

- Verify repo truth before judging: current branch, git status, and diff vs master.
- Confirm the task phase: design, coding, review, or merge, using AGENTS.md and docs/coordination.md.
- Check relevant repo rules before any conclusion: AGENTS.md, docs/coordination.md, CLAUDE.md, and docs/user-extensions-security.md when relevant.
- Judge only the actual files and branch state you can verify.
- Classify each finding as: verified defect, expected state, or insufficient evidence.
- Use only precise wording: verified / expected / not yet evidenced.
- Never invent missing facts, assume an unverified state, or fill gaps with a story.
- Avoid should / likely / probably / seems / looks done / I assume.
- If evidence is missing, say exactly what is missing and stop.
- For the canonical full standard, see .copilot/review-discipline.md.
