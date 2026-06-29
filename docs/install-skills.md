---
type: Script
title: install-skills
description: Symlink ai-tools skills into ~/.claude/commands so they are invocable as slash commands — the replacement for the retired dotfiles install symlink step.
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
- **Safe** — a symlink pointing elsewhere, or a real (hand-written) file, is
  `skipped` and left intact unless `--force` is given (then `updated`).
- `--commands-dir <dir>` / `--skills-dir <dir>` override the defaults (the tests
  use them so no real `~/.claude` is touched).

The importable `installSkills(opts)` holds the logic (hermetically tested over a
temp dir); the CLI `main` only parses args and prints. The `ai-*` package CLIs are
a separate distribution channel (the published packages); this script handles only
the markdown **skills**.
