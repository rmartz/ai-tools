---
name: dependabot-review
description: Review a Dependabot dependency bump — verify the real from/to versions against the diff, assess the upgrade risk, and emit findings. The review craft for automated bumps, parallel to review for normal PRs.
---

Review the Dependabot pull request: $ARGUMENTS

---

> **Tooling**: this is the review _craft_ for an automated dependency bump —
> parallel to `review` for human-authored PRs. It does one thing: **assess the
> bump and emit findings** in the same schema `review` uses, so
> `synthesize-review` can triage and reach the verdict uniformly. It composes
> `@rmartz/pr-review`'s Dependabot helpers (`verifyDependabotBump`,
> `assessDependabotRisk`) and `@rmartz/github` reads. Prefer `mcp__github__*`
> where one exists; fall back to `gh` otherwise.

> **Emission (read this first).** Produce **findings** only — declarative data,
> not posted actions. No `submitReview`, no `gh pr edit`, no thread resolution,
> no labels, and **no merge/approve decision**: the routing verdict is
> `synthesize-review`'s call across every reviewer. _Deciding_ and _doing_ are
> separate; this skill only decides.

> **Applies only to `dependabot[bot]` PRs.** If the author is anyone else, stop —
> use `review`. Skip all code-quality, style, and convention checks; they do not
> apply to an automated bump.

## Step 1 — Setup

Confirm the PR author is `dependabot[bot]` (`ai-pr-summary $ARGUMENTS`). Read the
PR title/description for the **claimed** from/to versions and the ecosystem, and
whether the change is lockfile-only or touches a dev dependency.

## Step 2 — Trust but verify the bump — the diff is the source of truth

Dependabot's title/description has been observed to **misstate the from-version**
(envctl#27 claimed `3.9.1 → 3.9.4` while the diff was `3.8.4 → 3.9.4`), which
understates the semver delta and the risk. So never trust the title:

1. Run `gh pr diff $ARGUMENTS` and pass it, with the title-claimed from/to, to
   `verifyDependabotBump(name, diff, claimed)` from `@rmartz/pr-review`.
2. Use its **diff-derived** `fromVersion` / `toVersion` for everything downstream.
3. If `titleMisstated` is true, emit a `title-description` finding carrying the
   **corrected title** as `suggestedText` (the real versions), and treat the
   mis-statement itself as a concern — a misstated bump under-claims risk, so it
   escalates the severity of the risk finding below to at least `blocking`.

## Step 3 — Assess the upgrade risk

Feed the **diff-derived** bump to `assessDependabotRisk` (with `name`,
`ecosystem`, `lockfileOnly`, `devDependency`). Turn the assessment into findings:

- **`safe`** (and the title matched) → **emit no risk finding.** A clean, correctly
  described bump has nothing to flag; the empty findings record lets
  `synthesize-review` approve. Dependabot bumps never need manual testing.
- **`review` or `high`** (or a misstated title) → emit a `dependency-bump` finding
  at severity `blocking`: the specific risk (`assessment.reasons`, plus the
  bump-mismatch `note` when present) and what a human should verify.
- **`github_actions` bump** — add a finding noting it **cannot be merged by an
  automation lacking the `workflows` OAuth scope**; that is a merge-mechanics
  constraint a human or a suitably-scoped actor must clear.

## Step 4 — Emit the findings

Express the findings as declarative data (the single terminal action), in the
**same schema `review` emits** so `synthesize-review` consumes them identically:

- `category` — `dependency-bump` (or `title-description` for the corrected title).
- `severity` — `blocking` for a `review`/`high`/misstated bump; the record is
  empty for a clean `safe` bump.
- `location` — the manifest/lockfile path the bump touches.
- `summary` — the risk and what to verify, in 1–3 sentences.
- `suggestedText` — the corrected title when `titleMisstated`.

Do not reach a verdict, resolve threads, or fix the PR. Then report the findings
and the diff-derived from/to versions to the caller.
