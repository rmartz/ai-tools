---
name: review
description: Review a pull request — assemble context, address every open thread, analyze the diff, and reach a verdict.
---

Review the pull request: $ARGUMENTS

---

> **Tooling**: this skill is review _craft_, not coordination. It composes
> `@rmartz/pr-review` (context helpers + Dependabot risk judgment) and
> `@rmartz/github` (reads + write primitives), exposed as the thin CLIs
> `ai-pr-summary`, `ai-pr-diff <base> <head> [owner/repo]`,
> `ai-pr-comment --model <m> <pr> <body-or-file>`, `ai-resolve-thread <id>…`, and
> `ai-dismiss-thread <id> <reply>`. Prefer GitHub MCP tools (`mcp__github__*`)
> where one exists; fall back to `gh` only when no equivalent is available.

> **Runner-agnostic emission (read this first).** This skill produces a
> **judgment** and a **verdict**. How that verdict is _recorded_ depends on the
> runner:
>
> - **Run directly by the harness**: you post the verdict yourself via
>   `@rmartz/github` — `submitReview(repo, pr, event, { body })` for the review
>   event and, where needed, `postPrComment(...)` / `ai-pr-comment` for status
>   notes; resolve/dismiss threads via `ai-resolve-thread` / `ai-dismiss-thread`.
> - **Dispatched by a coordinator (e.g. PR Shepherd)**: your GitHub credentials
>   are scrubbed and **you must not post**. You only _express_ the verdict; the
>   engine renders and posts the outcome record.
>
> Either way, **do not** hard-code any coordinator's marker format, label names,
> or gate semantics into your output. Phrase the verdict as one of the outcomes
> in the table at the end so it maps cleanly onto whatever the runner emits, and
> never invent gate/UAT/verdict labels — those belong to the coordinator, not to
> review craft.

## Step 1 — Setup

If no PR number is provided, list open PRs (`mcp__github__list_pull_requests` or
`gh pr list --json number,title,headRefName --state open`). If exactly one is
open, use it; if several are, list them and stop.

**Branch immutability**: this skill never modifies the PR branch — no pushes, no
rebases, no `update-branch`. If the branch needs updating or conflict
resolution, stop and report it as part of the verdict; branch mutation belongs to
the coordinator.

Get PR metadata with `ai-pr-summary $ARGUMENTS` (which calls `fetchPrSummary`):
number, title, state, draft, labels, mergeability. Then gather the rest of the
review context with `@rmartz/pr-review`'s context helpers (`listPrReviews`,
`listIssueComments`) or their reads.

Stop early — record a **no-op** verdict (see the outcome table) and report —
when:

- **CI has not reached a terminal state** (queued / in progress / not yet
  reported). Reviewing mid-flight is wasteful; wait for a terminal result.
- **The title contains `[WIP]`** — work is still in progress.

Do **not** stop for a CI _failure_: a first review must still happen on a
CI-failing PR so the reviewer can diagnose whether this PR's code caused the
failure and fold it into the verdict.

A pass that stops on a guard must still emit its verdict (a no-op), never exit
silently — silence is indistinguishable from a crash to the runner.

---

## Step 2 — Dependabot fast path

If the PR author is `dependabot[bot]`:

- If the title is not Conventional Commits (`chore(deps): …` / `chore(deps-dev): …`),
  rename it.
- Get the bump details (`gh pr diff $ARGUMENTS`) and feed them to
  `assessDependabotRisk` from `@rmartz/pr-review` (parse name, from/to version,
  ecosystem, lockfile-only, dev-dependency). Skip all code-quality, style, and
  convention checks — they do not apply to automated bumps.
- Map the assessment to a verdict:
  - **`safe`** → **approve** with no concerns. Dependabot PRs never need manual
    testing.
  - **`review`** or **`high`** → **soft reject**: post (or express) a concern
    describing the specific risk (`assessment.reasons`) and what to verify. A
    `github_actions` bump in particular cannot be merged by an automation lacking
    the `workflows` OAuth scope — say so.
- Then stop — do not continue to the remaining steps.

---

## Step 3 — Determine diff scope and get the diff

1. **Fetch review history** with `listPrReviews(repo, pr)`. It already drops body
   text (only `{id, state, submittedAt, commitId, user}`) and sorts most-recent
   first. Call `lastAuthoritativeReview(reviews)` to get `last_review` — the most
   recent **non-Copilot** review, or `null`. Copilot reviews are informational
   only (triaged in Step 4); they must never set `last_review` or drive the diff
   scope.
2. **Find the current HEAD** and the most recent author (non-web-flow) commit
   timestamp, `head_commit_at`.
3. **Choose the scope**:
   - **Full diff** if `last_review` is `null`, or no commit postdates it.
   - **Incremental diff** if `last_review` exists and a commit postdates it.
4. **Get the diff**:
   - **Full**: `gh pr diff $ARGUMENTS`.
   - **Incremental**: resolve `base_sha` (most recent commit predating
     `last_review.submittedAt`) and `head_sha` (HEAD), then
     `ai-pr-diff <base_sha> <head_sha> [owner/repo]` (`computePrDiff`). It walks
     the first-parent chain so a `main` merge doesn't flood the diff; treat any
     `[merge …]` note as informational context, not authored change.

