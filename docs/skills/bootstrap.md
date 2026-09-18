---
type: Skill
title: bootstrap
description: Repo-setup craft — seed the standard label roster (ai-ensure-labels) and the golden-state tooling ignores (ai-ensure-project-config), both idempotently, via @rmartz/bootstrap.
resource: skills/bootstrap.md
tags: [bootstrap, setup, labels, tooling]
---

# `/bootstrap`

The `bootstrap` skill readies a repository for the PR workflow by composing
`@rmartz/bootstrap`'s two idempotent CLIs:

- **`ai-ensure-labels`** — create/reconcile the standard workflow + cross-cutting
  domain label roster the review/route/merge skills rely on.
- **`ai-ensure-project-config`** — apply the golden-state tooling ignores
  (`.prettierignore`, ESLint ignore config, `.gitignore` baselines) **and** the
  golden whole-file workflows (`bot-automerge.yml`, `commit-convention.yml`) so
  formatters/linters don't fight generated files and drift-controlled workflows stay
  in sync.
- **`ai-verify-automerge-gate`** — after the workflow is written, confirm (or
  `--apply`) the branch-protection gate native auto-merge depends on. A non-zero
  exit is a **hard block**: a seeded auto-merge file in a repo with no required
  checks would merge every patch/minor Dependabot PR _immediately_, so the gate
  must be confirmed before the bootstrap PR lands.
- **`ai-verify-squash-setting`** — confirm (or `--apply`) the squash-merge default
  (`PR_TITLE` + `PR_BODY`) so a merge carries the conventional PR title onto `main`.
  A non-zero exit is a **hard block**: with any other default, release-please
  silently skips the release. The seeded `commit-convention.yml` tripwire is the
  post-merge alarm for the same failure.

The first two are safe to re-run — existing state is reconciled in place, so a
re-run on an already-bootstrapped repo is a clean no-op. The skill seeds the repo's
standard roster and config; it encodes **no** coordinator gate/verdict semantics.

## See also

- Library: [`@rmartz/bootstrap`](../packages/bootstrap.md).
