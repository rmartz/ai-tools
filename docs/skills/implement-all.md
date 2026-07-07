---
type: Skill
title: implement-all
description: Scope-resolver + loop craft — resolve a scope of issues (backlog / epic / label / explicit), partition actionable vs in-flight vs blocked via ai-repo-status, and run /implement for each (stacking children off in-flight deps) until drained. Stops before review/merge.
resource: skills/implement-all.md
tags: [implement, issues, epics, batch, stacking]
---

# `/implement-all`

`implement-all` turns a **scope** of issues into a sequence of `/implement` runs.
It is scope-resolution + loop craft — `/implement` remains the atomic unit of
work; this skill never reimplements the TDD workflow.

It composes `ai-repo-status` (`@rmartz/github` — issues, milestones, and the
open-PR/closing-issue map that drives partitioning) and `ai-new-worktree`
(`@rmartz/worktree` — `/implement` stacks a child off an in-flight dep's branch
with `--base`); direct-run issue/PR writes go through `ai-create-issue` /
`ai-create-pr`.

It **stops once every actionable issue has a PR opened** — review, fix-review, and
merge belong to the coordinator (PR Shepherd). The stacking _intent_ (a child PR
based on its dep's branch) is expressed; the runner orders the merges.

## Flow

1. **Resolve scope** — whole-backlog / explicit issues / epic (expand its
   milestone, seeding sub-issues from the epic body's task list when empty) /
   exact-label / prose.
2. **Partition** — actionable (no PR, deps satisfied-for-stacking), in-flight
   (already has a PR → skip), blocked (a dep neither closed nor in-flight). A dep
   is "clear" when closed **or** in-flight, so children stack on open dep PRs
   without waiting for a merge. Recover stale actionable worktrees (push + open a
   PR against the ancestry-resolved base).
3. **Loop** — pick lowest-numbered actionable → `/implement` → re-run
   `ai-repo-status` and promote newly-unblocked issues → repeat (safety cap 60).
4. **Report** — group by outcome (opened / stuck / failed / skipped / blocked) and
   hand the opened PRs to the coordinator.

## See also

- Atomic unit: [`implement`](./implement.md).
- Scope input: `status` surfaces empty/un-implemented epics to seed.
- Libraries: [`@rmartz/github`](../packages/github.md), [`@rmartz/worktree`](../packages/worktree.md).
