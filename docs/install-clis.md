---
type: Script
title: install-clis
description: Install/update the published ai-* CLIs globally from GitHub Packages, decoupled from the local checkout — with a SessionStart hook to keep them fresh.
resource: scripts/install-clis.ts
tags: [setup, cli, packages, update]
---

# install-clis

`scripts/install-clis.ts` installs (and updates) ai-tools' `ai-*` command-line
tools **from the published GitHub Packages**, not the local build. For every
bin-bearing package it resolves the **highest published version** (`npm view <pkg>
versions`) and runs `npm install -g @rmartz/<pkg>@<version>`, so the CLIs land in
npm's global prefix (on `PATH`) — **decoupled from this checkout**, which may be on
a feature branch or mid-edit. Only the package _names_ are read from the workspace
(stable metadata); the executable code always comes from the registry.

Re-running re-resolves and re-installs, so the same command **is** the updater.

**Why an explicit version, not `@latest`/`@*`:** GitHub Packages does not reliably
advance the `latest` dist-tag on publish, and the abbreviated packument it serves
to `npm install`'s range resolver can lag a fresh publish — both make `@latest`
and `@*` install a _stale_ version. `npm view … versions` reads the current full
packument, and installing the resolved exact version fetches the right tarball.

```
pnpm run install:clis            # install/update all ai-* CLIs from the registry
pnpm run install:clis -- --dry-run
```

`npm` is used deliberately rather than `pnpm add -g`: pnpm is corepack-pinned to
the workspace version here, and its global `-g` store can mismatch the global
pnpm major (`ERR_PNPM_UNEXPECTED_STORE`), whereas `npm i -g` is invariant to that
and reads the same `~/.npmrc` auth.

## Prerequisite: GitHub Packages auth

The `@rmartz` scope is a private registry, so a token with `read:packages` is
required (one-time):

```
gh auth refresh -h github.com -s read:packages
# ~/.npmrc:
@rmartz:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_PACKAGES_TOKEN}
```

`~/.npmrc` sources the token from `${GITHUB_PACKAGES_TOKEN}`. That env var is
typically exported only in **interactive** shells (to avoid a keychain read per
subshell), so for **non-interactive** callers — the SessionStart hook, agent
shells — `install-clis` **self-sources it from `gh auth token`** when the env var
is unset. So no extra shell config is needed; a valid `gh auth token` with
`read:packages` is enough. Without auth the install fails with a pointer to these
steps (exit non-zero).

## Auto-update: SessionStart hook

Because a release publishes to the registry but can't reach your machine, keep
the CLIs fresh by re-running the install on every agent session start. Add a
`SessionStart` hook to `~/.claude/settings.json` (backgrounded + output
discarded, so it never blocks a session):

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
`resolveBinPackages(packagesDir)` (which workspace packages ship a bin),
`maxStableVersion(versions)` (highest `X.Y.Z` version from a list, numeric
comparison so `0.10.0 > 0.9.0`),
`resolveLatestVersions(names, listVersions)` (pair each package name with its
highest published version via an injectable `listVersions` callback),
`buildInstallArgs(pairs)` (the `npm install -g <name@version> …` argv from
resolved `[name, version]` pairs), and `withPackagesToken(env, ghToken)` (inject
the token for non-interactive callers, never overwriting an already-set one).
`main()` runs the install from a neutral cwd (`$HOME`) so it reads the user-level
`~/.npmrc` and exits non-zero if any package's version cannot be resolved.
Markdown **skills** are a separate channel — see
[`install-skills`](install-skills.md).
