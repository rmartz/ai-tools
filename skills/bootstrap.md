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
files. Also idempotent.

## Step 3 — Report

Summarize what each step created vs. left unchanged, so a re-run on an
already-bootstrapped repo reads as a clean no-op rather than churn.
