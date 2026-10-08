---
type: Library
title: bootstrap-workflows
description: The golden whole-file GitHub Actions workflows @rmartz/bootstrap seeds into a new repo — write-if-absent seeding, the gate-before-go-live withholding rule, each seeded workflow, and the check-name convention.
resource: packages/bootstrap/src/ensure-workflow-files.ts
tags: [tooling, bootstrap, workflows, ci, golden-config]
---

# @rmartz/bootstrap — golden workflow files

The whole-file workflow half of [`@rmartz/bootstrap`](bootstrap.md): the second
golden category beside the fenced-block ignores. This page covers
`ensure-workflow-files.ts` and `golden-config.ts`; the label roster, project
config, verifiers, and CLIs are on the main [bootstrap](bootstrap.md) page.

## Whole workflow files (`ensure-workflow-files.ts`, `golden-config.ts`)

A **second golden category**, distinct from the fenced-block ignores: whole
GitHub Actions workflow files that are byte-identical across every repo. A
workflow with zero project-specific logic is a copy-distribution candidate — the
win is a conformant starting point, not code reuse — so it is seeded as a **whole
file**, not a block spliced into user content.

- `ensureWorkflowFiles(root, { workflows?, satisfiedGateChecks? })` — pure fs.
  **Write-if-absent seeding, nothing more:** each golden workflow is written to a new
  repo exactly once (verbatim, no managed header), and an existing file at that path
  is left untouched (`unchanged`), whoever authored it. Bootstrap gives a new repo a
  checklist-conformant starting point; keeping an _existing_ repo's workflows current
  is the repository checklist's job (audit + self-manage), **not** bootstrap's — it is
  a new-repo initializer, not an ongoing manager. Every golden workflow is either a
  **self-updating reference** (a SHA-pinned reusable-workflow caller or
  composite-action consumer Dependabot bumps — `bot-automerge.yml`, `merge-safety.yml`,
  `repo-hygiene.yml`, `pr-policy.yml`, `pr-lifecycle.yml`) or a **starting config**
  the repo tailors
  (`dependabot.yml`), or
  an **inline-logic** file seeded once and re-propagated by the checklist audit rather
  than a cron (`commit-convention.yml`). In every case there is nothing for a re-run
  to overwrite, which is why the old `manage`/overwrite-on-drift policy and its
  `golden-sync.yml` loop are gone (#263).

  `ensureProjectConfig` composes this after the ignore blocks, returning one
  combined outcome list.

- **Gate-before-go-live (`withheld`, #239).** A `gh pr merge --auto` workflow
  seeded into a repo with **no** required checks auto-merges every green bump
  _immediately_ — so the writer **withholds** the creation of any workflow whose
  declared `gateChecks` are not all in the passed-in `satisfiedGateChecks` set
  (the `withheld` outcome). The default is `[]`, so a plain call **never**
  lands the gated auto-merge workflow — even a direct `ai-ensure-project-config`
  run, not just the `/bootstrap` skill. The writer stays **hermetic**: it does not
  read the gate itself; it receives the resolved satisfied set. Withholding blocks
  **creation only** — an existing file is left as the repo's own (an empty set may
  just mean "the caller did not check the gate", so deleting on it would be wrong),
  which keeps the coupling **order-independent**: seed-then-gate and gate-then-seed
  both converge to "present iff the gate is satisfied". The **network** read that
  produces the satisfied set is `resolveSatisfiedGateChecks` (see the
  [auto-merge gate verifier](bootstrap.md#auto-merge-gate-verifier-verify-automerge-gatets)).

- `goldenWorkflowFiles` — the whole files a new repo is seeded with, each
  write-if-absent then repo-owned:
  - `bot-automerge.yml` (#264): a thin consumer of the SHA-pinned
    `rmartz/bot-automerge-action` **composite action** (#282) — a `bot-automerge` job
    whose single step is `- uses: rmartz/bot-automerge-action@<sha> # vX.Y.Z`,
    replacing the earlier `rmartz/bot-automerge` reusable-workflow caller. It enables
    GitHub-native auto-merge for trustworthy **bot** PRs — green `semver-patch` /
    `semver-minor` Dependabot bumps (majors stay manual) **and** release-please
    release PRs — replacing the old inline Dependabot-only `dependabot-auto-merge.yml`
    (no longer shipped; a stale copy is swept by the checklist audit, not by
    bootstrap). Dependabot's `github-actions` ecosystem bumps the pin (and the CLI
    version the action ships in its lockfile, in lockstep). The trigger is
    `pull_request_target` (required, not `pull_request`, so Dependabot's
    read-only-token PRs get base-context write). No checkout is needed — the action
    installs its CLI into its own directory and acts on the PR via the API. It passes
    two inputs: the required `pr: ${{ github.event.pull_request.number }}`, and
    `token: ${{ secrets.BOT_AUTOMERGE_TOKEN }}` — a real-actor PAT the repo stores as
    both an Actions **and** a Dependabot secret (a Dependabot-triggered run sees only
    the latter). A composite action cannot `secrets: inherit`, so the PAT must be
    explicit: GitHub fires no `push` workflows for a merge whose auto-merge was
    enabled with `GITHUB_TOKEN`, so a merged Dependabot bump or release PR would never
    re-trigger the release/CD workflow (#236 / rmartz/bot-automerge-action#31). It is
    passed unconditionally — empty where the secret is unset, in which case the action
    falls back to `github.token`. The pin is v2.1.1 or later: v2.x installs its CLI
    from npmjs (so there is no `packages: read`) and replaced the deprecated
    `release-please-token` input with `token`. The job's only `if:` is the fork guard
    — there is no `autorelease: pending` label condition, because the CLI detects
    release-please PRs by `release-please--` head branch alone
    (rmartz/bot-automerge#41). It stays **gated**: it keeps `gateChecks: ['merge-safety']`, so
    the writer **withholds** its creation until `merge-safety` is a satisfied required
    check (an ungated `gh pr merge --auto` merges immediately). Like `repo-hygiene.yml`,
    it kept its filename, so an **already-seeded** repo is not migrated by a re-run
    (write-if-absent leaves it untouched) — existing consumers move deliberately.
  - `merge-safety.yml`: a thin **consumer** of the SHA-pinned
    [`rmartz/merge-safety-action`](https://github.com/rmartz/merge-safety-action)
    composite action (`- uses: rmartz/merge-safety-action@<sha> # vX.Y.Z`), which
    posts the advisory `merge-safety` check (the coordinator's "must this PR be
    brought current before merge?" verdict) and, via the push fan-out, invalidates
    open PRs when the base moves. It supersedes the deprecated `rmartz/merge-safety`
    reusable-workflow caller. Dependabot's `github-actions` ecosystem bumps the pin;
    each action release pins the `@rmartz/merge-safety` CLI version in its lockfile.
    The consumer carries the triggers (`pull_request_target` — not `pull_request`, so
    the check still fires on an unmergeable PR, #272 — / `push` / `check_suite` /
    `workflow_dispatch`) and the write scopes (`checks` / `statuses` /
    `pull-requests` / `actions`), threads the dispatch `pr` via `with:`, and owns the
    job: an `if:` that skips the events the action would no-op on, and a concurrency
    group that serializes base-moved fan-outs per branch while giving each evaluate
    run its own group, so a burst of PR events never cancels a run. The action picks
    evaluate vs invalidate from the event and needs no checkout. Like the other seeded
    files it kept its filename, so an **already-seeded** repo is not migrated by a
    re-run — existing consumers move deliberately. Seeding it makes the check
    **run**; making it a **required gate** is the separate per-repo curation step
    (it is `gateChecks: []` — it _provides_ the check the auto-merge file depends
    on, it doesn't consume one). Its `update required` / `merge conflict` labels
    are seeded by the label roster on the main [bootstrap](bootstrap.md) page.
  - `.github/dependabot.yml`: a starting Dependabot config — the
    `github-actions` ecosystem (the minimum every repo wants; it keeps pinned
    action SHAs, including the `bot-automerge` consumer's composite-action pin, fresh)
    plus the `npm` ecosystem (the ideal for the JS repos this toolkit targets), both
    grouped. Written only if absent; a repo then owns and tailors it.
  - `repo-hygiene.yml`: a thin consumer of the SHA-pinned
    `rmartz/repo-hygiene-action` **composite action** (#278) — a `hygiene` job that
    `actions/checkout`s then `- uses: rmartz/repo-hygiene-action@<sha> # vX.Y.Z`,
    replacing the earlier `rmartz/repo-hygiene` reusable-workflow caller (which in
    turn replaced the hand-rolled `npm install -g @rmartz/repo-hygiene@<env-pin>` +
    `action-pins` run). The checkout must precede the action step — the action scans
    `$GITHUB_WORKSPACE` and never checks out itself — and a **plain shallow** checkout
    is enough: the checks are tree-based, so no `fetch-depth: 0`. Dependabot's
    `github-actions` ecosystem bumps the pin — and the CLI version the action ships
    in its lockfile, in lockstep — via reviewable PRs, so updates (including
    newly-added universally-safe checks) propagate with **no per-repo YAML edit**.
    Passing no `checks:` input runs the package's registry-derived **default-on** set
    (the universally-safe checks); a repo opts into repo-specific checks (`okf`,
    `docs-links`) and points `config:` at its `.repo-hygiene.yml` by adding those
    inputs to its own copy. The job grants `statuses: write` (v3.2.0+ posts one
    commit status per check, `repo-hygiene / <check>`) and **no** `packages: read` —
    since v3.1.0 the action installs the public `@rmartz/repo-hygiene` from npmjs
    with no auth, so no Dependabot PAT either. A self-updating reference: bootstrap writes
    it once and Dependabot owns the pin thereafter, so it is never overwritten.
    Advisory; `gateChecks: []`.
  - `commit-convention.yml`: the **post-merge conventional-commit
    tripwire** — a `push: [main]` job that fails when a subject reaches the default
    branch without a valid conventional-commit prefix. It is the counterpart of
    pr-policy's `title` check (which validates titles _pre-merge_ but can't see
    whether the title reached `main`): it catches a squash-merge setting that used the branch
    commit message instead of the PR title, a direct push, or a squash that dropped
    the prefix — any of which makes release-please **silently skip** the release
    (the failure that dropped `@rmartz/github`'s release, #214–#217). It **alerts,
    it does not gate** (the commit is already merged), so `gateChecks: []`. Its logic
    is **embedded inline** — no CLI install, no build, no Dependabot channel — so it
    is the one golden workflow that is not a self-updating reference: bootstrap seeds
    it once, the repo owns it, and a later revision reaches existing repos through the
    checklist audit (an agent re-seeding it), **not** an automated cron. It validates
    the **first-parent chain** of the pushed range, so a squash merge is its single
    new commit, a stray merge commit is flagged, and a merged branch's internal
    (deliberately plain) commits are not re-litigated. Two pushes give it no usable
    range — a branch's **first push** (`github.event.before` is all-zeros) and a
    **force-push** that rewrote the branch (`before` names a commit the rewrite
    orphaned, so `git rev-list` exits 128 and the step dies on `set -e`, #303). Both
    fall back to validating just the **pushed tip**, announced in the log: the
    tripwire narrows its scope and still fails on a bad subject, rather than skipping
    silently.
  - `pr-policy.yml`: a thin consumer of the SHA-pinned `rmartz/pr-policy-action`
    composite action (`golden-pr-policy.ts`), which runs the `@rmartz/pr-policy`
    read-only PR content checks and posts one verdict as the **`pr-policy`** check-run
    (plus a matching commit status, and one `pr-policy / <check>` status per check).
    Its `title` check is the **pre-merge** half of the conventional-commit pair: it
    validates the PR title (the subject a `PR_TITLE` squash lands on `main`) against
    the conventional-commit grammar, plus the breaking-marker and type rules. It
    replaces the inline `pr-title-lint.yml` (context `Validate PR title`), which the
    fleet has retired. The trigger is `pull_request_target` (nothing checks out or
    runs PR code; the Action reads through the API), so fork and Dependabot PRs still
    get a write token; the Action owns the `CI approval needed` label. The job is
    named `pr-policy (evaluate)` so it never posts a second, always-green `pr-policy`
    entry. A CI check, not an auto-merger, so `gateChecks: []`.

    **UAT variant.** Bootstrap has no project-type signal, so it seeds the fleet
    default, `skip-uat: true`: the right setting for npm packages, Actions, reusable
    workflows, and tooling, which have nothing to user-test. A **Next.js/Vercel app**
    repo keeps the UAT gate: delete the `skip-uat` line from its copy and change the
    header comment to say the repo keeps the gate (a PR then stays pending until it
    carries `no UAT needed` or a person's `UAT passed`). The flag lives in the
    default-branch caller so a PR cannot switch off a gate it would wait on.

    **Making it required.** A repo makes the check blocking by requiring the
    `pr-policy` context (GitHub Actions app, `integration_id: 15368`) in its
    ruleset. Do that only **after** `pr-policy` has posted on a PR: a
    `pull_request_target` caller runs the default-branch copy, so it first runs on
    the PR _after_ the one that adds it. Requiring it earlier leaves the adding PR
    waiting on a context that never posts. Bootstrap seeds the workflow and never
    adds `pr-policy` to a ruleset itself (the `--apply` gate only requires
    `goldenGateChecks`), so this is a manual step once the check has run.

    **Existing repos.** Bootstrap only stops _seeding_ `pr-title-lint.yml`; it never
    deletes a workflow a repo already has, so an existing copy is left alone. Moving
    a repo over is the checklist's job: add `pr-policy.yml`, swap the ruleset's
    `Validate PR title` context for `pr-policy` (once it has posted), then delete
    `pr-title-lint.yml` (renaming a required context is a lockstep change — see
    below).

  - `pr-lifecycle.yml`: a thin consumer of the SHA-pinned
    `rmartz/pr-lifecycle-action` composite action (`golden-pr-lifecycle.ts`), which
    runs the `@rmartz/pr-lifecycle` reconciler: on every relevant PR event it
    recomputes the PR's lifecycle state from its current facts and converges the
    lifecycle labels. It is seeded **labels-only**: `arm-auto-merge: false` and no
    real-actor `token`, so it never arms, merges, disarms, or updates a branch,
    and `gateChecks: []`. `bot-automerge.yml` keeps arming eligible bot PRs. A repo
    turns arming on later, after retiring `bot-automerge.yml`, following the fleet
    cutover in [rmartz/pr-lifecycle#75](https://github.com/rmartz/pr-lifecycle/issues/75).
    Like pr-policy it runs on `pull_request_target` and never checks out PR code.
    Its `workflow_run` list must name the Actions workflows behind the repo's
    required checks. Bootstrap seeds `CI` and the golden `repo-hygiene`, and a repo
    with other required-check workflows edits its copy.

  **Check-name convention (#299).** The check names these templates produce follow
  one fleet-wide rule, and the casing encodes _who owns the check_: a check supplied
  by a **shared CI product** is lowercase-kebab (`hygiene`, `merge-safety`,
  `bot-automerge`, `pr-policy`), while a job a **repo defines itself** is Title Case
  and human-readable (`Build`, `Format`, `Lint`, `Test`, `Typecheck`,
  `Validate commit subjects on main`). That is why
  `repo-hygiene.yml`'s job sets no `name:` — the check posts under the bare job id,
  `hygiene` — while `commit-convention.yml` sets an explicit
  `name: Validate commit subjects on main`. The #278 composite-action migration
  shortened the hygiene context from `hygiene / Repo hygiene` to plain `hygiene`
  without moving it across the rule; the supplier is still the shared product.
  **A check's name _is_ its required-status-check context**, so renaming one blocks
  every consumer's PRs against a context that can never post until each repo's
  ruleset is updated in the same rollout — the failure that left four migration PRs
  stuck at `BLOCKED`. Treat a rename as a fleet-wide, lockstep change.
  (`rmartz/group-picks` is a known outlier: internally consistent on `Hygiene`, but
  divergent from the other consumers.)

  There is no longer a `golden-sync.yml` self-update loop or a `manage`/overwrite
  policy: bootstrap seeds a new repo and stops, and the [repository conformance
  checklist](https://github.com/rmartz/ai/blob/main/docs/guidance/repository-checklist.md)
  is the single source of truth that keeps _existing_ repos conformant (#263).

  `goldenGateChecks` is the union of every entry's `gateChecks` — the cross-repo
  **floor** of the gate.

- **`goldenGateChecks` (`merge-safety`) is a floor, not a sufficient gate.**
  Native auto-merge waits only on _required_ checks and ignores non-required ones,
  so requiring `merge-safety` alone still lets a bump that breaks a _non-required_
  Test/Build auto-merge. A safe gate additionally requires the repo's substantive
  CI checks (typecheck / lint / format / build / test / `pr-policy`, by that repo's
  own context names) — repo-specific, so supplied per repo via the verifier's
  `--check` flags rather than hardcoded. Choosing which of a repo's checks are
  **required vs advisory** is a per-repo curation decision; a declarative config
  for it is tracked as a follow-up.

**Why copy-distribution and not a reusable workflow / `.github` special repo:** a
`uses: rmartz/…@vN` reusable workflow still needs a `pull_request_target` trigger
stub in every repo and adds token subtleties; and on a **personal account** a
`.github` repo distributes only default community-health files — it explicitly
**excludes** `.github/workflows/` (central workflow _execution_ is GitHub's
org-only "required workflows" feature). So neither is a distribution channel here;
a self-contained ~26-line file copied idempotently is.