Carry `last_review`, `head_commit_at`, and the scope into Steps 4–5.

---

## Step 4 — Address every open inline thread

For each open inline thread (from `ai-pr-summary` / `listIssueComments`):

1. **Link to it** by its GitHub URL (`[path line N (author)](URL)`), never by raw
   `PRRT_xxx` node ID.
2. **State one of four positions**:
   - **Already fixed** by a later commit → resolve with `ai-resolve-thread <id>`
     and note the fixing commit.
   - **Explicitly dismissed** (a deliberate decision not to act) →
     `ai-dismiss-thread <id> "<reasoning> — <model>"`, which posts a visible
     reply _then_ resolves (reply-before-resolve). Note the decision.
   - **Tracked elsewhere** (the concern belongs to a parent/stacked PR) → resolve
     and note where it is tracked.
   - **Still open and valid** → do **not** resolve; restate it in the verdict's
     required-changes list.

   > Never resolve a thread you believe is legitimate and should be fixed.
   > "Dismissed" means _you are choosing not to act_ — not "I agree, fix later".

**Copilot-authored threads** — triage before choosing:

- **Bug introduced by this PR** (the concern points at new code and describes a
  real correctness problem) → leave **still open**, restate as a required change.
- **Pre-existing** (code this PR did not touch) → dismiss with a reply
  (`ai-dismiss-thread`), record under **Deferred**.
- **Incorrect / overcautious** (misreads code or an intentional pattern) →
  dismiss with a concise explanation.

**Approval gate**: every still-open thread and every required change must be
resolved before the verdict can be **approve**.

---

## Step 5 — Code review

Analyze the diff and form findings covering:

- **Title and description vs. the diff — fix in place.** The title must be a
  Conventional-Commits summary of the _current_ diff, and the description must
  explain what/why plus any non-obvious decisions. If it is missing, stale,
  checklist-only, or placeholder text, **rewrite it yourself** (don't make it a
  required change and don't escalate over wording). Write a body file with the
  `Write` tool and `gh pr edit $ARGUMENTS --body-file <file>` /
  `mcp__github__update_pull_request`; never shell-construct the body. Escalate
  only when the text exposes a genuine _design_ disagreement.
- **Linked-issue acceptance criteria** — for each `Closes/Fixes/Resolves #N`,
  read the issue and check every criterion is implemented or explicitly scoped
  out. A neither-implemented-nor-discussed criterion is a required change.
- **Overview** — what the PR does. For any new utility, component, hook, or
  module it adds, **search the codebase for overlapping or duplicate
  functionality** (similar names, similar concepts — a new `formatDate()` should
  prompt a search for existing date helpers). Duplication _this PR introduces_ is
  a required change: consolidate with the existing implementation or justify the
  separate one. Pre-existing duplication the PR merely sits beside goes to
  **Deferred**.
- **Code quality & conventions** — flag only violations of rules in the
  project's own `CLAUDE.md` / `AGENTS.md` (for ai-tools: layer boundaries,
  dual-interface library-first, the ~240/480 file-size rule, hermetic tests,
  the OKF-doc-per-package requirement). Personal preferences are not enforceable.
- **Correctness & risks** — bugs, edge cases, security concerns, and any CI
  failure directly caused by this PR's code.
- **Test coverage** — meaningful gaps; mock real-world boundaries (`gh`, network,
  subprocess) — a test that reaches the network is a bug here.

**Adversarial second pass — read beyond the diff**: after the first pass, make a
targeted second pass hunting the classic missed-bug patterns. Don't re-read only
the hunks — **read the full files the diff touches, plus the call sites of any
function whose signature or behavior changed**. Hunt specifically for: type
mismatches at call sites (a changed signature/return type whose callers weren't
updated), async/await correctness (unawaited promises, missing error handlers on
async paths), null/undefined guards (optional data dereferenced without a check),
error propagation (errors swallowed or converted to success paths), mutation of
shared or immutable state, boundary and off-by-one conditions, and
resource/listener/subscription cleanup (anything acquired but never released).
Findings from this pass go to Requested changes like any other. Scale the effort
with the diff — on a large diff or a refactor this is where the highest-value
bugs hide; on a small targeted fix a quick scan of the touched files and their
callers suffices.

**File-structure & naming coherence**: every new file must sit where the
codebase's majority pattern puts similar code (utilities with utilities, hooks
with hooks, types where the repo places them), and every new name (file, export,
function) must be consistent with existing analogous names. This is coherence,
not a personal-preference quibble — deviation from the repo's _own dominant
pattern_ is enforceable as a required change. Flag only deviation from that
pattern; do not demand a layout the codebase itself does not follow.

**Tombstone specs**: for every spec file in the diff, a file whose every `it(` /
`test(` has an empty or comment-only body provides false coverage — require it be
removed or given real assertions.

