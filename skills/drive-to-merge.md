---
name: drive-to-merge
description: Human-invoked escape hatch — drive one or more PRs (expanding stacks bottom-up) through review → fix-review → merge iterations concurrently until each merges or blocks, bypassing the coordinator.
---

Drive one or more pull requests through review/fix-review iterations until each
converges on an approve, then merge them: $ARGUMENTS

Parse all PR numbers from `$ARGUMENTS` (space- or comma-separated positive
integers). If none are provided, stop with `usage: /drive-to-merge <pr-number>
[pr-number ...]`. Deduplicate and validate that every token is a positive integer;
reject the whole invocation if any token is not.

---

> **Tooling**: this skill is the **human-invoked escape hatch** that drives PRs to
> merge **without** the coordinator (PR Shepherd) — use it when the coordinator
> can't drive a PR itself (e.g. a breaking change to the coordinator that must land
> before the coordinator can be trusted to merge it), when a PR must merge
> immediately and the coordinator isn't running, or to step through the
> review → fix-review → merge loop by hand. It **composes the skills** `/review`,
> `/fix-review`, and `/merge` (invoked by name via the Skill tool) and reads each
> `/review`'s **runner-agnostic outcome** — it does **not** read a coordinator's
> verdict labels. For reads it composes `ai-pr-summary` (`@rmartz/github`) and
> `gh`; prefer a GitHub MCP tool (`mcp__github__*`) where richer. Because it acts
> as its own mini-runner, it does the branch mutations (`gh pr ready`,
> `update-branch`) the normal `/review` refuses — that is the point of the escape
> hatch. For everything routine, prefer the coordinator; this is the manual path.

> **Multiple PRs are driven concurrently.** Rather than finishing one PR end to end
> before starting the next, the skill interleaves work — dispatching the next
> available action on each PR as its state allows and batching external waits (CI,
> Copilot) across all waiting PRs. Idle CI time on one PR never blocks review or
> fix-review on another. **Merges are serialized** — at most one PR merges at a
> time, because each merge triggers a safety check for every remaining in-flight PR
> (Step 4).

> **Stacked PRs are expanded into their ancestor chain and driven bottom-up.** If a
> selected PR's base is not the default branch it is stacked — it can't merge until
> the PR it's stacked on merges (after which GitHub retargets it). The skill walks
> the base→parent links down to the PR based on the default branch, then drives
> that chain bottom-up **through** the selected PR. It never drives PRs stacked _on
> top of_ the selected one — only ancestors. `A ← B ← C`, `/drive-to-merge B`
> drives A then B and stops; C (a descendant) is untouched.

## Step 1 — Validate all PRs up front

For each PR, fetch initial state in one call:

```
gh pr view <pr> --json number,title,isDraft,labels,mergeable,headRefOid,baseRefName,headRefName
```

Fetch the default branch once (`gh repo view --json defaultBranchRef --jq
.defaultBranchRef.name`).

**Hard stops** (surface the blocker and exit without processing any PR):

- `[WIP]` in the title → tell the user to drop the prefix when complete.
- `do not merge` / `dnm` label present → user-managed; never strip them.

`isDraft: true` is **not** a hard stop: a non-`[WIP]` draft is driven, and this
skill promotes it out of draft immediately at Step 2 (before the first review
round). Only a `[WIP]` draft is held.

A PR whose `baseRefName` is not the default branch is **not** a hard stop — it is
stacked, expanded in Step 1a. The hard stops apply to **every** PR driven,
including the ancestors that expansion discovers: if any ancestor is `[WIP]` or
carries `do not merge`/`dnm`, surface the blocker and exit (the stack can't
complete past a blocked ancestor anyway).

Carry each `headRefOid` forward — the CI check and the fix-review commit-guard key
on it.

## Step 1a — Expand stacked PRs

For each selected PR whose base is not the default branch, walk its ancestor chain:

1. **Fetch the open PR set once** (`gh pr list --state open --json
number,title,isDraft,labels,headRefName,baseRefName`) and map `headRefName` → PR.
2. **Walk down** from the selected PR: its base is branch X; the parent is the open
   PR whose head is X. Record `selected.parent = parentPR`, then repeat from the
   parent.
3. **Stop the walk** at a PR whose base is a valid merge target — either the
   **default branch** (bottom of the stack, no parent), or an **exempt accumulator
   branch** (a base whose tracking PR carries an `epic`/`release` label — a
   long-lived merge target the stacked-merge barrier doesn't apply across; the PR
   based on it is the bottom of the chain and merges directly into it, and the
   accumulator itself is never driven).
