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
`@rmartz/github` (PR summary, diff, review history, comments, comment/thread
writes) and nothing above it.

It is **craft, not coordination**: it knows nothing about gate/verdict labels,
routing, the merge path, or any coordinator's outcome-marker format. The companion
`review` skill (`skills/review.md`, documented at `docs/skills/review.md`) turns
these primitives into a verdict; PR Shepherd composes both.

## Surface

### Review context (`context-helpers.ts`)

- `fetchSummary(repo, prNumber)` / `diffSinceLastReview(base, head, repo?, opts?)`
  — thin re-exports of `@rmartz/github`'s `fetchPrSummary` / `computePrDiff`, so a
  reviewer imports one module.
- `listPrReviews(repo, prNumber)` / `listIssueComments(repo, prNumber)` —
  re-exports of `@rmartz/github`'s review-history and conversation-comment reads,
  so a reviewer imports one module.
- `lastAuthoritativeReview(reviews)` — the most recent **non-Copilot** review, or
  `null`. Copilot reviews are advisory and never set the incremental-diff baseline.
- `extractScreenshotUrls(comments)` — unique uploaded-image URLs, order-stable so
  the skill's screenshot counter is deterministic. Pure.

All reads **soft-fail** to `[]`/`null`, mirroring the `@rmartz/github` client's
posture — a context gap never crashes a review pass. The review-history and
comment reads were promoted into `@rmartz/github` (`listPrReviews`,
`listIssueComments`) in #25; the screenshot/authoritative-review logic stays here
as review craft.

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
- `parseBumpFromDiff(diff, name)` → `{ fromVersion?, toVersion? }`. Reads the
  **actual** version change of `name` from a unified diff's `package.json`
  dependency line — the source of truth. `{}` when the diff doesn't pin the version
  (e.g. lockfile-only).
- `verifyDependabotBump(name, diff, claimed)` → `{ fromVersion?, toVersion?, titleMisstated, note? }`.
  **Trust but verify**: reconciles the bump Dependabot _claims_ (in its title/description) against
  the diff. Returns diff-derived versions when the diff pins the version (the source of truth),
  falling back to the claimed versions for lockfile-only PRs where the diff can't verify. Dependabot
  has been seen to misstate the from-version (envctl#27: title `3.9.1 → 3.9.4`, diff
  `3.8.4 → 3.9.4`), under-stating the delta and the risk. The review composes this **before**
  `assessDependabotRisk` and re-titles the PR from the diff on a mismatch.

## Verdict mapping

The `review` skill maps its analysis onto the runner-agnostic outcome enum
(`approve` / `soft_reject` / `hard_reject` / `no_op` / `error`); the Dependabot
assessment feeds that (`safe` → `approve`, `review`/`high` → `soft_reject`). The
library never posts or emits a marker — emission is the runner's. See
`docs/pr-shepherd-handoff.md`.

## Testing

Hermetic: tests `vi.mock('@rmartz/github')` so no `gh` subprocess or network call
ever runs (deny-by-default) — context-helpers is a pure composition over the
client. The Dependabot heuristic is pure and tested without mocks.
