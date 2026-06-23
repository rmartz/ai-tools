---
name: create-issue
description: Author a well-formed GitHub issue — deduped, titled in the imperative, bodied with goal + acceptance criteria + context, and labelled to the repo's roster.
---

# create-issue

Create a GitHub issue from a description: `$ARGUMENTS`.

This skill is the **craft** of authoring one good issue — dedup, title, body,
labels, milestone. It is runner-agnostic: it does not post a verdict marker and
does not assume PR Shepherd. When run directly by the harness, create the issue
with `@rmartz/github`'s `createIssue` (or the `gh issue create` fallback the CLIs
wrap). Under PR Shepherd, express the drafted issue and let the engine emit.

## Before writing anything: dedup

A duplicate issue is worse than no issue — it splits discussion and wastes a
reviewer's time. Search first, and only proceed if nothing close already exists.

- Prefer `@rmartz/github` `findOpenIssue(repo, { titleContains })` /
  `findOpenIssue(repo, { titleEquals })` — its match is **client-side exact**, so
  it is reliable regardless of GitHub's fuzzy server-side search.
- For a broader human scan, `gh issue list --limit 50` (optionally with
  `--search "<keywords> in:title"`).
- If a close match exists, **stop**: report the existing issue's number and URL
  instead of filing a near-duplicate. If the existing issue is merely related
  (not the same ask), reference it in the new body rather than duplicating it.

## Read the repo's conventions

Before drafting, read the project's `CLAUDE.md` / `AGENTS.md` (if present) so the
issue matches house style, the label roster, and any milestone/epic structure.
Skim the area of code the issue concerns so the body can name real file paths.

## Title — imperative, specific, short

- Lead with an imperative verb: **Add**, **Fix**, **Refactor**, **Remove**,
  **Document**, **Investigate**. "Add retry to the rate-limit guard", not
  "rate-limit guard".
- Be specific enough to disambiguate from neighbouring issues; avoid bare nouns
  ("Logging") and vague verbs ("Improve X").
- Keep it under ~70 characters so it reads cleanly in lists.
- Do **not** prefix with a Conventional-Commit type — that convention is for PR
  titles, not issues.

## Body — goal, criteria, context

Write enough that someone who never saw the originating conversation can pick the
issue up cold:

1. **Goal / problem** — 1–3 sentences on what is wrong or what should exist, and
   why it matters. State the observed behaviour vs. the desired behaviour for a
   bug.
2. **Acceptance criteria** — a markdown checklist of the concrete, verifiable
   conditions for "done". Each item is independently checkable; avoid restating
   the title.
3. **Context** — relevant file paths, function names, error excerpts, or links to
   related issues/PRs, drawn from the codebase where you can identify them.
   Reference related issues by number rather than re-describing them.

Keep it tight: a bug report needs reproduction steps and the failure; a small
chore may be two sentences plus one criterion. Match the body's weight to the
work.

## Labels & milestone

- Apply the matching **domain label** (Title Case, e.g. `Auth`, `UI`,
  `Security`, `DevOps`) — pick from the repo's roster (`gh label list`, or
  `listLabels` from `@rmartz/github`). Do not invent a label that is not on the
  roster; if a needed domain label is genuinely missing, note it rather than
  guessing a colour.
- **Status labels are lowercase** (`approved`, `tracking`) — apply only when the
  issue's nature calls for one (e.g. a recurring-pattern ledger gets `tracking`).
- If the work belongs to an epic with a **Milestone**, assign that milestone so
  the epic's native progress tracking stays accurate.

## Create and report

- Direct-harness mode: `createIssue(repo, { title, body, labels })` from
  `@rmartz/github` (REST-first, soft-fails to `null`). The `gh issue create
--title … --body-file … --label …` form is the equivalent fallback.
- Do **not** assign the issue to anyone — leave assignment to the user (or to the
  `/implement` flow that picks it up).
- Report the new issue's **number and URL**. In chat, render the number as a
  markdown link, e.g. `[#49](https://github.com/owner/repo/issues/49)` — never a
  bare `#N`.
- If you create or edit the issue on the user's behalf, sign the body footer with
  your full model name: `\n\n---\n*Created by <model>*`.
