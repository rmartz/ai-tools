---
type: Skill
title: dependabot-fix-issue
description: Judgment for turning a red Dependabot bump that needs a code change into a deduped, linkable fix issue — not the Dependabot mechanics, which are PR Shepherd's.
resource: skills/dependabot-fix-issue.md
tags: [issues, dependabot, judgment, ci]
---

# dependabot-fix-issue

When a Dependabot version bump goes red because the new version needs an
accompanying **code change** (a new lint rule, a renamed API, a stricter type, a
compatibility shim), this skill is the judgment for filing a clear fix issue:
first rule out non-fixable infrastructure failures and flakes, classify _why_ the
bump needs a change, then author a deduped issue carrying the `Fixes Dependabot
PR #<N>` back-link and the application-code-only guardrail.

It owns only the **judgment**. The Dependabot _mechanics_ (sweep, spawn fix PR,
rebase/recreate, merge arbitration) belong to PR Shepherd and are explicitly out
of scope — see the [handoff](../pr-shepherd-handoff.md).

## Backed by the library

The craft is mechanized in `@rmartz/issues`:
`buildDependabotFixIssue` renders the title + body, and
`createDependabotFixIssue` dedups (via `findOpenIssue` on the stable
`Dependabot #<N>` title fragment) and creates the issue through `@rmartz/github`,
soft-failing to `null`.

## Runner-agnostic emission

Like every ai-tools skill, this describes the judgment and expresses a verdict
(draft an issue, or "no fix issue warranted"); it does **not** bake in PR
Shepherd's outcome marker or its own posting. Direct-harness mode posts via
`@rmartz/github`.

## See also

- Library: [`@rmartz/issues`](../packages/issues.md).
- Sibling authoring skill: [`create-issue`](./create-issue.md).
