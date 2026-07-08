---
type: Skill
title: synthesize-review
description: The review cycle's arbiter — meta-analyze every finding and comment on a PR, decide which are legit/inaccurate/deferrable, reach the one routing verdict, and emit the triaged action list fix-review executes.
resource: skills/synthesize-review.md
tags: [pr-review, skill, review, craft, triage, verdict]
---

# `/synthesize-review`

The review cycle's **arbiter**, and the significant new skill of the split.
[`review`](review.md) and [`dependabot-review`](dependabot-review.md) produce
_findings_; Copilot and humans post _threads_. `synthesize-review` reads **all** of
them at once, decides which are legitimate vs inaccurate vs deferrable, reaches the
**one routing verdict**, and emits the **action list** `fix-review` executes. The
routing verdict lives here, not in `review` — only the arbiter sees every
reviewer, so only it can decide merge-readiness. It composes `@rmartz/pr-review`'s
context helpers and `@rmartz/github` reads.

## Emission

The entire output is **declarative data** — a verdict plus a triaged action list.
_Deciding_ a disposition and _doing_ it are separate: for every thread the skill
emits `{ disposition, replyText }` (never an `ai-resolve-thread` call), and for
every title/description rewrite it emits the replacement _text_ (never `gh pr
edit`). A direct run expresses the record and a thin executor performs the
posting/resolving; a coordinator (PR Shepherd) renders and posts it. No labels, no
UAT decision, no coordinator marker format.

The verdict maps onto the same outcome enum the coordinator's Skill Outcome
Protocol consumes (`docs/pr-shepherd-handoff.md`): `approve` / `soft_reject` /
`hard_reject` / `no_op` / `error`.

## Flow

1. **Setup** — gather every input: the `review` / `dependabot-review` findings for
   the current head (from the review-cycle store), the open threads and their
   authors, and any prior verdict.
2. **Guard** — `no_op` when CI is not terminal or the title is `[WIP]`; a CI
   _failure_ does not stop the pass.
3. **Triage** — classify each finding and thread: legit→fix, pre-existing/
   out-of-scope→defer (file a tracking issue), inaccurate→dismiss (with a reply),
   already-fixed / tracked-elsewhere→resolve, duplicate→merge. Copilot threads are
   triaged the same way but never drive scope. Applies the may-defer / never-defer
   rules that are the arbiter's core judgment.
4. **Verdict** — fold the triage into exactly one outcome; `approve` requires every
   thread resolved and no surviving `blocking` / `needs-human-input` finding.
5. **Emit** — one record: the `verdict`, per-thread `threadDispositions`, the
   machine-readable `actionList` for `fix-review`, and the human-readable
   `reviewBody` (Prior items / Requested changes / Verdict / Deferred).

## Contract status

The **findings-record** input format and the **action-list** hand-off to
`fix-review` are a placeholder pending coordination with PR Shepherd, which owns
the review-cycle store boundary (`docs/pr-shepherd-handoff.md`). The verdict enum
and the "express, don't post" seam are stable; the payload shapes are being
finalized in the design discussion.

## See also

- [`review`](review.md) / [`dependabot-review`](dependabot-review.md) — produce the
  findings this skill triages.
- The delegation contract — `docs/pr-shepherd-handoff.md`.
