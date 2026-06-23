---
type: Library
title: github
description: Layer-0 GitHub client — REST-first issue/label ops, rate-limit backoff, PR summary, and Discussions.
resource: packages/github/src/index.ts
tags: [foundation, github, issues, labels, rate-limit]
---

# @rmartz/github

The shared GitHub client every higher layer composes. Layer-0: it imports only
`@rmartz/agent-runtime` (for `boundedRun`) and nothing else internal. It knows
nothing about PR Shepherd's gate/verdict labels.

## Design: REST-first with GraphQL fallback

GitHub's REST and GraphQL APIs draw from **separate** hourly rate-limit pools.
Every issue/label op prefers the REST endpoint (`gh api`) and, only on a
rate-limit error, falls back to the equivalent GraphQL `gh` subcommand — so
exhausting one pool degrades to the other rather than failing. Transient (non
rate-limit) failures are retried with bounded exponential backoff. All ops
**soft-fail to `null`** rather than throwing, matching the tracking/self-report
callers' posture. The shared transport core is `ghCall(primary, fallback, opts)`
in `gh-call.ts`.

## Surface

### Issue ops (`issue-ops.ts`)

- `findOpenIssue(repo, { label?, titleEquals?, titlePrefix?, titleContains? })` —
  first matching open issue URL, or `null`. Matching is **client-side** (exact),
  so it is reliable regardless of GitHub's fuzzy server-side title search. PRs
  excluded.
- `createIssue(repo, { title, body, labels? })` — new issue URL, or `null`.
- `addIssueComment(repo, issue, body)` — comment URL, or `null`. Named to avoid
  colliding with the Discussions `addComment`.
- `addAssignees(repo, issue, assignees)` — `null` on empty list or failure.

`issue` accepts a number or an issue/PR URL (`issueNumber()` normalizes it).

### Labels (`labels.ts`)

- `listLabels(repo)` — `Label[]` (`{ name, color, description }`) or `null`.
  Accepts both the REST primary's NDJSON and the fallback's single array.
- `createLabel` / `updateLabel` (with `{ newName }` to rename in place) /
  `addLabels` / `removeLabel`. Colors are sent without a leading `#` (REST
  requirement); label names are URL-encoded into REST paths.

### Rate-limit coordinator (`rate-limit.ts`)

- `readRateLimitState(path?)` / `writeRateLimitState(state, path?)` —
  cross-process state shared by tools using one auth token. The Python original
  used `fcntl.flock`, which Node lacks; writers here serialize via an atomic
  temp-write + `rename` (atomic on POSIX), so readers never see a torn file and
  concurrent writers settle last-writer-wins. Path is overridable via the
  `GH_RATE_LIMIT_STATE` env var (default `<tmpdir>/gh-rate-limit-state.json`).
- `rateLimitGuard(apiType?, { path?, sleep?, log? })` — best-effort courtesy
  backoff before an API call: `< 100` remaining → warn + 10–30 s; `< 300` →
  1–5 s; otherwise no-op. Returns immediately when state is absent or stale, so
  callers must never depend on it for correctness.

### Read craft (`pr-summary.ts`, `pr-reads.ts`, `pr-diff.ts`, `repo-status.ts`)

- `fetchPrSummary(repo, prNumber)` — coordination-relevant PR metadata.
- `listPrReviews(repo, prNumber)` — a PR's reviews, body text dropped (only
  `{id, state, submittedAt, commitId, user}`), sorted most-recent first. REST-only
  (review history has no clean `gh` subcommand fallback); soft-fails to `[]`.
- `listIssueComments(repo, prNumber)` — the PR's conversation comments
  (`{id, author, body}`) across all pages (`gh api --paginate`); soft-fails to `[]`.
