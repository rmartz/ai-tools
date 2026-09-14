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

## Labels (visibility)

- **`update required`** — the staleness verdict (`needsUpdate`).
- **`merge conflict`** — `gh` reports the PR as `CONFLICTING`.

Each run reconciles both: it adds the labels that apply and removes the ones that
no longer do, so a PR that a rebase makes safe is cleared automatically.

## The workflow (`.github/workflows/merge-safety.yml`)

- **`pull_request`** (opened / synchronize / reopened) and **`workflow_dispatch`**
  → **evaluate** one PR and resolve its check-run.
- **`push` to `main`** → **invalidate**: for every _other_ open PR, flip its
  check-run to **pending** (a pending required check blocks auto-merge) and
  dispatch that PR's own evaluate run. A PR only goes green again once its own
  run finishes against the moved base — so the base moving holds a second PR's
  auto-merge until this action re-runs for it.

Splitting invalidation (cheap, O(1) calls per PR) from evaluation (the git-diff
work, done per-PR in parallel) keeps the push path fast, which minimizes the
window described below.

## CLI

```
ai-merge-safety evaluate --pr <n> [--repo <owner/repo>] [--base <ref>] [--cwd <path>]
ai-merge-safety invalidate [--exclude <n>] [--repo <owner/repo>] [--cwd <path>]
```

`evaluate` fails **safe**: if facts can't be gathered (bad merge-base, etc.) it
posts `failure` rather than leave a stale green that could auto-merge.

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
