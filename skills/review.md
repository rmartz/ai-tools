---
name: review
description: Perform the code review of a pull request — analyze the diff, hunt the classic missed-bug patterns, and emit findings. It does not triage existing comments or reach the routing verdict — that is synthesize-review.
---

Review the pull request: $ARGUMENTS

---

> **Tooling**: this skill is review _craft_, not coordination — and within the
> review cycle it does one thing: **produce findings on the diff**. It does
> **not** triage existing threads, reconcile multiple reviewers, or reach the
> routing verdict — those belong to `synthesize-review`, which consumes these
> findings. It composes `@rmartz/pr-review` (context helpers) and `@rmartz/github`
> (reads), exposed as the thin CLIs `ai-pr-summary`,
> `ai-pr-diff <base> <head> [owner/repo]`, and the review-history reads. Prefer
> GitHub MCP tools (`mcp__github__*`) where one exists; fall back to `gh` only when
> no equivalent is available.

> **Emission (read this first).** This skill produces a **set of findings** — it
> does not post them itself, and it never mutates the PR. Each finding is
> declarative data (see the schema at the end); _deciding_ a finding and _acting_
> on it are separate responsibilities, and this skill owns only the deciding.
> Direct-harness runs express the findings (a downstream executor records them);
> a coordinator captures them into the review-cycle store `synthesize-review`
> reads. Either way: no `submitReview`, no `gh pr edit`, no thread resolution, no
> gate/verdict/UAT labels — and **never** a merge/approve decision. That is
> `synthesize-review`'s call, made across _all_ reviewers, not yours alone.

> **Branch immutability**: this skill never modifies the PR branch — no pushes,
> no rebases, no `update-branch`. If the branch needs updating or conflict
> resolution, record it as a finding; branch mutation belongs to the coordinator.

> **Not for Dependabot PRs.** If the PR author is `dependabot[bot]`, stop — this
> skill does not apply. A dependency bump is reviewed by `dependabot-review`
> (bump verification + risk), which emits findings in the same schema.

## Step 1 — Setup and diff scope

If no PR number is provided, list open PRs (`mcp__github__list_pull_requests` or
`gh pr list --json number,title,headRefName --state open`); if exactly one is
open use it, otherwise list them and stop.

Get PR metadata with `ai-pr-summary $ARGUMENTS` (number, title, state, draft,
labels, mergeability). Then choose what to review:

1. **Fetch review history** with `listPrReviews(repo, pr)` and call
   `lastAuthoritativeReview(reviews)` to get `last_review` — the most recent
   **non-Copilot** review, or `null`. Copilot reviews never set `last_review`.
2. **Find the current HEAD** and the most recent author (non-web-flow) commit
   timestamp, `head_commit_at`.
3. **Choose the scope**:
   - **Full diff** if `last_review` is `null`, or no commit postdates it —
     `gh pr diff $ARGUMENTS`.
   - **Incremental diff** if `last_review` exists and a commit postdates it:
     resolve `base_sha` (most recent commit predating `last_review.submittedAt`)
     and `head_sha` (HEAD), then `ai-pr-diff <base_sha> <head_sha> [owner/repo]`
     (`computePrDiff`). It walks the first-parent chain so a `main` merge doesn't
     flood the diff; treat any `[merge …]` note as informational context.

Record the scope on the findings record so `synthesize-review` knows whether a
whole-diff coherence pass has happened.

## Step 2 — Review the diff

Analyze the diff and form findings covering:

- **Title and description vs. the diff.** The title should be a
  Conventional-Commits summary of the _current_ diff, and the description should
  explain what/why plus any non-obvious decisions. If it is missing, stale,
  checklist-only, or placeholder, emit a finding with the **suggested replacement
  text** — do not call `gh pr edit`; the rewrite is applied downstream. A genuine
  _design_ disagreement is a separate, higher-severity finding.
- **Linked-issue acceptance criteria** — for each `Closes/Fixes/Resolves #N`,
  read the issue and check every criterion is implemented or explicitly scoped
  out. A neither-implemented-nor-discussed criterion is a finding.
- **Overview & duplication** — for any new utility, component, hook, or module,
  **search the codebase for overlapping or duplicate functionality** (similar
  names, similar concepts — a new `formatDate()` should prompt a search for
  existing date helpers). Duplication _this PR introduces_ is a finding
  (consolidate or justify); note pre-existing duplication it merely sits beside
  separately, so triage can defer it.
