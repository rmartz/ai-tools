---
type: Skill
title: implement
description: Implementation craft — verify the issue's premise, survey for existing overlap, design before writing tests, implement to green, and self-review for duplication before a runner-agnostic hand-off.
resource: skills/implement.md
tags: [implement, issues, tdd, craft, reuse]
---

# `/implement`

Implementation _craft_: the judgment an engineer applies to turn one GitHub issue
into a ready branch. It owns the **what** — understanding the issue, confirming
its premise against the code, surveying for reuse, designing before writing
tests, implementing to green, and a duplication self-review — and deliberately
**not** the surrounding coordination. Worktree provisioning, the commit/verify
cadence, PR creation, its title/body/draft lifecycle, labels, and milestone
assignment are the runner's (coordinator's) job.

A direct run composes the maintained `ai-*` CLIs for its mechanical spine:
`ai-new-worktree` (`@rmartz/worktree`) to provision the worktree,
`ai-pre-push-verify` (`@rmartz/verify`) to re-run the project's CI-derived checks,
and `ai-create-pr` / `ai-create-issue` (`@rmartz/github`) for the PR and any issue
write; a GitHub MCP tool (`mcp__github__*`) is preferred where richer (e.g. reading
an issue). The skill never names a gate/verdict label and never bakes in a
coordinator's PR lifecycle.

## Runner-agnostic emission

Per the [PR Shepherd handoff](../pr-shepherd-handoff.md), the skill produces a
**ready branch and an outcome** and stops; how the outcome is _recorded_ depends
on who ran it:

- **Direct (harness) run** — the skill commits in the worktree and opens the PR
  itself with `ai-create-pr`, using a Conventional-Commit title.
- **Coordinator-dispatched run** — the skill's GitHub credentials are scrubbed;
  it **must not** open the PR or apply labels. It expresses the outcome — ready,
  or stuck with a diagnosis — and the engine records it and drives PR creation,
  labelling, promotion, and milestone tracking.

Either way the skill **stops when the implementation is done**: it never reviews,
fix-reviews, or merges its own work.

## Flow

1. **Resolve** — parse one or more issue references against the current repo;
   several issues fan out to one isolated worker per issue.
2. **Understand** — extract (or derive) the acceptance criteria; every test maps
   back to one.
3. **Verify the premise** — confirm the issue's claim against the code before
   writing anything; stop and surface a contradiction rather than inventing a
   root cause.
4. **Explore** — read the repo's test conventions, runner, and the source each
   criterion touches.
5. **Survey for overlap** — search for existing helpers by concept and synonym;
   decide **reuse / extend / new** explicitly and record it.
6. **Design, then test** — settle placement, interface, and an exemplar, then
   write hermetic tests that encode that design and confirm they go red.
7. **Implement to green** — iterate (diagnose before fixing) to passing, keeping
   typecheck/lint green; declare stuck with a diagnosis if two iterations stall.
8. **Self-review for duplication** — diff the branch, consolidate anything that
   duplicates existing logic, then hand off (the skill stops; it does not review
   or merge).

## See also

- Sibling authoring skill: [`create-issue`](./create-issue.md).
- The delegation contract — [`pr-shepherd-handoff`](../pr-shepherd-handoff.md).
- Downstream of the hand-off: [`review`](./review.md).
