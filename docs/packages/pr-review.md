---
type: Library
title: pr-review
description: Layer-2 PR-review craft — review context helpers and the Dependabot risk-assessment heuristic, composing @rmartz/github and @rmartz/agent-runtime.
resource: packages/pr-review/src/index.ts
tags: [composed, pr-review, dependabot, review, craft]
---

# @rmartz/pr-review

Review _craft_ as a library: the reads a reviewer performs to understand a PR, and
the judgment that classifies a Dependabot bump's risk. Layer-2 — it composes
`@rmartz/github` (PR summary, diff, comment/thread writes) and
`@rmartz/agent-runtime` (`boundedRun` for the gap reads), and nothing above it.

It is **craft, not coordination**: it knows nothing about gate/verdict labels,
routing, the merge path, or any coordinator's outcome-marker format. The companion
`review` skill (`skills/review.md`, documented at `docs/skills/review.md`) turns
these primitives into a verdict; PR Shepherd composes both.

## Surface

### Review context (`context-helpers.ts`)

- `fetchSummary(repo, prNumber)` / `diffSinceLastReview(base, head, repo?, opts?)`
  — thin re-exports of `@rmartz/github`'s `fetchPrSummary` / `computePrDiff`, so a
  reviewer imports one module.
- `listPrReviews(repo, prNumber)` — a PR's reviews, body text dropped (only
  `{id, state, submittedAt, commitId, user}`), sorted most-recent first.
- `lastAuthoritativeReview(reviews)` — the most recent **non-Copilot** review, or
  `null`. Copilot reviews are advisory and never set the incremental-diff baseline.
- `listIssueComments(repo, prNumber)` — the PR's conversation comments
  (`{id, author, body}`), the visual gate's input.
- `extractScreenshotUrls(comments)` — unique uploaded-image URLs, order-stable so
  the skill's screenshot counter is deterministic. Pure.

All reads **soft-fail** to `[]`/`null`, mirroring the `@rmartz/github` client's
posture — a context gap never crashes a review pass.

> **`@rmartz/github` read-helper gap.** `listPrReviews`, `listIssueComments`, and
> the screenshot read have no `@rmartz/github` equivalent, so they call
> `boundedRun('gh', …)` here directly. If other layer-2 packages need the same
> reads, promote them into `@rmartz/github` (alongside `fetchPrSummary` in
> `pr-summary.ts`).

### Dependabot risk judgment (`dependabot-risk.ts`)

- `assessDependabotRisk(bump)` → `{ level, reasons, semverChange }`. Pure. Lifts
  the high-risk-vs-safe criteria from dotfiles' `dependabot.md` fast path:
  - **`high`** — a semver-major bump (breaking API surface tests can't catch),
    flagged extra when the package is CI-sensitive tooling.
  - **`review`** — a `github_actions` workflow bump (an automation lacking the
    `workflows` OAuth scope can't merge it) or a minor bump of CI-sensitive
    tooling (`black`, `ruff`, `eslint`, `pylint`, `prettier`, `typescript`, …).
  - **`safe`** — lockfile-only refreshes and ordinary minor/patch bumps.
- `classifySemverChange(from, to)` → `major | minor | patch | none | unknown`,
  tolerant of `^`/`~`/`v` prefixes.

## Verdict mapping

The `review` skill maps its analysis onto the runner-agnostic outcome enum
(`approve` / `soft_reject` / `hard_reject` / `no_op` / `error`); the Dependabot
assessment feeds that (`safe` → `approve`, `review`/`high` → `soft_reject`). The
library never posts or emits a marker — emission is the runner's. See
`docs/pr-shepherd-handoff.md`.

## Testing

Hermetic: tests `vi.mock('@rmartz/github')` and `vi.mock('@rmartz/agent-runtime')`
so no `gh` subprocess or network call ever runs (deny-by-default). The Dependabot
heuristic is pure and tested without mocks.
