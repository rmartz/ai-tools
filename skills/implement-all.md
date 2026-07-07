---
name: implement-all
description: Resolve a scope of issues (backlog / epic / label / explicit) and run /implement for each in turn — partitioning actionable vs in-flight vs blocked, dispatching stacked children off in-flight deps — until the scope is drained. Stops before review/merge.
---

Implement all actionable issues in the resolved scope: $ARGUMENTS

Resolve a scope of issues, then call `/implement` for each in turn until the
scope is drained. Review, fix-review, and merge are **not** part of this skill —
those are the coordinator's job.

---

> **Tooling**: this skill is scope-resolution + loop _craft_. `/implement` is the
> atomic unit of work — this skill never reimplements its TDD workflow. It
> composes `ai-repo-status` (`@rmartz/github` — issues, milestones, and the
> open-PR/closing-issue map that drives partitioning), `ai-new-worktree`
> (`@rmartz/worktree` — `/implement` uses `--base <branch>` to stack a child off
> an in-flight dep), and, on a direct run, `ai-create-issue` / `ai-create-pr`
> (`@rmartz/github`) for the issue/PR writes; prefer a GitHub MCP tool
> (`mcp__github__*`) where richer. It **stops once every actionable issue has a PR
> opened** — driving those PRs through review and merge is the coordinator's job.

> **Runner-agnostic emission.** This skill produces a set of **opened PRs** (plus
> a partition of what was skipped, stuck, or left blocked). A **direct** run does
> the work itself and reports; a **coordinator-dispatched** run expresses the same
> outcome and the engine records it. Either way, do not encode a coordinator's
> merge-barrier or routing markers — express the stacking _intent_ (a child PR
> based on its dep's branch) and let the runner order the merges.

## Step 0 — Parse arguments and resolve scope

`$ARGUMENTS` may include:

- **No issue references** — whole-backlog mode. Seed `scope_issues` from every
  issue in `ai-repo-status`'s `issues` list (all open issues except ones labeled
  `blocked` or `manual`). Don't assume it is actionable-filtered; Step 1 derives
  that.
- **Numeric issue references** (`42`, `#42`, a GitHub URL) — explicit-issue mode.
  For each:
  - **Epic detection** — an issue is an epic when an open milestone has the exact
    same title (case-insensitive, trimmed), from `ai-repo-status`'s `milestones`.
    If it matches, that milestone's open issues are the scope contribution (the
    epic issue itself excluded). An empty milestone → Step 0b.
  - **Non-epic** — include the issue itself.
- **A quoted string** (e.g. `"Tech Debt"`) — label mode: an exact label name.
  Fetch every open issue with it (`gh issue list --label "<label>" --state open
--json number,title --limit 100`). Zero found → exit `"No open issues with label
'<label>'"`. Print a one-line confirmation (`"Label scope: '<label>' — N
issue(s): #A, #B, …"`) before the loop. Multiple quoted strings union
  (deduplicated).
- **Non-numeric prose** (e.g. `all the UI tasks`) — interpret from available
  signals (issue timestamps, milestone titles, labels) into a concrete list. If
  ambiguous, ask once with the candidate list rather than guessing.
- **`skip-uat`** (flag) — passed verbatim to each `/implement` call; recorded in
  the final report.

Record the resolved scope as **scope_issues**. If empty, exit with a
"nothing to do" report.

## Step 0b — Sub-issue creation for empty epics

Only when an epic's milestone has zero open sub-issues (besides the epic itself):

1. Read the epic body. Find a markdown task list under a header (case-insensitive,
   in priority order): `Sub-issues`, `Sub issues`, `Subtasks`, `Sub-tasks`,
   `Tasks`; otherwise any top-level task list. Each `- [ ] <text>` is one sub-issue.
