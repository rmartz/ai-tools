---
type: Script
title: install-clis
description: Install/update the published ai-* CLIs globally from GitHub Packages, decoupled from the local checkout — with a SessionStart hook to keep them fresh.
resource: scripts/install-clis.ts
tags: [setup, cli, packages, update]
---

# install-clis

`scripts/install-clis.ts` installs (and updates) ai-tools' `ai-*` command-line
tools **from the published GitHub Packages**, not the local build. It runs
`pnpm add -g @rmartz/<pkg>@latest` for every bin-bearing package, so the CLIs live
in pnpm's global store — **decoupled from this checkout**, which may be on a
feature branch or mid-edit. Only the package _names_ are read from the workspace
(stable metadata); the executable code always comes from the registry.

Re-running always pulls `@latest`, so the same command **is** the updater.

```
pnpm run install:clis            # install/update all ai-* CLIs from the registry
pnpm run install:clis -- --dry-run
pnpm run install:clis -- --tag next
```

## Prerequisite: GitHub Packages auth

The `@rmartz` scope is a private GitHub Packages registry, so a token with
`read:packages` is required (one-time):

```
gh auth refresh -h github.com -s read:packages
# then in ~/.npmrc:
@rmartz:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=<token with read:packages>
```

Also run `pnpm setup` once so the global bin dir is on `PATH`. Without auth the
install fails with a pointer to these steps (exit non-zero).

## Auto-update: SessionStart hook

Because a release publishes to the registry but can't reach your machine, keep
the CLIs fresh by re-running the install on every agent session start. Add a
`SessionStart` hook to `~/.claude/settings.json` (backgrounded + output
discarded, so it never blocks a session and silently no-ops until auth is set up):

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "pnpm -C /path/to/ai-tools run install:clis >/dev/null 2>&1 &"
          }
        ]
      }
    ]
  }
}
```

Each session then starts by pulling the latest published `@rmartz/*` CLIs in the
background — the "periodic/on-merge" refresh, driven by session cadence.

## Design

The importable helpers hold the pure logic and are hermetically tested:
`resolveBinPackages(packagesDir)` (which workspace packages ship a bin) and
`buildAddArgs(names, tag)` (the `pnpm add -g` argv). `main()` runs the command
from a neutral cwd (`$HOME`) so the `-g` install resolves via the user-level
`~/.npmrc`, not this workspace's config. Markdown **skills** are a separate
channel — see [`install-skills`](install-skills.md).