4. **Missing parent → hard stop.** If a base is neither the default branch, nor an
   exempt accumulator, nor the head of any open PR, the stack is broken: surface
   "PR #N is based on branch '<base>', which has no open PR — cannot drive the
   stack" and exit.

The **driving set** is the union, across selected PRs, of each PR and its ancestors
(deduplicated); record each PR's `parent`. **Only ancestors are added** — never
descendants. Continue to Step 2.

## Step 2 — Assign initial states

**Promote out of draft immediately.** For every non-`[WIP]` draft in the driving
set, run `gh pr ready <pr>` **now** — before assigning states and before the first
review round. Invoking `/drive-to-merge` is an explicit human decision to drive the
PR to merge, so this escape hatch un-drafts it up front (unlike the normal flow,
where `/review` promotes on approval). This is a sanctioned exception to the
"only `/review` promotes out of draft" rule, scoped to this skill.

Then determine each PR's starting state:

- **PRs with an unmerged parent** start in **`blocked_on_parent`** — held until
  their parent merges (a stacked PR can't merge while its base is another open PR's
  branch). Don't check their CI yet.
- **Every other PR** gets its state from CI: run `gh pr checks <pr> --json
name,state`. Any check in-progress/queued, or no checks yet → **`awaiting_ci`**.
  All checks terminal (success/failure/cancelled/neutral) with at least one check →
  **`ready_review`**.

Then enter the scheduler loop.

## Step 3 — Concurrent scheduler loop

One state per PR; run until every PR is terminal (`merged` or `blocked`).

| State               | Meaning                                                                            |
| ------------------- | ---------------------------------------------------------------------------------- |
| `blocked_on_parent` | Stacked PR held until its parent merges; not actionable, not a waiter              |
| `awaiting_ci`       | Waiting for CI to reach a terminal state                                           |
| `ready_review`      | CI terminal; ready to invoke `/review`                                             |
| `awaiting_copilot`  | `/review` approved but a Copilot review is still pending                           |
| `ready_fix`         | `/review` returned `soft_reject`; ready to invoke `/fix-review`                    |
| `approved`          | `/review` approved and Copilot is complete; ready to `/merge`                      |
| `merged`            | Squash-merged — terminal                                                           |
| `blocked`           | Author input needed, iteration cap, no-commit fix-review, merge failure — terminal |

**Each round:**

1. **Collect actionable PRs** (`ready_review`, `ready_fix`, `approved`), in the
   original argument order.
2. **Dispatch each** (one Skill call at a time — invocations are sequential; the
   concurrency comes from batching waits in Step 3a):
   - **`ready_review`**: check `ai-pr-summary` for a pending-Copilot signal first;
     if set, go to `awaiting_copilot` without calling `/review`. Otherwise invoke
     `/review <pr>` and read its **reported outcome**:
     - **`approve`** → if a Copilot review is still pending (`ai-pr-summary`),
       `awaiting_copilot`; else `approved`.
     - **`soft_reject`** → `ready_fix`. Increment this PR's iteration count.
     - **`hard_reject`** → `blocked`. Tell the user the PR needs author input
       (design, CI-loosening, obviation, credentials, security choice).
     - **`no_op`** → the review guard stopped it (CI not terminal on the current
       HEAD) → back to `awaiting_ci`.
     - **`error`** → `blocked`. Report "/review could not complete".
   - **`ready_fix`**: capture `headRefOid`, invoke `/fix-review <pr>`, re-fetch
     `headRefOid`:
     - changed → `awaiting_ci` (new commit; CI must run before the next review).
     - unchanged → `blocked`. Report "/fix-review pushed no commits — manual
       intervention required".
   - **`approved`**: invoke `/merge <pr>`, then confirm with `gh pr view <pr> --json
state,mergedAt,mergeCommit`: - `state: MERGED` → `merged`. Apply the post-merge safety check (Step 4) to all
     remaining non-terminal PRs before continuing. - anything else → `blocked`. Report what `/merge` found.
3. **Iteration ceiling**: each PR may enter `ready_review` at most **3 times**. A
   fourth entry → `blocked` instead, logging the outcome seen at each iteration.
