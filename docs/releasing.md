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

- **CI on the release PR**: GitHub's built-in token can't trigger workflows on the PRs it creates, so by default the mechanical release PR carries no CI. Add a `RELEASE_PLEASE_PAT` repo secret — a fine-grained PAT with **Contents: write** + **Pull requests: write** on this repo (or a classic PAT with the `repo` scope) — and the workflow uses it (`secrets.RELEASE_PLEASE_PAT || github.token`) so CI runs on the release PR. It needs neither `workflow` scope (release-please never edits `.github/workflows/`) nor `packages` (publishing uses the built-in `GITHUB_TOKEN`).
- **Why the release-PR auto-merge uses the PAT**: merging the release PR is what re-triggers `release.yml` (`on: push` to `main`), whose `publish` job ships the packages. A merge enabled/performed via `GITHUB_TOKEN` is attributed to `github-actions[bot]`, and `GITHUB_TOKEN` pushes do **not** trigger workflows — so `release.yml` would never re-fire and nothing would publish. `bot-automerge` therefore enables the release-PR merge via `RELEASE_PLEASE_PAT` (the same secret above), falling back to `github.token`. A composite action cannot `secrets: inherit`, so `bot-automerge.yml` passes the PAT as the explicit `release-please-token` input — drop it and release-PR merges silently fall back to `github.token` and stop publishing. So the one `RELEASE_PLEASE_PAT` secret does double duty: CI on the release PR **and** the publish-triggering auto-merge.
- **Manual path retired**: the old `v*`-tag-triggered publish is replaced; don't hand-tag releases.
