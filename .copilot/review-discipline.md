# Evidence-first review discipline

## Purpose

A review is valid only when it is grounded in evidence, aligned with the repo workflow, and explicit about uncertainty instead of inventing missing facts.

## Rule 1: verify repo truth before judging

- Check current branch, git status, and diff vs master.
- Treat only what is visible in the working tree and repo state as fact.
- Do not judge from memory, assumptions, or a prior conversation unless it is confirmed again in the repo state.

## Rule 2: confirm the task phase

- Confirm the task phase: design, coding, review, or merge.
- Follow AGENTS.md and docs/coordination.md.
- Do not assume a task is in the wrong phase because it feels incomplete or because a brief exists elsewhere.

## Rule 3: check the relevant repo rules

Before any conclusion, verify the relevant repo rules:

- AGENTS.md
- docs/coordination.md
- CLAUDE.md
- docs/user-extensions-security.md when the task touches user extensions or execution boundaries

## Rule 4: judge the actual implementation

- Review only the files and actual branch state you can verify.
- Do not infer missing implementation from intention or narrative.
- Do not treat a plan, idea, or expected state as a completed implementation.

## Rule 5: classify findings correctly

Classify each finding as one of the following:

- verified defect: supported by evidence and violates a repo rule or task requirement
- expected state: consistent with the repo workflow and verified branch state
- insufficient evidence: not yet proven; do not speculate or fill the gap

## Rule 6: use precise wording

Preferred wording:

- verified
- expected
- not yet evidenced

Avoid wording such as:

- should
- likely
- probably
- seems
- looks done
- I assume

## Rule 7: stop when evidence is missing

- Say exactly what evidence is missing.
- Ask for the fact or verify it directly.
- Do not rescue a weak conclusion with a narrative.

## Minimal checklist for every review

- branch verified?
- repo state verified?
- task phase verified?
- relevant repo rules checked?
- actual implementation checked?
- conclusion classified correctly?
- wording precise and non-speculative?

## Final standard

If a claim is not backed by visible evidence, it is not a valid review conclusion. The review must be explicit, repo-grounded, and limited to what is actually verified.
