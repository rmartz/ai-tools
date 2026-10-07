# ai-tools docs

OKF (Open Knowledge Format) index for the general-purpose AI toolkit. One page
per published package and per non-trivial CLI; agents retrieve these before a
task. Every page except the indexes carries OKF frontmatter (`type`, `title`,
`description`, `resource`, `tags`) — enforced by `pnpm run check:okf` (`ai-repo-hygiene okf --check`).

## Packages

Each `@rmartz/*` package has an OKF page, listed in the [packages index](packages/index.md)
(layers 0–2: `agent-runtime`, `github`, `worktree`, `verify`, `bootstrap`,
`pr-review`, `issues`, `reporting`).

`@rmartz/reporting`'s `anomaly` + `efficiency-audit` modules are deferred pending
taxonomy coordination with PR Shepherd's self-observability work (see
[PR Shepherd handoff](pr-shepherd-handoff.md)).

## Skills

Skill _definitions_ live in the top-level `skills/` directory; each has an OKF
page listed in the [skills index](skills/index.md). Skills express judgment/craft
and stay runner-agnostic about emission (see [PR Shepherd handoff](pr-shepherd-handoff.md)).

Make the skills invocable as slash commands with
[`pnpm run install:skills`](install-skills.md) — it symlinks `skills/*.md` into
`~/.claude/commands/`.

## Operations and design

- [install-clis](install-clis.md) — install/update the published `ai-*` CLIs globally.
- [install-skills](install-skills.md) — symlink the skills into `~/.claude/commands`.
- [releasing](releasing.md) — how packages are versioned and published with release-please.
- [reporting-schema](reporting-schema.md) — the shared anomaly/efficiency event contract with PR Shepherd.
- [pr-shepherd-handoff](pr-shepherd-handoff.md) — the ai-tools → PR Shepherd delegation contract.

## Guidance

Cross-cutting engineering guidance that is specific to this repo's code lives
under `guidance/`. Repo-independent agent knowledge (code style applied across
all projects, Storybook practices, test structuring) lives in the `ai` repo.