**File-size / refactor-on-write**: measure each touched file _at HEAD_. Over the
project max (480 src / 720 test, ~240 target) without a clean extraction is a
required change once materially over; mirror the directive's tiers. The answer is
**extraction**, never terseness.

**CI workflow changes** (`.github/workflows/*.yml`): a change that **loosens** CI
(a removed step/job, `continue-on-error`, a narrowed trigger, a reduced matrix,
an extended timeout, or any ambiguous change) must stand **alone** and requires
human sign-off — flag it as **needs human input** (a hard reject), state plainly
that it loosens CI, and do not approve. A change that only **tightens** coverage
(steps added, action-version bumps, new triggers/matrix dims) reviews normally.

**Obviation check** (every pass): has a commit on `main` or a closed linked
issue already solved this PR's problem a different way? If so the PR is redundant
and not fix-able by automation — **needs human input** (hard reject); name the
obviating commit/PR/issue and state a human must close or scope it down.

**Visual review**: extract uploaded-image URLs from the PR's comments with
`extractScreenshotUrls(comments)`. For each, download (`curl -sL '<url>' -o
/tmp/pr-screenshot-<N>.png`) and view with `Read`. A runtime error overlay,
blank screen, broken layout, or HTTP error page is a required change; a plausibly
correct render is noted as visually verified. No images → skip silently.

**Incremental sign-off**: if the scope was incremental, no new issues were found,
and every prior thread is resolved, the new commits are clean. When this PR has
had more than one prior review cycle, do a one-time **whole-diff coherence read**
(`gh pr diff $ARGUMENTS`) for cross-commit inconsistencies, incomplete
migrations, and end-to-end acceptance — issues an incremental view cannot see. A
blocking coherence finding is a required change.

---

## Step 6 — Reach the verdict

Fold Steps 4–5 into a single verdict. The review body, when you post it (direct
runs), is organized as:

- **## Prior items** _(omit if none)_ — one `✅`/`❌` bullet per item from the
  immediately preceding review's required changes, linking the thread where one
  exists. `✅` addressed, `❌` still open.
- **## Requested changes** _(omit if none)_ — one 2–3-sentence bullet per item
  needing action: new findings plus full restatements of every `❌` prior item.
  A reader who sees only this section must understand every required change.
- **## Verdict** — one sentence: clean or what remains, and why.
- **## Deferred** _(optional)_ — issues consciously set aside this pass; file a
  GitHub issue for each (`mcp__github__issue_write` or the `/create-issue` skill)
  and link it, so they are tracked independently of this PR.

**What may be deferred**: pre-existing bugs/smells in untouched code (**but a new
call site this PR adds to a known-buggy or known-limited helper is new risk — a
required change, not deferrable as "pre-existing"**), documentation gaps not
caused by this change, out-of-scope functionality, large-scope enhancements (when
the linked issue's criteria are still met), and accurate-but-not-yet-relevant
scalability concerns (defer + file an issue, never dismiss inline). **What must
never be deferred** (these block approval): bugs _this PR introduced_, missed
acceptance criteria, materially better/safer/simpler patterns, docs gaps _this PR
introduced_, any code-quality violation that appears in this PR's own diff,
violations of a **project-defined style convention** (a rule the project's own
`CLAUDE.md` / `AGENTS.md` sets is a binding convention, not a personal
preference), **low-hanging-fruit optimizations in code the PR touches** (an
obvious, cheap win — a redundant loop, a repeated lookup, an unnecessary copy — is
applied now, not filed as future work; only high-effort or speculative
optimization is deferrable), and **overlapping or duplicated functionality this
PR introduces** (per the Overview overlap search — consolidate or justify before
merge).

**UAT is not your call.** Whether a human must test the change is a separate gate
owned by the PR author / coordinator. Do not apply UAT/verdict/gate labels —
record only the review verdict.

---

## Step 7 — Express the verdict (the single terminal action)

Map the analysis to exactly one outcome and express it. **Every pass ends here**
— a pass that reaches no verdict strands the PR.

| Situation                                            | Outcome       |
| ---------------------------------------------------- | ------------- |
| No outstanding issues — clean and safe to merge      | `approve`     |
| Issues a follow-up fix pass can address              | `soft_reject` |
| Issues needing the author's judgment (design, CI     | `hard_reject` |
| loosening, obviation, credentials, security choice)  |               |
| Guard stopped the pass (CI not terminal, `[WIP]`)    | `no_op`       |
| The pass could not complete (tooling/transient fail) | `error`       |

- **Direct (harness) run** — you post it yourself: call
  `submitReview(repo, pr, event, { body })` where `event` is `APPROVE`
  (`approve`), `REQUEST_CHANGES` (`soft_reject`/`hard_reject`), or `COMMENT`
  (`no_op`, or any self-authored PR where GitHub blocks approve/request-changes).
  Use `ai-pr-comment --model "<model>" <pr> <body-file>` for a plain status note.
  The model footer is appended for you; do not add a second footer.
- **Coordinator-dispatched run** — your credentials are scrubbed; **do not
  post**. Express the outcome above and let the engine record it. Do not emit any
  coordinator-specific marker — that is the engine's to render.

Then report the verdict and what drove it to the caller.
