---
name: cleanup
description: Clean up orphaned local branches and worktrees whose PR has merged or been abandoned, via the idempotent ai-git-cleanup.
---

# cleanup

Clean up orphaned local branches and worktrees in the current repository.

---

> **Tooling**: this skill composes `@rmartz/worktree`'s `ai-git-cleanup`
> (`runCleanup`) — all the branch/worktree-orphan logic lives in the library. It
> is git-local hygiene only; it touches no GitHub state beyond a read to check
> whether each branch still has an open PR.

> **When to use**: run this periodically, or after a batch of merges, to clear
> local branches and worktrees that no longer have an open PR — because the PR
> merged or was abandoned. A merge skill cleans up after the PRs _it_ merges; this
> skill clears the accumulations from manual merges, force-deletes, and older PRs.

## Step 1 — Run cleanup

Run `ai-git-cleanup` from within the repository. It is idempotent and runs three
phases, making a single PR lookup per unique branch (a branch that appears both as
a worktree and locally is looked up once):

1. **Remove orphaned worktrees** — every secondary worktree whose branch has no
   open PR is removed (`git worktree remove --force`). The main worktree,
   detached-HEAD worktrees, and worktrees with an open PR are skipped.
2. **Delete orphaned branches** — every local branch with no open PR is deleted.
   The current branch and the default branch (`main`/`master`) are skipped.
3. **Prune stale admin files** — `git worktree prune` clears stale worktree
   administrative files.

## Step 2 — Report

Report what was removed vs. skipped (and why), so a run on an already-clean repo
reads as a no-op.
