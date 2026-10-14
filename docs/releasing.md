---
type: Design
title: Releasing
description: How ai-tools versions and publishes its @rmartz/* packages — automated per-package with release-please, driven by Conventional-Commit history.
tags: [release, packages, ci, release-please]
---

# Releasing

Releases are **automated with [release-please](https://github.com/googleapis/release-please)** in monorepo/manifest mode — no manual version bumping or tagging.

## Flow

1. You merge normal `feat` / `fix` / `feat!` PRs (Conventional-Commit titles, already enforced).
2. On each push to `main`, the **Release** workflow (`.github/workflows/release.yml`) runs `release-please`, which maintains a single aggregated **release PR** (`chore(main): release …`). It bumps each changed package's `version` in `package.json` and appends to its `CHANGELOG.md`, derived from the commits that touched that package's path.
3. The release PR **auto-merges once its required checks are green** — no human click (#236). `.github/workflows/bot-automerge.yml` uses the `rmartz/bot-automerge-action` composite action, which recognizes the release PR and enables GitHub-native auto-merge on it. Merging re-fires `release.yml` (`on: push`): release-please creates the GitHub releases + tags, and the workflow's `publish` job builds and runs `pnpm -r publish` — which skips versions already on the registry, so only the bumped packages publish to GitHub Packages.

Installed CLIs then pick the new versions up via `install:clis` / the SessionStart hook (see [`install-clis`](install-clis.md)).

So the steady state is **continuous delivery**: merging a `feat`/`fix` PR eventually publishes with no manual release step. release-please still _aggregates_, so a burst of merges may batch into one release PR rather than one version per merge.

## Config

- `release-please-config.json` — `release-type: node`, one entry per package under `packages/`, `separate-pull-requests: false` (one aggregated release PR), `bump-minor-pre-major: true` (pre-1.0, a breaking change bumps the minor, not straight to 1.0.0), and `bootstrap-sha` anchoring the first run at the manual catch-up publish (`v0.1.3`) so the first release PR only covers commits after it (inert once release-please has cut its own releases).
- `.release-please-manifest.json` — the current version of each package (release-please's source of truth; it updates this on release).

## Version bumps

Per package, from the Conventional-Commit type of the commits touching its files: `fix` → patch, `feat` → minor, `feat!` / `BREAKING CHANGE` → minor while < 1.0 (then major). release-please attributes a commit to every package whose files it changed, so a cross-package PR bumps each — but the **level** is the commit's type applied to each. Needing different levels per package in one PR is out of scope (that's changesets' niche); split the PR if it matters.

## Notes

- **The rmartz-merge-bot App token**: release-please and bot auto-merge both run under an installation token for the private `rmartz-merge-bot` GitHub App, minted per run by `actions/create-github-app-token` from the `MERGE_BOT_CLIENT_ID` and `MERGE_BOT_PRIVATE_KEY` repo secrets (stored in both the Actions **and** the Dependabot store — a Dependabot-triggered run sees only the latter). The App needs **Contents**, **Pull requests**, and **Workflows** write. It replaced the former user PATs (`RELEASE_PLEASE_PAT`, `BOT_AUTOMERGE_TOKEN`) because GitHub rate-limits per user across all of a user's tokens: the coordinator shared that pool and could exhaust it mid-run, failing these jobs. The App has its own pool (rmartz/scripts#22).
- **CI on the release PR**: GitHub's built-in token can't trigger workflows on the PRs it creates, so a `GITHUB_TOKEN`-opened release PR would carry no CI. An App-opened one does. Publishing still uses the built-in `GITHUB_TOKEN`.
- **Why bot auto-merge can't use `GITHUB_TOKEN`**: merging the release PR is what re-triggers `release.yml` (`on: push` to `main`), whose `publish` job ships the packages. GitHub fires no `push` workflows for a merge whose auto-merge was enabled with `GITHUB_TOKEN`, so `release.yml` would never re-fire and nothing would publish (rmartz/bot-automerge-action#31). App-enabled merges do fire them. A composite action cannot `secrets: inherit`, so `bot-automerge.yml` passes the App token as the explicit `token` input — drop it and bot merges silently fall back to `github.token` and stop publishing.
- **Manual path retired**: the old `v*`-tag-triggered publish is replaced; don't hand-tag releases.
