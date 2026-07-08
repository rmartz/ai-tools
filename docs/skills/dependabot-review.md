---
type: Skill
title: dependabot-review
description: The review craft for an automated dependency bump — verify the real from/to versions against the diff, assess the upgrade risk, and emit findings in the same schema as review.
resource: skills/dependabot-review.md
tags: [pr-review, skill, review, craft, dependabot]
---

# `/dependabot-review`

The review craft for a Dependabot bump — parallel to [`review`](review.md) for
human PRs, and one of the three skills the single-purpose `review` was split into.
It does one thing: **assess the bump and emit findings** in the same schema
`review` uses, so [`synthesize-review`](synthesize-review.md) triages and reaches
the verdict uniformly. It composes `@rmartz/pr-review`'s Dependabot helpers
(`verifyDependabotBump`, `assessDependabotRisk`) and `@rmartz/github` reads. It
applies only to `dependabot[bot]` PRs; code-quality and convention checks are
skipped for automated bumps.

## Emission

Findings only — declarative data, never posted actions, never a merge decision.
Same schema as `review` (`category` / `severity` / `location` / `summary` /
`suggestedText`), so the downstream store and `synthesize-review` consume both
identically.

## Flow

1. **Setup** — confirm the author is `dependabot[bot]`; read the claimed from/to
   versions, ecosystem, and lockfile-only / dev-dependency flags.
2. **Trust but verify** — the title can misstate the from-version (envctl#27
   claimed `3.9.1 → 3.9.4` while the diff was `3.8.4 → 3.9.4`). Run
   `verifyDependabotBump(name, diff, claimed)` and use its **diff-derived**
   versions downstream; a misstated title becomes a `title-description` finding
   carrying the corrected title and escalates the risk finding.
3. **Assess risk** — `assessDependabotRisk` on the diff-derived bump; `safe` (title
   matching) emits no risk finding, `review`/`high`/misstated emits a `blocking`
   `dependency-bump` finding. A `github_actions` bump adds a finding that merging
   needs the `workflows` OAuth scope.
4. **Emit the findings** — declarative, with the diff-derived from/to versions.

## See also

- [`review`](review.md) — the parallel craft for human PRs.
- [`synthesize-review`](synthesize-review.md) — consumes these findings.
- `@rmartz/pr-review` library — `docs/packages/pr-review.md`.
