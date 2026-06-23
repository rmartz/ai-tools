---
type: Library
title: issues
description: Layer-2 issue craft — the create-issue authoring skill and the dependabot-fix-issue judgment/library, composing @rmartz/github's issue ops.
resource: packages/issues/src/index.ts
tags: [composed, issues, dependabot, github]
---

# @rmartz/issues

Layer-2 (composed) home for **issue craft**: authoring well-formed GitHub issues
and the Dependabot fix-issue judgment. It composes layer-0 `@rmartz/github`
(`createIssue`, `findOpenIssue`) and stays out of PR Shepherd's way — it knows
nothing about gate/verdict labels or the skill-outcome marker (see the
[handoff](../pr-shepherd-handoff.md)).

The two halves are deliberately split between prose and code:

- **Authoring craft** is mostly judgment, so it lives as the
  [`create-issue`](../skills/create-issue.md) skill (`skills/create-issue.md`) —
  dedup, imperative title, goal + acceptance-criteria + context body, domain /
  milestone labelling — with no dedicated library entry point beyond the
  `@rmartz/github` primitives it points at.
- **Dependabot fix-issue** is judgment **plus** a mechanizable authoring path, so
  it ships both the [`dependabot-fix-issue`](../skills/dependabot-fix-issue.md)
  skill and a library + CLI.

## Surface

### Dependabot fix issue (`dependabot-fix-issue.ts`)

- `buildDependabotFixIssue(input)` — pure renderer: from `{ prNumber,
dependency, fromVersion?, toVersion?, category?, failingCheck?,
failureExcerpt?, labels? }` it returns `{ title, body, labels }`. The title
  carries the stable `Dependabot #<N>` fragment (the dedup key); the body carries
  the `Fixes Dependabot PR #<N>` back-link (`FIXES_DEPENDABOT_PREFIX`), the
  category-specific guidance, the failure excerpt, the application-code-only
  guardrail, and an acceptance-criteria checklist. No I/O.
- `createDependabotFixIssue(repo, input, opts?)` — dedups against an open issue
  (`findOpenIssue` on the title fragment, unless `skipDedup`) then creates via
  `createIssue`. Returns `{ url, outcome }` where `outcome` ∈ `created` |
  `existing` | `failed`; soft-fails to `{ url: null, outcome: 'failed' }`.
- `FixCategory` — `lint-rule | type-error | breaking-api | compatibility-shim |
test-failure | unknown`; drives the body's guidance.

## CLI

Thin `bin/` wrapper; all logic stays in the library:

- `ai-dependabot-fix-issue --pr <n> --dependency <name> [--to <v>] [--from <v>]
[--category <cat>] [--check <name>] [--failure-file <path>] [--label <l>]…
[--repo <owner/repo>] [--skip-dedup]` — resolves the repo from the git remote
  when `--repo` is omitted, then calls `createDependabotFixIssue` and prints the
  resulting (created or existing) issue URL.

## Testing

Hermetic: tests `vi.mock('@rmartz/github')` so no `gh` subprocess runs.
`buildDependabotFixIssue` is pure and asserted directly; `createDependabotFixIssue`
is asserted across the create / existing-dedup / skip-dedup / soft-fail paths.
