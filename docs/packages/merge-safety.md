---
type: Script
title: merge-safety
description: A GitHub check that surfaces the coordinator's "must this PR be brought current before merge?" verdict, invalidated externally when the base moves — POC for conditional up-to-date merge gating.
resource: packages/pr-review/src/bin/merge-safety.ts
tags: [pr-review, ci, merge, coordinator, checks, poc]
---

# merge-safety

A **proof-of-concept** CI check that answers, per PR: _is this safe to merge as it
stands, or must it first be brought current against its base and re-run through
CI?_ It externalizes the coordinator's `_pr_needs_branch_update` decision as a
`merge-safety` check-run so the verdict is visible on the PR (and can act as a
required status), instead of living only inside PR Shepherd. Issue #185.

The judgment is the pure `evaluateMergeSafety` predicate in
[`@rmartz/pr-review`](./pr-review.md); this CLI only gathers facts, posts the
check-run, and reconciles labels.

## The predicate

A PR **must be brought current** when it is **not** already current **and** any of:

1. a **breaking** commit landed on the base since the PR's merge-base, or
2. a **`ci`-typed** commit landed on the base since merge-base (mirrors the
   coordinator's `ci`-prefix rebase trigger), or
3. the PR is **itself** breaking (`!` title marker or `breaking change` label), or
4. the PR's changed files **intersect** the files changed on the base since
   merge-base.

Clause 4 is a **narrowing** guard — it only ever forces _more_ PRs current. Git
can merge two diffs cleanly and still produce invalid code (an earlier PR deletes
a symbol this PR uses), so any file-level overlap forces a rebase + re-CI. A hard
git **conflict** is folded in as a separate axis, with its own label.

### Report detail — naming the specifics

Each triggering reason names _which_ commits and files caused it, as nested
bullets under the reason:

- **Clauses 1 & 2** (breaking / `ci` on the base) list the offending base
  commits as `<abbrev-sha> <subject>`, so you can see exactly what landed since
  merge-base.
- **Clause 4** (file overlap) lists the overlapping paths — the PR-changed files
  that also changed on the base.

`gatherMergeSafetyFacts` fetches these from the same `git log`/`git diff` it
already runs (`git log` now captures `%H` alongside `%B`), so the detail costs no
extra git calls. `MergeSafetyFacts` carries the `baseBreakingCommits` /
`baseCiCommits` / `overlappingFiles` lists beside the booleans they drive, and
`evaluateMergeSafety` renders them into the reasons. The one-line check-run
**summary** stays the headline sentence only; the specifics live in the reasons
detail below it.

## Labels (visibility)

- **`update required`** — the staleness verdict (`needsUpdate`).
- **`merge conflict`** — `gh` reports the PR as `CONFLICTING`.

Each run reconciles both: it adds the labels that apply and removes the ones that
no longer do, so a PR that a rebase makes safe is cleared automatically.

The check-run **title** carries the verdict at a glance — `No update required`,
`Update required`, `Merge conflict` (which wins the title when a PR is both
conflicting and stale), or `Could not evaluate`. The check-run **name** stays the
stable `merge-safety` so branch protection can match it; only the title varies.

## The workflow (`.github/workflows/merge-safety.yml`)

- **`pull_request`** (opened / synchronize / reopened / edited / labeled /
  unlabeled) and **`workflow_dispatch`** → **evaluate** one PR and resolve its
  check-run. A **labeled / unlabeled** event only runs when the label is
  `breaking change` (the one label that changes the verdict, by flipping
  `prIsBreaking`); every other label leaves the verdict unchanged, so its event is
  filtered out at the job's `if:` rather than spinning up a redundant run.
- **evaluate skips a non-open PR.** `evaluate` reads the PR's `state` and, for a
  `CLOSED` or `MERGED` PR, posts no check-run and reconciles no labels — a settled
  PR earns no verdict. (This is a deliberate skip, distinct from the
  `Could not evaluate` fail-safe, which is for an _open_ PR whose facts are
  ungatherable.) Together with the label filter above, this stops a post-merge
  label event from re-stamping an already-merged PR with a merge-safety label.
- **`push` to `main`** → **invalidate**: for every _other_ open PR, flip its
  check-run to **pending** (a pending required check blocks auto-merge) and
  dispatch that PR's own evaluate run. A PR only goes green again once its own
  run finishes against the moved base — so the base moving holds a second PR's
  auto-merge until this action re-runs for it.

Splitting invalidation (cheap, O(1) calls per PR) from evaluation (the git-diff
work, done per-PR in parallel) keeps the push path fast, which minimizes the
window described below.

The `evaluate` job **builds the tool from `main`, not the PR** — a gate must apply
the trusted, merged logic (immune to whether the PR compiles, and never running
PR-authored build scripts under its write-scoped token). The PR is consumed purely
as git data: the job fetches `pull/<n>/head` so `merge-base`/diffs resolve even on
the dispatched (`workflow_dispatch`) path, which checks out `main` and would
otherwise lack the head.

## CLI

```
ai-merge-safety evaluate --pr <n> [--json] [--repo <owner/repo>] [--base <ref>] [--cwd <path>]
ai-merge-safety invalidate [--exclude <n>] [--repo <owner/repo>] [--cwd <path>]
```

`evaluate` fails **safe**: if facts can't be gathered (bad merge-base, etc.) it
posts `failure` rather than leave a stale green that could auto-merge.

### Decision-only mode (`--json`)

`evaluate --pr <n> --json` (alias `--dry-run`) prints the `MergeSafetyDecision`
as JSON to stdout and performs **no side effects** — no check-run is posted and no
labels are reconciled. This is the seam the coordinator consumes (dotfiles#1524):
it asks for the **verdict** (`needsUpdate` / `conclusion` / `reasons`) without the
emission, so it can share this one implementation instead of re-porting the
predicate.

Exit codes make the two outcomes distinguishable:

- **exit 0** — a real verdict was computed (even a `failure` / `needsUpdate` one);
  the JSON is the answer.
- **exit 1** — the PR was **ungatherable** (unreadable PR, bad merge-base, a failed
  git command); stdout still carries a fail-safe `failure`-shaped decision
  (`errorMergeSafetyDecision`), so a caller that trusts the verdict treats it as
  unsafe rather than green.

## Consuming the verdict (coordinators & merge automation)

`merge-safety` is **advisory by default** — it is a status check a repo may
_optionally_ promote to a required gate (see below), not one automation should
treat as blocking until it has. A merge coordinator (e.g. PR Shepherd /
`pr-route.py`) integrating with a repo that posts this check should:

- **Not treat a `merge-safety` failure as a blocking CI failure, and not escalate
  on it.** Its `failure` verdict is not a code problem — it means "bring the branch
  current," a routine action, not something a human must adjudicate. Exclude
  `merge-safety` from any "all required checks green" gate unless the repo has
  deliberately made it required.
- **Recognize that the verdict mirrors the coordinator's own currency logic.** The
  predicate is the externalized form of `_pr_needs_branch_update` (breaking on base
  / PR-breaking / `ci` on base / non-doc file overlap). A coordinator that already
  computes branch currency should treat `merge-safety` as a _reflection_ of that
  decision for human visibility — not a second, independent gate to satisfy. Acting
  on both double-counts the same signal.
- **Read the verdict headlessly rather than scraping the check UI:**
  `ai-merge-safety evaluate --pr <n> --json` returns the `MergeSafetyDecision`
  (`needsUpdate` / `conclusion` / `reasons`) with no side effects. Exit 0 = a real
  verdict; exit 1 = ungatherable (treat as unsafe). See the CLI section above.

**For a fix-review agent** (the SOP destination for a failing check): a
`merge-safety` failure whose only reason is `update required` (no `merge conflict`)
is resolved by **bringing the branch current and letting CI re-run — no code change
is expected** for the check itself. A clean sync makes the PR current, which clears
the verdict outright (`needsUpdate` can only be true while the branch is behind).
So treat "sync the branch, re-run" as the complete fix here; do **not** go hunting
for code to change. The two cases that _do_ need hands-on work announce themselves
separately: a `merge conflict` reason (resolve the conflict), or a genuine
incompatibility the update surfaces — which shows up as a **different** failing
check (typecheck/tests) after the re-run, handled by the normal fix-review flow.
That different-check failure is exactly what the overlap clause exists to catch.

Only once a repo opts into gating (next section) should automation treat the check
as merge-blocking — and even then, a coordinator that serializes merges remains the
authority (see the TOCTOU limitation below).

## Required-check setup

To make `merge-safety` a required status on the base branch:

1. **Trigger the check at least once** — GitHub can only select a status check for
   a branch-protection rule after it has been posted at least once on a commit
   targeting that branch. Open (or re-synchronize) a PR against the protected
   branch to produce the first `merge-safety` run.
2. **Add the required status** — go to **Settings → Branches → Branch protection
   rules** for the target branch, enable **Require status checks to pass before
   merging**, and search for / select **`merge-safety`** by that exact name.
3. **Verify** — the next PR opened against the branch should show a `merge-safety`
   check entry in the Checks panel. If it appears as "pending", the evaluate job is
   still running; if it shows "Required" next to it, the protection rule is active.

## Known limitation — the TOCTOU window (why this is a POC)

GitHub has **no synchronous pre-merge admission hook**, so a required check is
evaluated against its **last posted state**. Between PR-A merging (base moves) and
the invalidate job actually starting (runner cold-start, tens of seconds), PR-B's
check is still green and its auto-merge can fire on that stale pass. The
invalidate path shrinks — but cannot eliminate — this window.

The window is only _fully_ closable when the merge actor cooperates: the
**coordinator**, as part of merging PR-A, can set the other PRs' checks to pending
in the same step (no cold-start gap), or GitHub's native **merge queue** can
serialize merges (but it always re-tests the combined ref, discarding the
selective skip this check exists to provide). So the recommended posture is: keep
the coordinator the authoritative serialized merge actor, and use this check as
**externalized visibility + defense-in-depth**, not as the sole gate that
arbitrary human / auto-merge merges race against.