- `computePrDiff(baseSha, headSha, repo?, { warn? })` — the review diff between
  two commits, returned as formatted patch text. When the range contains a merge
  commit it walks the branch's **first-parent chain** so a `main` pull doesn't
  flood the diff: clean merges collapse to a one-line note, but any file the
  merge changed relative to **both** parents (a conflict resolution / evil merge)
  is surfaced with its patch. Falls back to a single unified diff when there is no
  merge commit, the chain can't be reconstructed, or the compare is truncated
  (>250 commits). `repo` defaults to the git remote (`currentRepo`).
- `gatherRepoStatus({ cwd? })` — open issues (blocked/manual filtered, deps
  parsed from the body), milestones, and open PRs with resolved closing-issue
  numbers (same-repo closing refs → `feat/issue-<N>-*` branch → `Closes #N` body).
  Keys are camelCase TS-native (not the Python snake_case).

### Write craft (`pr-comment.ts`, `threads.ts`)

- `postPrComment(repo, pr, body, { model?, skillMeta? })` — post a plain comment
  with the `_<model>_` signing footer and (optionally) a pre-rendered hidden
  skill-meta marker. Transport is `addIssueComment` (REST-first + fallback);
  soft-fails to `null`. The marker is produced by `renderSkillMeta` in
  `@rmartz/agent-runtime`; the `ai-pr-comment` CLI exposes it as
  `--skill-meta <marker>`. **Resolving** the marker's fields (PR-head, the
  dispatcher's skill-file hash, the coordinator transcript / start time) is the
  dispatcher's job (PR Shepherd) — coordinator- and harness-specific — so this
  layer renders and posts but does not auto-resolve.
- `resolveThread(threadId)` — resolve a review thread by its `PRRT_` node ID
  (GraphQL; thread resolution has no REST equivalent).
- `dismissThread(threadId, replyBody)` — **reply-before-resolve**: post a visible
  reply, then resolve. Returns `'ok'` / `'reply_only'` (reply landed, resolve
  failed — retry `resolveThread` without re-posting) / `'failed'`. Single-shot
  (no retry) so a non-idempotent reply POST is never duplicated.

### PR-write primitives (`pr-ops.ts`)

- `submitReview(repo, pr, event, { body? })` — submit a review (`APPROVE` /
  `COMMENT` / `REQUEST_CHANGES`). Consumed by `@rmartz/pr-review` (#23).
- `mergePullRequest(repo, pr, method?)` — the raw merge call, returning the merge
  `sha` (or `true` when absent). The **gated, serialized** merge path (mutex,
  idempotency, re-validation) is PR Shepherd's; this is only the primitive it
  composes. Both are thin, label-free, gate-free client wrappers.

### Discussions (`discussions.ts`)

- `findDiscussionByTitle` / `createDiscussion` / `addComment` / `markAnswer` /
  `listCategories` — the GraphQL Discussions client, targeting `rmartz/ai`.

### Shared

- `currentRepo({ cwd? })` — resolve the current `owner/repo` from the git remote.

## CLIs

Thin `bin/` wrappers; all logic stays in the library: `ai-pr-summary`,
`ai-pr-diff <base> <head> [owner/repo]`, `ai-repo-status`,
`ai-pr-comment --model <m> [--keep-body] <pr> <body-or-file>`,
`ai-resolve-thread <id>…`, `ai-dismiss-thread <id> <reply>`.

## Re-homing

- `ci-status` (#10) and `branch-currency` (#11) — **re-homed to PR Shepherd**, not
  this repo (decided). `ci_status.py` consumes a PR-Shepherd GraphQL projection and
  is already implemented natively in pr-shepherd Epic 10; `branch_currency.py` is
  orchestration (imports routing / merge / tracking), owned by pr-shepherd #104.

## Testing

All boundaries are mocked: tests `vi.mock('@rmartz/agent-runtime')` so no `gh`
subprocess ever runs (deny-by-default, the spirit of dotfiles' `_hermetic.py`).
Backoff/guard sleeps are injectable so tests assert the chosen delay band
without waiting.
