# Packages

One OKF page per published `@rmartz/*` package, plus companion pages where a
package's page was split along a conceptual seam. Packages may only import from
layers at or below their own (see the repo's `AGENTS.md`).

| Layer | Package                 | Page                                          |
| ----- | ----------------------- | --------------------------------------------- |
| 0     | `@rmartz/agent-runtime` | [agent-runtime](agent-runtime.md)             |
| 0     | `@rmartz/github`        | [github](github.md)                           |
| 1     | `@rmartz/worktree`      | [worktree](worktree.md)                       |
| 1     | `@rmartz/verify`        | [verify](verify.md)                           |
| 1     | `@rmartz/bootstrap`     | [bootstrap](bootstrap.md)                     |
| 1     | `@rmartz/bootstrap`     | [bootstrap-workflows](bootstrap-workflows.md) |
| 2     | `@rmartz/pr-review`     | [pr-review](pr-review.md)                     |
| 2     | `@rmartz/issues`        | [issues](issues.md)                           |
| 2     | `@rmartz/reporting`     | [reporting](reporting.md)                     |

`bootstrap-workflows` is the golden whole-file workflow half of `@rmartz/bootstrap`.
