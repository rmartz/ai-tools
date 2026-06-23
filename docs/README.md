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

## Guidance

Cross-cutting engineering guidance that is specific to this repo's code lives
under `guidance/`. Repo-independent agent knowledge (code style applied across
all projects, Storybook practices, test structuring) lives in the `ai` repo.
