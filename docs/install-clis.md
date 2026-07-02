---
type: Script
title: install-clis
description: Symlink ai-tools' built ai-* CLIs onto a PATH directory (~/.claude/bin) so they are invocable as commands — the CLI counterpart to install-skills.
resource: scripts/install-clis.ts
tags: [setup, cli, harness, symlink]
---

# install-clis

`scripts/install-clis.ts` makes ai-tools' `ai-*` command-line tools invocable from
a shell: it walks each package's `package.json` `bin` map and symlinks the built
`dist/bin/<name>.js` into a bin directory on `PATH` (default `~/.claude/bin`),
marking each dist file executable. It is the CLI counterpart to
[`install-skills`](install-skills.md), and part of the dotfiles→ai-tools cutover —
the 23 `ai-*` bins are published to GitHub Packages but need to be on `PATH` to
replace the dotfiles `~/.claude/scripts/*.py` invocations.

The links point at **locally built** code (dogfood-friendly), so build first:

```
pnpm build                       # populate dist/bin/*.js
pnpm run install:clis            # symlink ai-* bins → ~/.claude/bin
pnpm run install:clis -- --dry-run
pnpm run install:clis -- --force        # replace a conflicting file/symlink
pnpm run install:clis -- --bin-dir DIR  # target a different PATH dir
```

Behaviour:

- **Idempotent** — a symlink already pointing at the same source reports
  `unchanged` (its exec bit is re-asserted); nothing else is rewritten.
- **Safe** — a symlink pointing elsewhere, or a real file, is `skipped` and left
  intact unless `--force` is given (then `updated`).
- **Build-aware** — a bin whose `dist/bin/*.js` target does not exist is reported
  `missing` (not silently skipped) and the run exits non-zero, so a forgotten
  `pnpm build` fails loudly rather than half-installing.
- **PATH note** — if the target dir is not on `PATH`, the CLI prints the
  `export PATH=…` line to add.
- `--bin-dir <dir>` / `--packages-dir <dir>` override the defaults (the tests use
  them so no real `~/.claude` is touched).

The importable `installClis(opts)` holds the logic (hermetically tested over a temp
dir); the CLI `main` only parses args, prints, and emits the PATH hint.
