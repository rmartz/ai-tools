---
name: bootstrap
description: Bootstrap a repository for the PR workflow — seed the standard label roster and the golden-state tooling ignores, both idempotently.
---

# bootstrap

Bootstrap a new repository for the PR workflow.

Run once when setting up a project, or any time the standard labels or tooling
config have drifted. Both steps compose `@rmartz/bootstrap` and are **idempotent**
— safe to re-run.

> **Tooling**: this skill is repo-setup _craft_ over `@rmartz/bootstrap`'s two
> CLIs. It does not encode any coordinator's gate/verdict semantics — it seeds the
> repo's **standard roster** and tooling config; which labels a coordinator then
> _uses_ is the coordinator's concern, not this skill's.

## Step 1 — Ensure the label roster

Run `ai-ensure-labels` (`@rmartz/bootstrap`). It creates (and reconciles the color
and description of) the standard workflow and cross-cutting domain labels the
review/route/merge skills rely on — the status labels (lowercase) and the
cross-cutting domain labels (Title Case). It is idempotent: existing labels are
updated in place, missing ones created, and nothing is deleted.

Project-specific domain labels beyond the standard roster are created ad hoc when
first needed, not here.

## Step 2 — Ensure the golden-state tooling config

Run `ai-ensure-project-config` (`@rmartz/bootstrap`). It applies the golden-state
tooling ignores a healthy repo expects (`.prettierignore`, an ESLint ignore config,
`.gitignore` baselines) so formatters and linters don't fight generated or vendored
files, **and** the golden whole-file set:

- `.github/workflows/dependabot-auto-merge.yml` — native auto-merge on green
  patch/minor Dependabot PRs (majors stay manual).
- `.github/workflows/merge-safety.yml` — the advisory `merge-safety` check
  (consumer shape: installs the published `@rmartz/pr-review` CLI).
- `.github/workflows/repo-hygiene.yml` — the universal `action-pins` check (via the
  published `@rmartz/repo-hygiene` CLI).
- `.github/dependabot.yml` — a starting Dependabot config (**seed** policy:
  write-if-absent, then repo-owned).

Idempotent per file: a drifted **managed** workflow is overwritten back to golden;
a **seed** file is written only when absent; and a user-authored workflow of the
same name (no managed header) is left untouched (`skipped`).

## Step 3 — Confirm the auto-merge gate (hard block)

A seeded `dependabot-auto-merge.yml` **must not** land in a repo where auto-merge
would fire ungated: `gh pr merge --auto` with no required checks merges
**immediately**, so an ungated file auto-merges every patch/minor Dependabot PR
with zero gate. After Step 2 writes the workflow, run
`ai-verify-automerge-gate -C <repo>` to confirm the branch-protection gate the
workflow depends on:

- **Default (read-only):** it exits **non-zero** if the gate checks aren't marked
  required on the default branch, if `allow_auto_merge` is off, **or if the
  squash-merge commit isn't set to PR title + body**. A non-zero exit is a **hard
  block** — do not open/land the bootstrap PR until the gate is satisfied. This
  machine-checked confirmation replaces a prose reminder an agent could skip.
- **To configure the gate:** re-run with `--apply` (admin, state-changing —
  surface it before running). It enables `allow_auto_merge`, sets the required
  checks, and sets the squash-merge commit to **PR title + body**. Then re-confirm
  without `--apply`.

The squash-merge setting is part of the gate because under auto-merge a merged PR
must land a **conventional commit subject** (its PR title) or release-please
silently skips it — so an auto-merge repo with the wrong squash setting quietly
breaks its own releases.

Only the user's `gh` auth reliably carries the admin access this read needs, which
is why the gate is confirmed here rather than inside the workflow at runtime.

## Step 4 — Report

Summarize what each step created vs. left unchanged (and any `skipped`
user-authored workflow), plus the gate's confirmed/applied state, so a re-run on an
already-bootstrapped repo reads as a clean no-op rather than churn.
