---
name: dependabot-fix-issue
description: Judge whether a red Dependabot PR needs an accompanying code change, classify why, and author a linkable fix issue — not the Dependabot mechanics (PR Shepherd owns those).
---

# dependabot-fix-issue

A Dependabot version bump is mechanical, but some bumps go red because the new
version **requires a code change the bot cannot make** — a new lint rule to
satisfy, a renamed/removed API to migrate, a stricter type to annotate, a
compatibility shim. This skill is the **judgment + authoring craft** for turning
such a failure into a clear, deduped fix issue.

It owns only the judgment. The Dependabot **mechanics** — sweeping PRs, spawning
fix PRs, rebasing/recreating branches, merge arbitration — belong to PR Shepherd
and are **not** in scope here. This skill is runner-agnostic: it expresses a
drafted issue (or a "no fix issue warranted" verdict) and does not bake in PR
Shepherd's outcome marker or its own posting. Direct-harness mode posts via
`@rmartz/github`.

## Step 1 — Confirm the failure is fixable by a code change

Before authoring anything, **rule out the two cases where a fix issue is the
wrong answer**:

1. **Non-fixable infrastructure failure.** If the checks failed in seconds with
   no step output — billing / spending-limit lapse, `startup_failure`, a runner
   that was never allocated, Actions disabled at the org — no code change can fix
   it. Do **not** file a fix issue; this needs the user to fix billing or runner
   capacity. Surface it as an escalation instead.
2. **Flaky / transient failure.** If re-running the check would plausibly pass
   (a known-flaky test, a transient network blip), there is nothing to fix. Don't
   file an issue for a flake; note it for the tracking ledger if it recurs.

Only when the failure is a **genuine, deterministic consequence of the bump**
does a fix issue belong. Read enough of the failing check's output to be
confident of the root cause — do not guess.

## Step 2 — Classify why the bump needs a change

Pick the category that best fits; it shapes the issue's guidance:

| Category             | Signal                                                             |
| -------------------- | ------------------------------------------------------------------ |
| `lint-rule`          | New/tightened lint rule now fails on existing code.                |
| `type-error`         | Stricter types surface a type error.                               |
| `breaking-api`       | A used API was renamed / moved / removed upstream.                 |
| `compatibility-shim` | Config shape, peer range, or import path needs a small adjustment. |
| `test-failure`       | The new version changes behaviour an existing test asserts.        |
| `unknown`            | Root cause not yet pinned down — guidance says "diagnose first".   |

## Step 3 — Author the fix issue (deduped)

- **Dedup first.** A second fix issue for the same Dependabot PR splits the work.
  Search open issues for the stable fragment `Dependabot #<N>` (the library's
  `createDependabotFixIssue` does this via `findOpenIssue`); if one is open,
  report it and stop.
- The body must carry the back-link line `Fixes Dependabot PR #<N>` so the
  eventual fix PR links to the bump (this is the convention PR Shepherd's
  mechanics parse).
- State the **manifest guardrail** explicitly: the fix touches **application code
  only** — never `package.json` or the lockfile. Dependabot owns the version bump;
  a foreign edit to its branch's manifest breaks its rebase/recreate flow.
- Give acceptance criteria: root cause identified, fix in app code only, local
  verification (lint/typecheck/test) passes, fix PR opened linking back.

The library does all of this for you — call
`createDependabotFixIssue(repo, { prNumber, dependency, toVersion, fromVersion,
category, failingCheck, failureExcerpt, labels })`. It dedups, renders title +
body, and creates the issue (soft-failing to `null`). `buildDependabotFixIssue`
renders without posting if you only need the draft.

## Step 4 — Report

Report the issue's number and URL (the result's `outcome` distinguishes
`created` vs. `existing` vs. `failed`). Render PR/issue numbers as markdown links
in chat (`[#49](…)`), never bare `#N`. If you authored the issue on the user's
behalf, sign the body footer with your full model name: `\n\n---\n*Created by
<model>*`.