2. **No parseable task list** → surface `"#<epic>: empty milestone and no parseable
task list — create sub-issues manually (or add a 'Sub-issues' section) and
re-run."`, skip this epic, continue.
3. **Otherwise create one issue per item** — via `ai-create-issue` (or
   `mcp__github__issue_write`):
   - Title: the task text, cleaned (strip checkbox markers, trim, drop trailing
     punctuation).
   - Body: `Part of #<epic-number>.` plus any indented context under the task.
   - Milestone: the matching milestone; Labels: the epic's domain labels
     (Title Case) — skip status labels and `Epic`; leave unassigned (`/implement`
     assigns on pickup).
4. Add the new numbers to `scope_issues`.

## Step 1 — Initial state and partition

Run `ai-repo-status` once. Build:

- `openIssueNumbers` from `issues[].number`.
- `inFlightIssueNumbers` from `openPrs[].issueNumbers` (flattened).

A dep is **satisfied-for-stacking** when it is absent from `openIssueNumbers` (its
issue is closed) **or** present in `inFlightIssueNumbers` (it has an open PR) —
both count as "clear": a closed dep is merged, an in-flight dep can be stacked on.
Partition `scope_issues`:

- **`actionable`** — no open PR **and** every `dep` is satisfied-for-stacking.
- **`in_flight`** — its number is in `inFlightIssueNumbers`. Skipped — the PR
  already exists and the coordinator drives it. Never re-run `/implement`.
- **`blocked`** — everything else: blocked by a dep that is neither closed nor
  in-flight. Held aside; a dep unblocks its child as soon as it closes **or**
  opens a PR.

**Stacking (in-flight deps).** When a child is promoted on an **in-flight** (not
yet merged) dep, `/implement`'s stacked-PR detection branches it off that dep's PR
head — finding the dep's open PR via `openPrs[].issueNumbers` and using
`ai-new-worktree --base <dep-branch>` to stack. The coordinator then orders the
merges so each dep lands before its child. So a chain A→B→C with A, B in-flight
dispatches B stacked on A and C stacked on B **without waiting for any merge**. The
guard holds: a dep with **neither** a closed issue **nor** an open PR still blocks
the child — nothing to merge, nothing to stack on.

**Stale-worktree check (actionable issues).** Run `git worktree list --porcelain`
and inspect `.git-worktrees/issue-<N>/` for each actionable N:

- **Substantive committed work** (commits past `origin/main`): recover
  automatically —
  1. **Inspect HEAD** (`git -C .git-worktrees/issue-<N> log -1 --no-merges
--format=%s origin/main..HEAD`). A Conventional-Commits subject → a
     ready-for-review PR; otherwise a **draft** PR with a `[WIP]` title.
  2. **Push** `git -C .git-worktrees/issue-<N> push -u origin HEAD`; on failure
     take the failure path.
  3. **Resolve the recovery base from branch ancestry — do not hard-code `main`.**
     A stale worktree may have been created **stacked** on a dep's branch; a
     recovery PR against `main` would let the child merge ahead of its parent. Read
     the tracking ref (`git -C .git-worktrees/issue-<N> rev-parse --abbrev-ref
--symbolic-full-name @{u}`) and strip `origin/`; with no upstream, compare the
     branch's merge-base against the default branch vs. each open PR's head
     (`openPrs[].headRefName`) to find the head it was forked from. If that base is
     a non-default branch still backing an open PR, open with `--base <that-branch>`
     so the coordinator orders parent-before-child; otherwise target `main` (covers
     the normal case and a since-merged/deleted base — GitHub retargets to `main`).
  4. **Open the PR** with `ai-create-pr` (or `mcp__github__create_pull_request`)
     against the resolved base, with the draft/ready state + title.
  5. **Success** → move the issue `actionable` → `in_flight`; log
     `"issue #N: stale worktree recovered — pushed and opened PR <url>"`.
  6. **Failure** → preserve the worktree, drop from `actionable`, and note for the
     user (push failed → "branch not yet on origin — retry `git push`"; PR-create
     failed → "branch already pushed — retry `ai-create-pr`"). Don't re-run
     `/implement`.
