---
name: implement
description: Implement a GitHub issue end to end — verify the premise, survey for existing overlap, design before writing tests, implement to green, and self-review for duplication before handing off.
---

Implement the GitHub issue(s): $ARGUMENTS

---

> **Tooling**: this skill is implementation _craft_, not coordination. It owns
> the **what** — understanding the issue, surveying for reuse, designing the
> approach, writing tests that encode that design, implementing to green, and
> self-reviewing for duplication. It does **not** own the wider coordination that
> surrounds a merge — gate/verdict labels, milestone assignment, and where the PR
> travels after it is handed off ready. Never name a gate/verdict label. The
> mechanical spine composes the maintained `ai-*` CLIs: `ai-new-worktree`
> (`@rmartz/worktree`) to provision the isolated worktree, `ai-pre-push-verify`
> (`@rmartz/verify`) to re-run the project's own CI-derived checks before
> hand-off, and `ai-create-pr` / `ai-create-issue` (`@rmartz/github`) for the PR
> and any issue write. Prefer a GitHub MCP tool (`mcp__github__*`) where it is
> richer (e.g. reading an issue body); fall back to `gh` only where neither a CLI
> nor an MCP tool fits.
>
> **Assumption**: the project tests with **Vitest**. This skill designs the
> approach, then writes tests that validate that design, then implements until
> they pass. Cap the implementation at ~15 iterations before declaring stuck.

> **Emission (read this first).** This skill produces a **working branch and an
> outcome** — implemented-and-ready, or stuck-with-a-diagnosis — and opens the PR
> itself. Provision the worktree with `ai-new-worktree`, commit in it, and open
> the PR with `ai-create-pr`. You open the PR only **once the implementation is
> done**, so **open it ready for review** (`ai-create-pr`, no `--draft`) — a
> finished implementation is ready for another agent to pick up for
> review/fix-review/merge, and there is no draft step to remember. **Draft is a
> narrow edge case, not the default:** open a draft (with a `[WIP]` title) **only**
> when you are stopping with the work genuinely _unfinished_ — you were told to
> abort midway, or you hit the stuck path (see Step 6) — to preserve partial
> progress. Never leave finished work as a draft. Do not invent gate/verdict
> labels — those belong to whoever coordinates the PR afterward; keep the title a
> Conventional-Commit summary.
>
> This skill **stops when the implementation is done** — it never reviews,
> fix-reviews, or merges its own work. Do not invoke a review or merge skill from
> within it.

## Step 0 — Resolve the issue reference(s)

`$ARGUMENTS` may be a full GitHub URL, a bare number (`123` / `#123`), or several
references separated by spaces or commas. All must belong to the current repo;
cross-repo concurrent implementation is out of scope. Resolve the repo from the
URL, or read the current repo's metadata when the reference is bare.

- **One issue** → continue below.
- **Several issues** → each is an independent unit of work on its own branch.
  Dispatch one worker per issue in parallel, each in its own isolated worktree,
  each following Steps 1–6 for its single issue. Because distinct issues live on
  distinct branches, the one-session-per-branch rule holds automatically. Wait
  for all workers, then aggregate outcomes into a single hand-off.

When you dispatch workers, remember they start with a **fresh context** and do
not inherit the ambient rules — restate in each worker's prompt any convention it
must honor (Bash hygiene, worktree-under-`.git-worktrees/`, the GitHub-MCP-first
preference, and the "stop at implementation; do not review or merge" boundary),
and enumerate the tool permissions it will need up front so it never stalls
mid-run on a missing grant.

## Step 1 — Understand the issue and its acceptance criteria

Read the issue in full. Extract its acceptance criteria in priority order:

1. A checklist under a heading like "Acceptance Criteria", "Definition of Done",
   "Requirements", or "Criteria" — each item is one criterion.
2. Otherwise, the numbered or bulleted requirements stated elsewhere in the body.
3. If neither exists, **derive** 2–4 concrete, behavioral criteria from the title
   and description and write them out explicitly before continuing.

Record the criteria as a numbered list. Every test you write and every claim you
make about "done" maps back to exactly one criterion — this is the contract the
implementation is measured against.

## Step 2 — Verify the premise before writing anything

Do not assume the issue is correct. An automated report may misread a race, a
trace may mislead, or the issue may be filed against behavior that has since
changed. Confirm the premise against the code _before_ committing to an approach:

1. **Restate the claim** in a sentence or two — the bug it describes, the gap it
   identifies, or the rationale for the feature.
2. **Verify against the code** — read the files the issue references (and the
   most relevant source you can find). Does the described behavior, bug, or gap
   actually exist as stated? For a feature, confirm the capability genuinely does
   not already exist and the stated rationale holds.
3. **If the code contradicts the premise, stop.** Do not invent a root cause to
   justify proceeding. Record the discrepancy — what the code actually does vs.
   what the issue claims — and surface it (a comment on the issue asking for
   clarification) rather than implementing against a false premise.
4. **If the premise holds** — or cannot be contradicted, as with a net-new
   feature that has no prior behavior to check — continue.

The strongest signal a problem is real is independent reports over a meaningful
span; a single automated report is the weakest. Weight your scrutiny accordingly.

## Step 3 — Explore the codebase

Before writing tests, read enough of the project to stop guessing:

- **Test conventions** — read 2–3 existing test files. Note import style, render
  helpers, `describe`/`it` usage, custom matchers, and setup files (global
  jest-dom, `user-event` availability). Mirror these exactly; the finished code
  should look like the codebase's original author wrote it.