- **Code quality & conventions** — flag only violations of rules in the project's
  own `CLAUDE.md` / `AGENTS.md` (for ai-tools: layer boundaries, dual-interface
  library-first, the ~240/480 file-size rule, hermetic tests, the OKF-doc
  requirement). Personal preferences are not findings.
- **Correctness & risks** — bugs, edge cases, security concerns, and any CI
  failure directly caused by this PR's code. (Do not skip a CI-failing PR — a
  finding that diagnoses whether this PR's code caused the failure is high value.)
- **Test coverage** — meaningful gaps; mock real-world boundaries (`gh`, network,
  subprocess) — a test that reaches the network is itself a finding.

**Adversarial second pass — read beyond the diff.** After the first pass, make a
targeted second pass hunting classic missed-bug patterns. Don't re-read only the
hunks — **read the full files the diff touches, plus the call sites of any
function whose signature or behavior changed**. Hunt for: type mismatches at call
sites (a changed signature/return type whose callers weren't updated),
async/await correctness (unawaited promises, missing error handlers), null/
undefined guards, error propagation (errors swallowed or converted to success),
mutation of shared/immutable state, boundary and off-by-one conditions, and
resource/listener/subscription cleanup. Scale the effort with the diff — on a
large diff or refactor this is where the highest-value bugs hide.

**File-structure & naming coherence** — every new file must sit where the
codebase's majority pattern puts similar code, and every new name must be
consistent with existing analogous names. Flag deviation from the repo's _own
dominant pattern_ (coherence, not preference).

**Tombstone specs** — a spec file whose every `it(` / `test(` has an empty or
comment-only body provides false coverage; emit a finding to remove it or give it
real assertions.

**File-size / refactor-on-write** — measure each touched file _at HEAD_.
Materially over the project max (480 src / 720 test, ~240 target) without a clean
extraction is a finding; the answer is **extraction**, never terseness.

**CI workflow changes** (`.github/workflows/*.yml`) — a change that **loosens** CI
(a removed step/job, `continue-on-error`, a narrowed trigger, a reduced matrix, an
extended timeout, or any ambiguous change) is a **needs-human-input** finding:
state plainly that it loosens CI. A change that only **tightens** coverage reviews
normally.

**Obviation check** — has a commit on `main` or a closed linked issue already
solved this PR's problem a different way? If so it is a **needs-human-input**
finding; name the obviating commit/PR/issue.

**Visual review** — extract uploaded-image URLs with
`extractScreenshotUrls(comments)`; for each, download
(`curl -sL '<url>' -o /tmp/pr-screenshot-<N>.png`) and view with `Read`. A runtime
error overlay, blank screen, broken layout, or HTTP error page is a finding; a
plausibly correct render is noted as visually verified. No images → skip silently.

**Whole-diff coherence** — when the scope is incremental and this PR has had more
than one prior review cycle, do a one-time whole-diff read (`gh pr diff
$ARGUMENTS`) for cross-commit inconsistencies, incomplete migrations, and
end-to-end acceptance an incremental view cannot see. A blocking coherence issue
is a finding.

## Step 3 — Emit the findings

Express the findings as declarative data — **the single terminal action**. A pass
that reviews but emits nothing (when it found nothing) still emits an empty
findings record, never exits silently; silence is indistinguishable from a crash.

Each finding carries:

- `category` — one of `correctness` · `security` · `test-coverage` ·
  `duplication` · `convention` · `file-size` · `structure` · `acceptance` ·
  `title-description` · `ci-loosening` · `obviation` · `visual` ·
  `dependency-bump`.
- `severity` — the reviewer's honest read: `blocking` (must be addressed before
  merge), `non-blocking` (a real issue that could be deferred), or
  `needs-human-input` (design disagreement, CI loosening, obviation, a
  credentials/security judgment). **This is a proposal, not the verdict** —
  `synthesize-review` makes the final legit/defer/dismiss call across all
  reviewers.
- `location` — `path` and `line`/hunk where it applies, for threading downstream.
- `summary` — 1–3 sentences a reader can act on without re-deriving the context.
- `suggestedText` _(when applicable)_ — for a title/description finding, the exact
  replacement to apply; for a code finding, the concrete fix if there is an
  obvious one.

Do not rank, dedupe against existing threads, or decide what is deferrable —
`synthesize-review` does that. Then report the findings (and the diff scope) to
the caller.
