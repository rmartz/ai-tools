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
- State the **manifest scope** explicitly. By **default the fix PR advances the
  offending bumped package itself** (plus any sibling that must move in lockstep)
  **to the version Dependabot targets, together with the code fix** — update
  `package.json` and regenerate the lockfile via `pnpm install` rather than editing
  it by hand, even when the code fix alone would compile against the old version.
  **Why bundle the bump instead of leaving it to Dependabot:** a fix that touches
  only application code leaves `main` on the _old_ version until Dependabot's bump
  merges later. In that window `main` is built and tested against the old version,
  so an unrelated PR can merge code the new version breaks — a regression that only
  surfaces when the bump finally lands. Advancing the package in the fix PR makes
  the new version take effect the instant the fix merges: CI thereafter tests
  everything against it, closing the window entirely.
- **Keep the manifest change minimal.** Bump only the package the fix is written
  against and any lockstep sibling — never an unrelated or opportunistic bump, and
  for a **grouped** Dependabot PR never the packages in the group the failure has
  nothing to do with (leave those for Dependabot). An application-code-only fix is
  acceptable **only** when the failure is genuinely independent of the version in
  play — nothing about the new version needs to be in effect for the fix to be
  correct; whenever the fix is written against the new version, advance that
  version.
- Note **how Dependabot reacts**: the coordinator's post-merge `@dependabot rebase`
  makes Dependabot reduce the grouped PR's scope (dropping the package(s) the fix
  advanced) or close it if nothing remains.
- Give acceptance criteria: root cause identified; the offending package advanced
  to its target version alongside the fix (or, in the version-independent case, a
  documented app-code-only fix); local verification (lint/typecheck/test) passes;
  fix PR opened linking back.

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
