---
type: Skill
title: cleanup
description: Local-hygiene craft — remove orphaned worktrees and branches whose PR has merged or been abandoned, via @rmartz/worktree's idempotent ai-git-cleanup.
resource: skills/cleanup.md
tags: [cleanup, worktree, branches, git]
---

# `/cleanup`

The `cleanup` skill clears local branches and worktrees whose PR has been
closed/merged — the accumulation from manual merges, force-deletes, and older PRs
a merge skill didn't tidy. Branches and worktrees with no PR yet (`none` state —
pre-PR work in progress) are always kept. It composes `@rmartz/worktree`'s
`ai-git-cleanup` (`runCleanup`); the orphan-detection logic lives in the library.

Idempotent, three phases, one PR lookup per unique branch:

1. Remove secondary worktrees whose branch's PR is `closed`/merged — never with
   `--force`; dirty worktrees are skipped. Keeps: main, detached-HEAD, open-PR,
   and no-PR-yet (`none`) worktrees.
2. Delete local branches whose PR is `closed`/merged — keeps open-PR branches,
   no-PR-yet (`none`) branches, the current branch, and the default branch.
3. `git worktree prune` for stale admin files.

Git-local only — the sole GitHub touch is the read that checks whether a branch
still has an open PR.

## See also

- Library: [`@rmartz/worktree`](../packages/worktree.md).
