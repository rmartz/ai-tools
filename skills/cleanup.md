---
name: cleanup
description: Clean up orphaned local branches and worktrees whose PR has merged or been abandoned, or that have gone stale (no commit in 30+ days), via the idempotent ai-git-cleanup.
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

1. **Remove orphaned worktrees** — every secondary worktree whose branch's PR is
   `closed`/merged **or whose latest commit is 30+ days old** is removed
   (`git worktree remove`, no `--force`); dirty worktrees are skipped even when the
   branch is closed or stale, so uncommitted work is preserved. Kept: main
   worktree, detached-HEAD worktrees, and worktrees with recent commits on an open
   PR or no PR yet (`none` — pre-PR work in progress).
2. **Delete orphaned branches** — every local branch whose PR is `closed`/merged
   **or whose latest commit is 30+ days old** is deleted. Kept: branches with
   recent commits (open PR or `none`), the current branch, and the default branch
   (`main`/`master`).
3. **Prune stale admin files** — `git worktree prune` clears stale worktree
   administrative files.

The staleness sweep is what finally clears a branch we were _waiting_ on — a
stalled open PR, or a no-PR branch that never resolved — since neither has a PR
close to trigger cleanup on its own.

## Step 2 — Report

Report what was removed vs. skipped (and why), so a run on an already-clean repo
reads as a no-op.