4. **No actionable PRs, some waiting** (`awaiting_ci`/`awaiting_copilot`) → Step 3a.
5. **No actionable, none waiting, some `blocked_on_parent`**: their parent reached a
   terminal `blocked` and will never merge — cascade each to `blocked` ("parent PR
   #P is blocked, so stacked PR #C cannot be driven") and re-check the exit
   condition.
6. **All `merged`/`blocked`** → exit and report each PR's final outcome.

## Step 3a — Batch wait

When no actionable work remains, batch-wait across all waiters at once (background
process + the harness's completion notification; see the waiting guidance in
`~/.claude/CLAUDE.md`):

- **CI waiters** (`awaiting_ci`): `wait-for-ci.py --any <pr…>`. On the completion
  notification, transition each cleared PR to `ready_review` and re-enter Step 3.
- **Copilot waiters** (`awaiting_copilot`): `wait-for-copilot-review.py --any
<pr…>`. When cleared, re-read `ai-pr-summary`: no longer awaiting → `approved`;
  still awaiting (more Copilot reviews pending) → stay `awaiting_copilot`.
- **Mixed**: start both; the first notification re-enters the scheduler for its
  group, the other keeps running and notifies for its group. Both are valid
  re-entry points.

Exit codes for both: `0` met; `1` = 1-hour timeout (surface the stall and stop);
`2` = invocation failure (report and stop).

## Step 4 — Post-merge safety check

Immediately after any PR transitions to `merged`, apply the three-signal check to
every remaining non-terminal PR — the merged commit may conflict with an in-flight
PR's diff, needing a branch update first. (Same logic as the coordinator's
branch-update check.)

1. **Remaining PR carries `breaking change`** — the label (not the `!` title
   marker) is the source of truth; a sync confirms compatibility with new main.
2. **The just-merged commit's title carries a `!` breaking marker** — a breaking
   change landed on main since this PR was last reviewed.
3. **Non-doc file overlap** — compare `gh pr diff <pr> --name-only` against the
   merged commit's files (`gh pr view <merged-pr> --json files --jq
'[.files[].path]'`). Any non-doc file in both → sync needed. Exclude `*.md` and
   anything under `docs/`.

**If any signal fires**: log which (and the overlapping files for signal 3), update
the branch server-side (`gh api repos/{owner}/{repo}/pulls/<pr>/update-branch
--method PUT`), and transition the PR to `awaiting_ci` regardless of its current
state (even `approved` — the update invalidates the prior review and restarts CI).

**If none fires**: the PR's state is unchanged — being behind main is not a blocker
when the changes are non-overlapping and non-breaking.

### Release stacked children

After the check, release any driving-set PR whose `parent` is the just-merged PR (a
direct child held in `blocked_on_parent`). GitHub auto-retargets the child to the
default branch on parent-merge, so it's now a normal PR. For each:

1. **Confirm the retarget** (`gh pr view <child> --json baseRefName` should now be
   the default branch). If not yet retargeted, wait briefly and re-check; if it
   never retargets, surface the anomaly and leave the child in `blocked_on_parent`.
2. **Update the child's branch onto fresh main** (`gh api
repos/{owner}/{repo}/pulls/<child>/update-branch --method PUT`) — pulls the
   parent's changes in and restarts CI. A conflict → `blocked` ("stacked child #C
   conflicts with the default branch after parent #P merged — manual rebase
   required").
3. **Clear the parent pointer and go to `awaiting_ci`** — the child is now ordinary,
   and the new commit means CI must run before review.

This drives the stack sequentially: each child starts its cycle only after its
parent merges. Re-enter the scheduler loop.

## Notes

- **Idempotent re-runs**: re-invoking re-reads live PR state and re-initializes the
  state machine. Merged PRs are skipped; remaining PRs resume at the state their
  live review/CI state implies.
- **Stacked re-runs self-heal**: Step 1a re-expands and re-reads each base live, so
  a re-run after a partial-stack merge sees merged ancestors as merged and the
  once-stacked child now based on the default branch, and simply resumes the rest.
- **Manual interruption is safe**: every iteration boundary is between blocking
  Skill calls; killing the session leaves PRs in coherent states, and the next run
  picks up from live state.
- **Merges are serialized** — `/merge` for `approved` is dispatched one PR at a
  time, each triggering the safety check for all remaining PRs first.
- **No coordinator coordination**: this skill does not check for a running
  coordinator. If both drive the same PR, you get duplicate `/review` /
  `/fix-review` calls. Use it only when the coordinator is **not** running here, or
  pause it first.