- **Only uncommitted scratch / empty** → force-remove (two calls: `git worktree
remove --force .git-worktrees/issue-<N>`, then `git branch -D` the branch if it
  remains). `/implement` recreates it cleanly.

Initialize iteration state: `iteration = 0`, `max_iterations = 60` (safety cap),
`completed = []` (`{issue, prUrl, outcome, summary}`). Print a scope confirmation:

```
Scope: N issue(s) — A actionable, B in-flight (skipped), C blocked
  actionable: #1, #2, …
  in-flight (skipped): #3, #4, …  ← already have open PRs
  blocked: #5 (deps: #6), …
```

If `actionable` and `in_flight` are both empty, report "nothing actionable to
implement" and exit (all deps must land first — the coordinator's job).

## Step 2 — Iterative implementation loop

Repeat until termination or the safety cap:

1. **Safety cap** — increment `iteration`; if `> max_iterations`, stop with
   `MAX_ITERATIONS` and report `actionable` / `blocked` / `completed`.
2. **Pick** — if `actionable` is empty: if `blocked` is also empty, exit (done);
   else report the blocked issues and stop (no actionable work until the
   coordinator merges the blocking PRs). Otherwise pop the lowest-numbered issue.
3. **Implement** — invoke `/implement <issue>` (plus `skip-uat` if set) via the
   Skill tool and wait. Capture: **PR opened** → `PR_OPENED`; **draft/stuck** →
   `STUCK_AT_IMPLEMENT` (log the diagnosis; the coordinator may pick up the draft,
   but this loop won't retry); **no PR** → `FAILED` (log, continue).
4. **Re-evaluate blocked** — re-run `ai-repo-status`; rebuild `openIssueNumbers`
   and `inFlightIssueNumbers`. Promote any `blocked` issue whose every dep is now
   satisfied-for-stacking (and whose own number isn't in-flight) to `actionable` —
   this dispatches a child immediately after its dep opens a PR, stacked on that
   PR. In **whole-backlog mode**, also partition any newly-surfaced issue into the
   right bucket.
5. **Loop** back to 1.

## Step 3 — Final report

Group `completed` by outcome:

- **PRs opened** (`PR_OPENED`) — `#NNN — <title> — <URL>`; review/fix-review/merge
  are the coordinator's.
- **Stuck at implementation** (`STUCK_AT_IMPLEMENT`) — same + blocking reason; the
  draft PR is open for a follow-up fix pass.
- **Failed** (`FAILED`) — same + error; no PR opened.
- **Skipped (in-flight)** — issues that already had open PRs; the coordinator
  drives them.
- **Blocked (remaining)** — issues still blocked, with their open dep numbers.
- **Max iterations hit** — everything still in `actionable` / `blocked`.

Aggregate: total in scope, PRs opened, stuck, blocked remaining, iterations. Note
that the opened PRs now flow to the coordinator for review and merge.

## Behavior notes

- **`/implement` is the unit of work** — this skill only resolves scope, partitions
  issues, and loops; it never reimplements the TDD workflow.
- **No review, fix-review, or merge** — the coordinator's job. This skill stops
  once every actionable issue has a PR (or hit a failure state).
- **In-flight PRs are skipped** — an issue with an open PR is not re-implemented.
- **Blocked issues are deferred, not dropped** — a dep unblocks its child as soon
  as it is closed **or** opens a PR (not only on merge), so a sequential chain is
  dispatched as stacked PRs without merge waits; the coordinator orders the merges.
- **`skip-uat` is forwarded, not enforced** — the actual skip is the coordinator's
  to apply at merge.
- **Safety cap is per-scope** — `max_iterations = 60`; a single issue needs ~1, a
  10-issue backlog ~10–20 depending on dep chains.
