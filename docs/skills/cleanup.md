---
type: Skill
title: cleanup
description: Local-hygiene craft — remove orphaned worktrees and branches whose PR has merged or been abandoned, or that have gone stale (no commit in 30+ days), via @rmartz/worktree's idempotent ai-git-cleanup.
resource: skills/cleanup.md
tags: [cleanup, worktree, branches, git]
---

# `/cleanup`

The `cleanup` skill clears local branches and worktrees whose PR has been
closed/merged, **or that have gone stale (no commit in 30+ days)** — the
accumulation from manual merges, force-deletes, older PRs a merge skill didn't
tidy, and branches we were waiting on that never resolved. Branches with recent
commits and no PR yet (`none` state — pre-PR work in progress) are kept, as is any
worktree with uncommitted changes. It composes `@rmartz/worktree`'s
`ai-git-cleanup` (`runCleanup`); the orphan-detection logic lives in the library.

Idempotent, three phases, one PR lookup per unique branch:

1. Remove secondary worktrees whose branch's PR is `closed`/merged **or whose
   latest commit is 30+ days old** — never with `--force`; dirty worktrees are
   skipped (uncommitted work preserved). Keeps: main, detached-HEAD, and
   recent-commit open-PR / no-PR-yet (`none`) worktrees.
2. Delete local branches whose PR is `closed`/merged **or that are 30+ days
   stale** — keeps recent-commit open-PR / `none` branches, the current branch,
   and the default branch.
3. `git worktree prune` for stale admin files.

Git-local only — the sole GitHub touch is the read that checks whether a branch
still has an open PR.

## See also

- Library: [`@rmartz/worktree`](../packages/worktree.md).
