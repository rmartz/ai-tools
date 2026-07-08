---
name: synthesize-review
description: Meta-analyze every review and comment on a pull request — decide which are legitimate, inaccurate, or deferrable, reach the single routing verdict, and emit the triaged action list fix-review executes.
---

Synthesize the reviews on the pull request: $ARGUMENTS

---

> **Tooling**: this skill is the review cycle's **arbiter**. `review` and
> `dependabot-review` produce _findings_; Copilot and humans post _threads_. This
> skill reads **all** of them at once, decides which are legitimate vs inaccurate
> vs deferrable, reaches the **one routing verdict**, and emits the **action
> list** `fix-review` executes. It composes `@rmartz/pr-review`'s context helpers
> (`listPrReviews`, `listIssueComments`, thread reads) and `@rmartz/github` reads.
> Prefer `mcp__github__*` where one exists.

> **Emission (read this first).** Your entire output is **declarative data** — the
> verdict plus a triaged action list. _Deciding_ a disposition and _doing_ it are
> separate responsibilities, and this skill owns only the deciding: for every
> thread you emit `{ disposition, replyText }`, never a call to
> `ai-resolve-thread` / `ai-dismiss-thread`; for every title/description rewrite
> you emit the replacement _text_, never `gh pr edit`. A direct-harness run
> expresses this record and a thin executor performs the posting/resolving; a
> coordinator (PR Shepherd) renders and posts it. Never emit a coordinator's
> marker format, and never apply gate/UAT/verdict labels — those belong to the
> runner. **UAT is not your call** either: whether a human must test is a separate
> gate the coordinator owns.

> **Branch immutability**: never modify the PR branch. If it needs a rebase or
> conflict resolution, say so in the verdict; branch mutation is the coordinator's.

## Step 1 — Setup: gather every input

Get PR metadata with `ai-pr-summary $ARGUMENTS` (number, title, draft, labels,
mergeability, CI state). Then collect the full picture:

- **Findings** from `review` / `dependabot-review` for the current head — read
  them from the review-cycle store. _(Placeholder contract: the findings-record
  format and where it lives are being finalized with PR Shepherd — see
  `docs/pr-shepherd-handoff.md`. Until then, treat the most recent findings record
  on the PR as the input.)_
- **Existing threads** — open inline threads and their authors (`ai-pr-summary` /
  `listIssueComments`), including Copilot and human reviewers.
- **Prior verdict**, if any, and which of its required items each still-open
  thread corresponds to.

## Step 2 — Guard: is there anything to synthesize yet?

Reach a **no-op** verdict (and stop) when:

- **CI has not reached a terminal state** (queued / in progress / not reported) —
  synthesizing mid-flight is wasteful.
- **The title contains `[WIP]`** — work is still in progress.

A no-op still emits its verdict record, never exits silently. Do **not** no-op on
a CI _failure_: a CI failure is a signal to weigh, and the findings may already
diagnose it.

## Step 3 — Triage every item

Classify each finding and each thread. For a thread, link it by its GitHub URL
(`[path line N (author)](URL)`), never the raw `PRRT_xxx` node id, and assign a
disposition:

- **legit → fix** — a real issue this PR must address. Goes onto the action list
  as a required change with the fix guidance; the thread stays open.
- **legit but pre-existing / out-of-scope → defer** — a real issue not caused by
  this PR (or a large-scope enhancement while the linked issue's criteria are
  still met). File a tracking issue (as an action-list entry — the actual filing
  is delegated) and set the thread to resolve-with-a-reply pointing at it.
- **inaccurate / overcautious → dismiss** — misreads the code or an intentional
  pattern. Emit `replyText` explaining why, disposition `dismiss` (reply-then-
  resolve is performed downstream). Never silently resolve — a dismissal without a
  reply leaves no reasoning.
- **already fixed → resolve** — a later commit addressed it; `replyText` names the
  fixing commit.
- **tracked elsewhere → resolve** — belongs to a parent/stacked PR; `replyText`
  says where.
- **duplicate → merge** — collapse into the canonical item; dismiss the duplicate
  thread with a pointer.

**Copilot threads** get the same triage but never drive scope: a Copilot concern
that points at new code and describes a real correctness bug is **legit → fix**;
one about untouched code is **defer**; a misread is **dismiss**.

**Deferral rules** (the arbiter's core judgment):

- **May be deferred**: pre-existing bugs/smells in untouched code; documentation
  gaps not caused by this change; out-of-scope functionality; large-scope
  enhancements (linked criteria still met); accurate-but-not-yet-relevant
  scalability concerns (defer + file, never dismiss).
- **Must never be deferred** (these keep the verdict below `approve`): bugs _this
  PR introduced_; missed acceptance criteria; a **new call site this PR adds to a
  known-buggy/known-limited helper** (new risk, not "pre-existing"); materially
  better/safer/simpler patterns; docs gaps this PR introduced; any code-quality or
  project-defined-convention violation appearing in this PR's own diff;
  low-hanging-fruit optimizations in code the PR touches; and overlapping/
  duplicated functionality this PR introduces.

## Step 4 — Reach the one routing verdict

Fold the triage into exactly one outcome — **every pass ends here**; a pass that
reaches no verdict strands the PR:

| Situation                                                  | Outcome       |
| ---------------------------------------------------------- | ------------- |
| Nothing legit outstanding — clean and safe to merge        | `approve`     |
| Legit items a follow-up fix pass can address               | `soft_reject` |
| Items needing the author's judgment (design, CI loosening, | `hard_reject` |
| obviation, credentials, a security choice)                 |               |
| Guard stopped the pass (CI not terminal, `[WIP]`)          | `no_op`       |
| The pass could not complete (tooling/transient failure)    | `error`       |

`approve` requires every still-open thread resolved and no `blocking` or
`needs-human-input` finding surviving triage.

## Step 5 — Emit the verdict and action list

Express one record (the single terminal action):

- **`verdict`** — one of the outcomes above, with a one-sentence rationale.
- **`threadDispositions`** — per thread: `{ url, disposition, replyText }`.
- **`actionList`** — for `fix-review`: the required changes (each with location and
  fix guidance), the issues to file for deferred items, and any title/description
  **`suggestedText`** to apply. This is the machine-readable hand-off; its exact
  shape is the **placeholder contract** being finalized with PR Shepherd
  (`docs/pr-shepherd-handoff.md`).
- **`reviewBody`** — the human-readable summary a direct run would post: `## Prior
items` (✅/❌ per preceding required change), `## Requested changes` (one bullet
  each, self-contained), `## Verdict` (one sentence), `## Deferred` (optional, each
  linked to its filed issue).

Do not post, resolve, edit, or label anything. Report the verdict and action list
to the caller.
