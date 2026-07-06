# ai-tools

The general-purpose AI toolkit: a pnpm-workspace monorepo of TypeScript packages
that agents and automation use to work on GitHub repositories. Successor to the
`claude/scripts/` Python tooling in `rmartz/dotfiles`.

Each package exposes **both** a library API (imported by PR Shepherd and other
automation) and, where useful, a CLI `bin` (invoked by the Claude Code harness).
The logic lives once in the library; the bin is a thin wrapper.

## Layers

Packages are organized into layers; a package may only import from layers at or
below its own. Enforced by `eslint-plugin-boundaries` (see `eslint.config.mjs`).

- **layer-0 — foundation:** `@rmartz/agent-runtime`, `@rmartz/github`
- **layer-1 — tooling:** `@rmartz/worktree`, `@rmartz/verify`, `@rmartz/repo-hygiene`, `@rmartz/bootstrap`
- **layer-2 — composed:** `@rmartz/pr-review`, `@rmartz/reporting`, `@rmartz/issues`

PR Shepherd lives in its own repo and depends on these as published packages;
nothing here imports it. The dependency arrow is one-way.

## Develop

```sh
pnpm install
pnpm run ci        # typecheck + lint + format + okf + test
pnpm run test:watch
```

## CI gates (enforced from commit #1)

- **typecheck** — `tsc` across all packages
- **lint** — ESLint incl. layer boundaries, `max-lines` (480 src / 720 test — the sole file-length cap), no import cycles
- **format** — Prettier check
- **OKF docs** — `scripts/check-okf-frontmatter.ts` (every `docs/` page has valid frontmatter + a real resource)
- **test** — vitest (globbed discovery; no manual test list to fall out of sync)

## Publishing & consuming (GitHub Packages, private)

Packages publish to GitHub Packages under the `@rmartz` scope (the scope must
match the repo owner). The [release workflow](.github/workflows/release.yml)
publishes changed packages when a `v*` tag is pushed; bump a package's `version`
to release it.

To **consume** these packages from another repo (e.g. PR Shepherd), add an
`.npmrc` and authenticate with a token that has `read:packages`:

```ini
@rmartz:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

- **Local dev:** a personal access token with `read:packages`.
- **CI:** the built-in `GITHUB_TOKEN` works for the _same_ repo's packages; for a
  _different_ repo (PR Shepherd → ai-tools), either grant the package "Actions
  access" to that repo (package settings → Manage Actions access) or use a PAT.
