---
type: Script
title: install-skills
description: Symlink ai-tools skills into ~/.claude/commands so they are invocable as slash commands — the durable overlay that lets ai-tools skills take over from the dotfiles versions during the cutover.
resource: scripts/install-skills.ts
tags: [setup, skills, harness, symlink]
---

# install-skills

`scripts/install-skills.ts` makes ai-tools' skills runnable by the Claude harness:
it symlinks each `skills/<name>.md` into `~/.claude/commands/<name>.md`, where the
harness discovers slash commands. This is the ai-tools replacement for the
dotfiles `install.sh` symlink step that the repo split retired.

Run it after cloning (or after adding a skill):

```
pnpm run install:skills            # symlink skills/*.md → ~/.claude/commands
pnpm run install:skills -- --dry-run
pnpm run install:skills -- --force # replace a conflicting file/symlink
```

Behaviour:

- **Idempotent** — a symlink already pointing at the same source reports
  `unchanged`; nothing is rewritten.
- **Self-healing** — a symlink that already points _into_ `skills/` but is stale
  or broken (e.g. the skill was rebuilt, or the checkout moved) is refreshed to the
  canonical source and reported `updated`, **without** `--force`. This is what
  makes the SessionStart re-install (below) durable.
- **Safe** — a real (hand-written) file, or a symlink pointing _outside_ `skills/`,
  is foreign: it is `skipped` and left intact unless `--force` is given.
- `--commands-dir <dir>` / `--skills-dir <dir>` override the defaults (the tests
  use them so no real `~/.claude` is touched).

## Precedence & the dotfiles overlay

`~/.claude/commands` is a symlink to the **dotfiles** `claude/commands/`
directory, so this script writes its overlay symlinks _into the dotfiles working
tree_. Precedence therefore works by which names dotfiles leaves free:

- A command name dotfiles still **tracks** as a real file (e.g. `review.md`) is
  foreign, so `install:skills` **skips** it — the dotfiles version stays live.
- A name dotfiles has **vacated** (removed + `.gitignore`d in `claude/commands/`)
  is absent, so `install:skills` **links** the ai-tools version — it takes over.

Cutting a skill over is thus a two-repo step: ai-tools ships the craft skill, and
dotfiles vacates the name. The dotfiles `.gitignore` also stops a `git clean` from
wiping the overlay symlinks (the fragility that previously un-installed them), and
a **SessionStart hook** re-runs `install:skills` each session so the overlay is
re-created if ever lost:

```
pnpm -C <ai-tools> run install:skills >/dev/null 2>&1 &
```

During the cutover, orchestration-coupled skills (`review`, `fix-review`) stay on
dotfiles until **PR Shepherd** is live to own their label/verdict/merge mechanics;
the self-contained craft skills (`implement`, `weekly-tech-debt`, `weekly-tune-up`,
`create-issue`) overlay first.

The importable `installSkills(opts)` holds the logic (hermetically tested over a
temp dir); the CLI `main` only parses args and prints. The `ai-*` package CLIs are
a separate distribution channel (see [`install-clis`](install-clis.md)); this
script handles only the markdown **skills**.
