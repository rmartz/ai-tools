---
type: Script
title: install-skills
description: Symlink ai-tools skills into ~/.claude/commands so they are invocable as slash commands — the durable overlay that lets ai-tools skills take over from the agent-config repo's versions during the cutover.
resource: scripts/install-skills.ts
tags: [setup, skills, harness, symlink]
---

# install-skills

`scripts/install-skills.ts` makes ai-tools' skills runnable by the Claude harness:
it symlinks each `skills/<name>.md` into `~/.claude/commands/<name>.md`, where the
harness discovers slash commands. The agent-config repo's `install.sh` links
`~/.claude/commands` itself and then runs this script, so a fresh machine gets
both sets of skills in one step.

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

## Precedence & the agent-config overlay

`~/.claude/commands` is a symlink to the agent-config repo's `commands/`
directory (linked by that repo's `install.sh`), so this script writes its overlay
symlinks _into that working tree_. Precedence therefore works by which names the
agent-config repo leaves free:

- A command name it still **tracks** as a real file (e.g. `review.md`) is
  foreign, so `install:skills` **skips** it — its version stays live.
- A name it has **vacated** (removed + `.gitignore`d in `commands/`) is absent,
  so `install:skills` **links** the ai-tools version — it takes over.

Cutting a skill over is thus a two-repo step: ai-tools ships the craft skill, and
the agent-config repo vacates the name. Its `commands/.gitignore` also stops a
`git clean` from wiping the overlay symlinks (the fragility that previously
un-installed them), and a **SessionStart hook** re-runs `install:skills` each
session so the overlay is re-created if ever lost:

```
pnpm -C <ai-tools> run install:skills >/dev/null 2>&1 &
```

Re-linking `~/.claude/commands` to a different directory drops the overlay, which
is why the agent-config `install.sh` re-runs `install:skills` right after it
links.

During the cutover, orchestration-coupled skills (`review`, `fix-review`,
`drive-to-merge`) stay in the agent-config repo until **PR Shepherd** is live to
own their label/verdict/merge mechanics; the self-contained craft skills
(`implement`, `weekly-tech-debt`, `weekly-tune-up`, `create-issue`) overlay first.

The importable `installSkills(opts)` holds the logic (hermetically tested over a
temp dir); the CLI `main` only parses args and prints. The `ai-*` package CLIs are
a separate distribution channel (see [`install-clis`](install-clis.md)); this
script handles only the markdown **skills**.
