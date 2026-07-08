---
type: Skill
title: implement
description: Implementation craft — verify the issue's premise, survey for existing overlap, design before writing tests, implement to green, and self-review for duplication before handing off a ready PR.
resource: skills/implement.md
tags: [implement, issues, tdd, craft, reuse]
---

# `/implement`

Implementation _craft_: the judgment an engineer applies to turn one GitHub issue
into a ready branch. It owns the **what** — understanding the issue, confirming
its premise against the code, surveying for reuse, designing before writing
tests, implementing to green, and a duplication self-review — and deliberately
**not** the wider coordination that surrounds a merge — gate/verdict labels,
milestone assignment, and where the PR travels after hand-off. It provisions the
worktree, commits, opens the PR, and — as its final action on the done path —
marks it ready-for-review: the PR is a draft only while implement is working, and
a finished implementation always ends **ready**, the signal another agent uses to
pick it up for review/fix-review/merge.

The run composes the maintained `ai-*` CLIs for its mechanical spine:
`ai-new-worktree` (`@rmartz/worktree`) to provision the worktree,
`ai-pre-push-verify` (`@rmartz/verify`) to re-run the project's CI-derived checks,
and `ai-create-pr` / `ai-create-issue` (`@rmartz/github`) for the PR and any issue
write; a GitHub MCP tool (`mcp__github__*`) is preferred where richer (e.g. reading
an issue). The skill never names a gate/verdict label and never bakes in a
coordinator's PR lifecycle.

## Hand-off

The skill produces a **ready branch and an outcome** — implemented-and-ready, or
stuck-with-a-diagnosis — and opens the PR itself: a draft while it works, then
marked ready-for-review as its final action on the done path (a stuck run leaves
it a draft). That branch-plus-outcome is the contract any downstream coordinator
(e.g. [PR Shepherd](../pr-shepherd-handoff.md)) consumes; the skill itself never
applies gate/verdict labels or drives the post-hand-off lifecycle.

The skill **stops when the implementation is done**: it never reviews,
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