- **Runner invocation** — how tests are run in this repo (the project's `test`
  script, or `vitest run` directly).
- **Relevant source** — identify the files each criterion will touch, and record
  their paths.

## Step 3b — Survey for existing overlap, then decide reuse vs. extend vs. new

Building a second copy of something the codebase already has is a **defect**, not
a style nit — and the only place to catch it cheaply is here, before any new code
exists. So before designing:

1. **Name the concern(s)** — distill the issue into its core concerns, a few
   words each ("date formatting", "HTTP retry", "session state", "label lookup").
2. **Search for existing coverage** — for each concern, search exports, function
   names, and filenames for helpers, utilities, services, or modules that already
   address part of the need. Search by **synonym** as well as the issue's exact
   wording; the existing code may name the same concept differently.
3. **Read the strongest candidates** — read the one or two most promising matches
   in full. Understand what they cover, what they don't, and how they're invoked.
4. **Decide explicitly**, and record the decision in writing:
   - **Reuse as-is** — an existing helper already does the job; call it.
   - **Extend** — an existing module covers part of the need; extend it rather
     than standing up a parallel one.
   - **Genuinely new** — nothing overlaps; new code is justified.

Carry this decision and the candidates you weighed into the hand-off — it is the
core of the change's technical rationale.

## Step 4 — Design the approach, then write failing tests

**Design before tests.** Settle the shape first, so the tests encode a deliberate
design rather than an improvised one:

- **Placement** — decide where the implementation lives, consistent with the
  repo's structure and with the reuse/extend/new decision from Step 3b.
- **Interface** — sketch the intended signature, props shape, or module surface,
  and check it against how comparable code in the repo exposes itself (naming,
  parameter conventions, return shapes).
- **Exemplar** — pick one or two existing modules doing similar work and mirror
  their structure: imports, error handling, export style, test layout.

Then write the tests, co-located per the repo's convention and mirroring an
existing test file's import style. Structure them **one group per criterion**,
named for the criterion, with the minimum tests that prove it satisfied. Keep
them **hermetic** — mock every real-world boundary (network, subprocess, `gh`); a
test that reaches the real network is a bug. Prefer real user-interaction helpers
over low-level event firing where the project supports them.

Run the suite once to confirm every new test is **red** for the right reason. Fix
any import/syntax failures now; tighten any test that passes before the
implementation exists. This red baseline is what proves, later, that your code is
what turned them green.

## Step 5 — Implement to green

Iterate — implement, run, diagnose, fix — until every test passes or you hit the
~15-iteration cap:

- **Implement only what the tests demand.** No untested features; no refactoring
  of unrelated code.
- **Diagnose before fixing.** Read the actual failure message and apply the
  narrowest change that addresses it, rather than guessing. Common Vitest/DOM
  traps: number inputs stringify (assert `Number(input.value)`, not `=== 42`);
  a missing `await` on an async interaction leaves stale UI; a missing jest-dom
  setup import breaks matchers; an unresolved promise reads as a timeout.
- **Keep quality green as you go.** Periodically run the project's typecheck and
  lint over the changed files and fix what this change introduced; do not let
  errors pile up to the end. Pre-existing warnings in untouched files may stay.
- **Detect stuck.** If two consecutive iterations produce the same failing tests
  with no gain, stop iterating and take the stuck path below.

**All green** → run the full suite once to confirm no regression, fix any test
this change broke, and verify the change locally with `ai-pre-push-verify`
(`@rmartz/verify`): it reads the project's own CI workflows and re-runs their
locally-runnable checks (typecheck / lint / format / tests), so a green result
predicts CI. Hand off only work that passes it.

**Stuck** → stop and write a clear account: which criteria are covered (passing),
which still fail (with exact messages), and a one-line diagnosis of the blocker
(framework limitation, missing dependency, unclear requirement, architectural
wall). The hand-off carries this diagnosis so a human or a follow-up pass can act
on it without re-deriving it.

## Step 6 — Self-review for duplication, then hand off

**Duplication self-review — the last guard before handing off.** Diff your own
branch against the base and read the added lines. For every added block of logic
ask:

- Is this logic already in the codebase under a different name?
- Could an existing helper have been called instead of the code I just wrote?

If either is yes, **consolidate** — call or extend the existing code and delete
the duplicate. This is the final net for a parallel implementation that Step 3b's
survey missed; it is cheaper to catch here than in review.

Then hand off. Commit the work in the worktree and open the PR yourself with
`ai-create-pr` — **ready for review**, no `--draft` — with a Conventional-Commit
title summarizing the change and a body (written to a file, passed as
`--body <file>`) stating the purpose, the reuse/extend/new decision from Step 3b,
which criteria pass, and the issue it closes. You reached this step because the
implementation is done, so the PR is immediately ready for another agent to pick
up for review → fix-review → merge — there is no separate "mark ready" step to
remember.

**Only the stuck/abort path opens a draft.** If you take the stuck path and choose to
open a PR at all to preserve partial progress, open it as a **draft** with a
`[WIP]` title — the work is genuinely unfinished, so it is not ready for pickup —
and report the diagnosis. Draft is reserved for this unfinished-work case (and the
told-to-abort-midway case); it is never the state of a completed implementation.

**This skill stops here.** Opening the ready PR is a hand-off signal, not a review
— it does not review, fix-review, or merge its own work; that is a separate
concern with a separate owner. When several issues were implemented in parallel,
aggregate their outcomes into one hand-off so the reader sees every branch, its
state (ready / stuck), and any blocking diagnosis at a glance.
