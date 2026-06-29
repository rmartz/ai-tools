# ai-tools docs

OKF (Open Knowledge Format) index for the general-purpose AI toolkit. One page
per published package and per non-trivial CLI; agents retrieve these before a
task. Every page except this index carries OKF frontmatter (`type`, `title`,
`description`, `resource`, `tags`) — enforced by `scripts/check-okf-frontmatter.ts`.

## Packages

| Layer | Package                 | Page                                       |
| ----- | ----------------------- | ------------------------------------------ |
| 0     | `@rmartz/agent-runtime` | [agent-runtime](packages/agent-runtime.md) |
| 0     | `@rmartz/github`        | [github](packages/github.md)               |
| 1     | `@rmartz/worktree`      | [worktree](packages/worktree.md)           |
| 1     | `@rmartz/verify`        | [verify](packages/verify.md)               |
| 1     | `@rmartz/repo-hygiene`  | [repo-hygiene](packages/repo-hygiene.md)   |
| 1     | `@rmartz/bootstrap`     | [bootstrap](packages/bootstrap.md)         |
| 2     | `@rmartz/pr-review`     | [pr-review](packages/pr-review.md)         |
| 2     | `@rmartz/issues`        | [issues](packages/issues.md)               |
| 2     | `@rmartz/reporting`     | [reporting](packages/reporting.md)         |

`@rmartz/reporting`'s `anomaly` + `efficiency-audit` modules are deferred pending
taxonomy coordination with PR Shepherd's self-observability work (see
[PR Shepherd handoff](pr-shepherd-handoff.md)).

## Skills

Skill _definitions_ live in the top-level `skills/` directory; each has an OKF
page under `docs/skills/`. Skills express judgment/craft and stay runner-agnostic
about emission (see [PR Shepherd handoff](pr-shepherd-handoff.md)).

| Skill                  | Page                                                   |
| ---------------------- | ------------------------------------------------------ |
| `review`               | [review](skills/review.md)                             |
| `create-issue`         | [create-issue](skills/create-issue.md)                 |
| `dependabot-fix-issue` | [dependabot-fix-issue](skills/dependabot-fix-issue.md) |
| `start-discussion`     | [start-discussion](skills/start-discussion.md)         |
| `discuss`              | [discuss](skills/discuss.md)                           |
| `discuss-curate`       | [discuss-curate](skills/discuss-curate.md)             |

Make the skills invocable as slash commands with
[`pnpm run install:skills`](install-skills.md) — it symlinks `skills/*.md` into
`~/.claude/commands/`.

## Guidance

Cross-cutting engineering guidance that is specific to this repo's code lives
under `guidance/`. Repo-independent agent knowledge (code style applied across
all projects, Storybook practices, test structuring) lives in the `ai` repo.
