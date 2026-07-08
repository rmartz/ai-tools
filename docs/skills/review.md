---
type: Skill
title: review
description: The PR-review skill — analyze the diff, hunt the classic missed-bug patterns, and emit findings. Triage and the routing verdict belong to synthesize-review.
resource: skills/review.md
tags: [pr-review, skill, review, craft, findings]
---

# `/review`

Review _craft_, narrowed to one responsibility: **produce findings on the diff**.
It analyzes the change, runs an adversarial second pass over the touched files and
their changed call sites, and emits a set of declarative findings. It does **not**
triage existing threads, reconcile multiple reviewers, or reach the routing
verdict — those are [`synthesize-review`](synthesize-review.md)'s job, which
consumes these findings. It composes `@rmartz/pr-review` (context helpers) and
`@rmartz/github` (reads).

This is one of three skills the single-purpose `review` was split into:
`review` (this — findings on a human PR), [`dependabot-review`](dependabot-review.md)
(findings on an automated bump), and [`synthesize-review`](synthesize-review.md)
(triage + verdict + action list). Dependabot PRs are out of scope here.

## Emission

The skill produces **findings** and stops — it never posts them, mutates the PR,
resolves a thread, or decides merge. Each finding is declarative data; _deciding_
a finding and _acting_ on it are separate responsibilities, and this skill owns
only the deciding. A direct run expresses the findings and a thin executor records
them; a coordinator captures them into the review-cycle store `synthesize-review`
reads.

Each finding carries a `category`, a proposed `severity`
(`blocking` / `non-blocking` / `needs-human-input` — a proposal, not the verdict),
a `location` for threading, a `summary`, and optional `suggestedText` (a
title/description replacement or an obvious code fix).

## Flow

1. **Setup & diff scope** — resolve the PR (`ai-pr-summary`), set the baseline with
   `listPrReviews` + `lastAuthoritativeReview` (Copilot reviews are informational),
   and pick a full or incremental diff via `ai-pr-diff`. Branch-immutable
   throughout.
2. **Review the diff** — title/description vs. the diff (as a `suggestedText`
   finding, not an inline edit), acceptance criteria, an overlap search for
   duplicated functionality, conventions (ai-tools' layer boundaries,
   library-first, file-size, hermetic tests, OKF docs), correctness, coverage, an
   **adversarial second pass** (the classic missed-bug patterns), file/naming
   coherence, tombstone specs, CI-loosening, obviation, and the visual gate
   (`extractScreenshotUrls`).
3. **Emit the findings** — express them as declarative data (an empty record when
   nothing was found), with the diff scope, for `synthesize-review` to consume.

## See also

- [`synthesize-review`](synthesize-review.md) — consumes these findings.
- `@rmartz/pr-review` library — `docs/packages/pr-review.md`.
- The delegation contract — `docs/pr-shepherd-handoff.md`.
