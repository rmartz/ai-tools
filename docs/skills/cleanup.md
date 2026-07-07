---
type: Skill
title: cleanup
description: Local-hygiene craft — remove orphaned worktrees and branches whose PR has merged or been abandoned, via @rmartz/worktree's idempotent ai-git-cleanup.
resource: skills/cleanup.md
tags: [cleanup, worktree, branches, git]
---

# `/cleanup`

The `cleanup` skill clears local branches and worktrees that no longer have an
open PR — the accumulation from manual merges, force-deletes, and older PRs a
merge skill didn't tidy. It composes `@rmartz/worktree`'s `ai-git-cleanup`
(`runCleanup`); the orphan-detection logic lives in the library.

Idempotent, three phases, one PR lookup per unique branch:

1. Remove orphaned secondary worktrees (skip main, detached-HEAD, and open-PR ones).
2. Delete orphaned local branches (skip the current and default branch).
3. `git worktree prune` for stale admin files.

Git-local only — the sole GitHub touch is the read that checks whether a branch
still has an open PR.

## See also

- Library: [`@rmartz/worktree`](../packages/worktree.md).
