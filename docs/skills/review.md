---
type: Skill
title: review
description: The PR-review skill — assemble review context, address every open thread, analyze the diff, and reach a runner-agnostic verdict.
resource: skills/review.md
tags: [pr-review, skill, review, craft, dependabot]
---

# `/review`

Review _craft_: the judgment a reviewer applies to a pull request, expressed as a
single verdict. It composes `@rmartz/pr-review` (context helpers + Dependabot risk
assessment) and `@rmartz/github` (reads + the `submitReview` / `postPrComment`
write primitives). It owns the **how-to-review**, not the coordination around it —
routing, gates, verdict-label reconciliation, UAT, and merge belong to the
coordinator (PR Shepherd), which spawns this skill by name.

## Runner-agnostic emission

The skill reaches a verdict and stops; how that verdict is _recorded_ depends on
who ran it:

- **Direct (harness) run** — the skill posts the verdict itself via
  `@rmartz/github`: `submitReview(repo, pr, event, { body })`, plus
  `postPrComment` / the `ai-pr-comment` CLI for status notes.
- **Coordinator-dispatched run** — the skill's GitHub credentials are scrubbed
  and it **must not post**. It only expresses the verdict; the engine renders and
  posts the outcome record.

So the skill describes the **judgment + verdict** but bakes in **no** coordinator
marker format, gate semantics, or label names. The verdict maps onto a small
outcome enum:

| Verdict       | Meaning                                                           |
| ------------- | ----------------------------------------------------------------- |
| `approve`     | No outstanding issues — clean and safe to merge.                  |
| `soft_reject` | Issues a follow-up fix pass can address.                          |
| `hard_reject` | Needs the author's judgment (design, CI loosening, obviation, …). |
| `no_op`       | A guard stopped the pass (CI not terminal, `[WIP]`).              |
| `error`       | The pass could not complete (tooling / transient failure).        |

This is the same enum the coordinator's Skill Outcome Protocol consumes (see
`docs/pr-shepherd-handoff.md`, "Two contract boundaries"), so the skill is
portable across runners without knowing the protocol.

## Flow

1. **Setup** — resolve the PR, read its summary (`ai-pr-summary`). Stop with a
   `no_op` when CI is not terminal or the title is `[WIP]`; a CI _failure_ does
   not stop the pass. Branch-immutable throughout.
2. **Dependabot fast path** — for `dependabot[bot]`, run `assessDependabotRisk`;
   `safe` → `approve`, `review`/`high` → `soft_reject` with the specific risk.
3. **Diff scope** — `listPrReviews` + `lastAuthoritativeReview` set the baseline
   (Copilot reviews are informational); full vs. incremental diff via
   `ai-pr-diff`.
4. **Open threads** — address each (fixed / dismissed / tracked / still-open) via
   `ai-resolve-thread` / `ai-dismiss-thread`; Copilot threads are triaged first.
5. **Code review** — title/description, acceptance criteria, conventions
   (ai-tools' layer boundaries, library-first, file-size, hermetic tests, OKF
   docs), correctness, coverage, tombstone specs, CI-loosening, obviation, and
   the visual gate (`extractScreenshotUrls`).
6. **Verdict** — Prior items / Requested changes / Verdict / Deferred; UAT and
   labels are explicitly _not_ the reviewer's call.
7. **Express the verdict** — post it directly, or (dispatched) hand it to the
   engine.

## See also

- `@rmartz/pr-review` library — `docs/packages/pr-review.md`.
- The delegation contract — `docs/pr-shepherd-handoff.md`.
