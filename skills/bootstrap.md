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
- `.github/workflows/commit-convention.yml` — the post-merge tripwire that fails
  when a non-conventional subject reaches `main`.
- `.github/dependabot.yml` — a starting Dependabot config (**seed** policy:
  write-if-absent, then repo-owned).

Idempotent per file: a drifted **managed** workflow is overwritten back to golden;
a **seed** file is written only when absent; and a user-authored workflow of the
same name (no managed header) is left untouched (`skipped`).

**The `dependabot-auto-merge.yml` is `withheld` here, by design (#239).** It is a
gated workflow — seeding it before its required-checks gate exists would auto-merge
every green bump ungated — so a plain `ai-ensure-project-config` run **does not
create it** (a `withheld` outcome), and neither does any direct call. It is seeded
in Step 3 **after** the gate is confirmed, via `ai-ensure-project-config --with-gate`.
This machine-enforces the ordering at the tooling boundary, not just in this skill.

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
  surface it before running). It enables `allow_auto_merge`, provisions the
  required checks as a **Ruleset** (the tool-managed `Auto-merge gate` ruleset —
  find-or-update by name, so re-running converges rather than duplicating), and
  sets the squash-merge commit to **PR title + body**. Then re-confirm without
  `--apply`.
- **Classic-protection drift:** if the repo still carries legacy classic branch
  protection, the confirm output flags it. Classic protection still counts toward
  the gate, but the fleet standardizes on Rulesets — migrate any remaining required
  checks into the ruleset and remove the classic protection. The verifier reports
  this drift; it never writes or deletes classic protection.
- **Seed the auto-merge workflow (gate now satisfied):** once the gate confirms
  satisfied, re-run `ai-ensure-project-config --with-gate -C <repo>` to seed the
  `dependabot-auto-merge.yml` that Step 2 withheld. `--with-gate` re-reads the gate
  (read-only) and creates the workflow **only if it is actually satisfied**, so the
  ungated workflow can never land — the ordering is enforced by the tooling, not by
  remembering to run this step.

The squash-merge setting is part of the gate because under auto-merge a merged PR
must land a **conventional commit subject** (its PR title) or release-please
silently skips it — so an auto-merge repo with the wrong squash setting quietly
breaks its own releases.

Only the user's `gh` auth reliably carries the admin access this read needs, which
is why the gate is confirmed here rather than inside the workflow at runtime.

## Step 4 — Confirm the squash-merge convention (hard block)

Run `ai-verify-squash-setting -C <repo>` to confirm the repo squashes with the
**PR title**, not the branch commit message:

- **Default (read-only):** it exits **non-zero** unless
  `squash_merge_commit_title=PR_TITLE` and `squash_merge_commit_message=PR_BODY`. A
  non-zero exit is a **hard block** — with any other default, a squash merge uses
  the branch commit message (plain, per the "no Conventional Commits within a
  feature branch" rule) instead of the conventional PR title, and release-please
  **silently skips** the release (the failure that dropped #214–#217).
- **To configure it:** re-run with `--apply` (admin, state-changing — surface it
  before running), then re-confirm without `--apply`.

This is the **pre-set** half of the release-integrity fix; the seeded
`commit-convention.yml` tripwire (written in Step 2) is the **post-merge** alarm
for the same failure, catching squash-setting drift or a direct push after the
fact. `pr-title-lint` validates the title pre-merge but can't see whether it
reached `main` — these two close that gap.

## Step 5 — Report

Summarize what each step created vs. left unchanged (and any `skipped`
user-authored workflow), plus the auto-merge gate's and squash-setting's
confirmed/applied state, so a re-run on an already-bootstrapped repo reads as a
clean no-op rather than churn.
