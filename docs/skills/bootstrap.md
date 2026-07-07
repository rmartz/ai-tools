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
  (`.prettierignore`, ESLint ignore config, `.gitignore` baselines) so formatters
  and linters don't fight generated/vendored files.

Both are safe to re-run — existing state is reconciled in place, so a re-run on an
already-bootstrapped repo is a clean no-op. The skill seeds the repo's standard
roster and config; it encodes **no** coordinator gate/verdict semantics.

## See also

- Library: [`@rmartz/bootstrap`](../packages/bootstrap.md).
