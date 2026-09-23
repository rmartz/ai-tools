---
type: Library
title: bootstrap
description: Layer-1 repo bootstrapping — reconcile the canonical label roster, apply golden-state tooling-ignore and workflow files, and confirm the Dependabot auto-merge branch-protection gate.
resource: packages/bootstrap/src/index.ts
tags: [tooling, bootstrap, labels, config, ignore-files]
---

# @rmartz/bootstrap

One-time (idempotent) **new-repo initializer**, layer-1 — not an ongoing manager.
It seeds a fresh repo to a checklist-conformant starting state (labels, ignore
blocks, golden workflow files) and then stops; keeping an _existing_ repo
conformant is the job of the [repository conformance
checklist](https://github.com/rmartz/ai/blob/main/docs/guidance/repository-checklist.md),
the single source of truth, applied by audit + self-manage rather than by bootstrap
re-asserting golden files (#263). It composes `@rmartz/github` (label CRUD) and
`@rmartz/agent-runtime` (`boundedRun`, for the bins' git shell-out) and nothing else
internal. It knows nothing about PR Shepherd's gate/verdict labels — the roster here
is the cross-cutting + meta set only.

## Surface

### Labels (`ensure-labels.ts`, `labels-roster.ts`)

- `ensureLabels(repo, { extra?, roster?, call? })` — idempotently reconcile a
  repo's labels with the roster: list current labels once, diff each spec, then
  **create / update / rename-in-place** to match. Color drift is compared
  case-insensitively ignoring a leading `#`; a casing-only name difference or a
  `renamedFrom` predecessor triggers a rename (preserving issue/PR
  associations) rather than a duplicate create. Throws only if the initial list
  fails (no live state to diff); per-label `gh` failures are collected into
  `result.failures` and reported per-label in `result.outcomes`, mirroring the
  Python's best-effort posture.
- `defaultRoster` = `crossCuttingLabels` + `metaLabels` + `mergeSafetyLabels`.
  **Reframe from dotfiles' `labels.yml`:** only the cross-cutting domain labels
  carry over, plus `tracking` and `discussion` (the meta set) and the
  `merge-safety` check's own `update required` / `merge conflict` labels (seeded
  wherever its golden workflow runs). The dotfiles `workflow` set (PR-Shepherd
  gate/verdict labels) and per-app `projects` families are deliberately excluded —
  this layer must not know PR Shepherd's labels, and project families live with
  their projects. Colors are kept verbatim as 6-hex without a leading `#` (REST
  contract).

### Project config (`ensure-project-config.ts`, `golden-config.ts`)

- `ensureProjectConfig(root, { files? })` — pure-fs, no subprocess. Ensures each
  golden ignore file under `root` carries a single fenced **managed block**
  (`BLOCK_BEGIN`…`BLOCK_END`); it rewrites only that block and preserves any
  user-authored lines outside it ("ensure block present, don't clobber user
  content"). `root` is a parameter so tests target a tmpdir.
- `goldenIgnoreFiles` — **TS-toolchain reframe** of dotfiles'
  `ensure_project_config.py`. That script appended a single `.git-worktrees`
  entry and spliced an `eslint.config.js` ignores array via a comment-aware
  parser. Here the stack is pnpm + TS, so the golden ignores cover the TS
  build/test artifacts (`node_modules`, `dist`, `.turbo`, `*.tsbuildinfo`,
  `coverage`), written to `.prettierignore` and `.gitignore`.
  `.git-worktrees/` is **deliberately not seeded** — the worktree layout is a
  per-developer process choice, so it belongs in the developer's global
  `core.excludesFile`, never in each repo's tree. Because the managed block is
  regenerated from these entries on every run, a repo that a prior version seeded
  has the stale `.git-worktrees/` line stripped on the next run. The marker-block
  approach replaces the Python's fragile flat-config array splice entirely.
- `retiredIgnoreFiles` — ignore files bootstrap used to seed but now actively
  **retires** (#253): on each run it strips our managed block and deletes the file
  if that block was all it held, while leaving a user-authored file (one without
  our block) untouched. `.eslintignore` is the first entry — ESLint 10 (flat
  config) no longer reads it and warns on its presence, so it is retired rather
  than seeded, and an already-bootstrapped repo sheds the inert file on its next
  `ai-ensure-project-config` run. A flat config's own `ignores` array carries the
  equivalent artifact list. (Ignore files keep a spliced managed _block_ — the
  endorsed "lesser case" — unlike whole workflow files, which are pure
  write-if-absent seeds with no bootstrap-tended region.)

  Retiring a stale **workflow** from an existing repo (e.g. the old
  `dependabot-auto-merge.yml` superseded by `bot-automerge.yml`, or a leftover
  `golden-sync.yml`) is **not** bootstrap's job — that is an ongoing-manager behavior
  it no longer performs. Sweeping such files is a repository-checklist conformance
  item (the checklist asserts their absence); an agent auditing an existing repo
  removes them.

### Whole workflow files (`ensure-workflow-files.ts`, `golden-config.ts`)

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
  `repo-hygiene.yml`) or a **starting config** the repo tailors (`dependabot.yml`), or
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
  produces the satisfied set is `resolveSatisfiedGateChecks` (below).

- `goldenWorkflowFiles` — the whole files a new repo is seeded with, each
  write-if-absent then repo-owned:
  - `bot-automerge.yml` (#264): a thin **caller** of the SHA-pinned
    `rmartz/bot-automerge` reusable workflow
    (`uses: rmartz/bot-automerge/.github/workflows/bot-automerge.yml@<sha> # vX.Y.Z`).
    It enables GitHub-native auto-merge for trustworthy **bot** PRs — green
    `semver-patch` / `semver-minor` Dependabot bumps (majors stay manual) **and**
    release-please release PRs — replacing the old inline Dependabot-only
    `dependabot-auto-merge.yml` (no longer shipped; a stale copy is swept by the
    checklist audit, not by bootstrap). Dependabot's `github-actions` ecosystem bumps
    the pin (and the CLI version the reusable workflow installs, in lockstep). The
    trigger is `pull_request_target` (required, not `pull_request`, so Dependabot's
    read-only-token PRs get base-context write) and it `secrets: inherit`s. It stays
    **gated**: it keeps `gateChecks: ['merge-safety']`, so the writer **withholds** its
    creation until `merge-safety` is a satisfied required check (an ungated
    `gh pr merge --auto` merges immediately). _(Adopting this for a repo's own
    **release-please** CD additionally needs a real-actor merge so the merge
    re-triggers the publish workflow — tracked by #236 / rmartz/bot-automerge#8; the
    Dependabot path is unaffected.)_
  - `merge-safety.yml`: a thin **caller** of the SHA-pinned
    `rmartz/merge-safety` reusable workflow
    (`uses: rmartz/merge-safety/.github/workflows/merge-safety.yml@<sha> # vX.Y.Z`),
    which posts the advisory `merge-safety` check (the coordinator's "must this PR
    be brought current before merge?" verdict) and, via the push fan-out,
    invalidates open PRs when the base moves. merge-safety now ships from its own
    repo (extracted from `@rmartz/pr-review`, #247); Dependabot's `github-actions`
    ecosystem bumps the pin — and the CLI version the reusable workflow installs,
    which tracks the release in lockstep. The caller carries the triggers
    (`pull_request_target` — not `pull_request`, so the check still fires on an
    unmergeable PR, #272 — / `push` / `check_suite` / `workflow_dispatch`) and the write scopes
    (`checks` / `pull-requests` / `actions`), threads the dispatch `pr` via `with:`,
    and `secrets: inherit`; the reusable side is `on: workflow_call` and owns the
    evaluate-vs-invalidate branch + the label-narrowing. Seeding it makes the check
    **run**; making it a **required gate** is the separate per-repo curation step
    (it is `gateChecks: []` — it _provides_ the check the auto-merge file depends
    on, it doesn't consume one). Its `update required` / `merge conflict` labels
    are seeded by the label roster above.
  - `.github/dependabot.yml`: a starting Dependabot config — the
    `github-actions` ecosystem (the minimum every repo wants; it keeps pinned
    action SHAs, including the `bot-automerge` caller's reusable-workflow pin, fresh)
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
    inputs to its own copy. Only `packages: read` is needed at runtime (the action
    reads the public `@rmartz/repo-hygiene` from GitHub Packages via the default
    `github.token`) — no Dependabot PAT. A self-updating reference: bootstrap writes
    it once and Dependabot owns the pin thereafter, so it is never overwritten.
    Advisory; `gateChecks: []`.
  - `commit-convention.yml`: the **post-merge conventional-commit
    tripwire** — a `push: [main]` job that fails when a subject reaches the default
    branch without a valid conventional-commit prefix. It is the counterpart of
    `pr-title-lint` (which validates titles _pre-merge_ but can't see whether the
    title reached `main`): it catches a squash-merge setting that used the branch
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

  **Check-name convention (#299).** The check names these templates produce follow
  one fleet-wide rule, and the casing encodes _who owns the check_: a check supplied
  by a **shared CI product** is lowercase-kebab (`hygiene`, `merge-safety`,
  `bot-automerge`), while a job a **repo defines itself** is Title Case and
  human-readable (`Build`, `Format`, `Lint`, `Test`, `Typecheck`,
  `Validate PR title`, `Validate commit subjects on main`). That is why
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
  CI checks (typecheck / lint / format / build / test / PR-title, by that repo's
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

### Auto-merge gate verifier (`verify-automerge-gate.ts`)

The **network** half — deliberately separate from the hermetic writer above.
`verifyAutomergeGate({ repo?, cwd?, apply?, gateChecks? })` confirms (and
optionally applies) the branch-protection gate the seeded auto-merge workflow
depends on.

Protection is expressed as a **Ruleset**, not classic branch protection — classic
rules are a legacy mechanism the fleet migrates away from.

- **Confirm (default, read-only):** read the default branch's **effective required
  checks from the Rulesets API** (`repos/{repo}/rules/branches/{branch}`), the
  repo's `allow_auto_merge`, and the repo's **squash-merge commit setting**;
  `satisfied` is true only when auto-merge is on, every gate check is marked
  required, **and** the squash commit is set to PR title + body
  (`squash_merge_commit_title=PR_TITLE`, `squash_merge_commit_message=PR_BODY`). A
  branch with no ruleset (or classic) requiring the gate checks reads as missing —
  the **fail-closed** direction. Legacy classic protection, if any lingers, still
  **counts toward** the gate (so a mid-migration repo is not falsely reported
  unsatisfied), but is surfaced as **drift** (`classicProtection`) to migrate.
- **`--apply` (opt-in, state-changing):** enable `allow_auto_merge` if off,
  **find-or-update the tool-managed ruleset** (`Auto-merge gate`) so it requires
  the **union** of its current contexts and the gate checks, and PATCH the
  squash-merge commit to PR title + body. Find-or-update by ruleset name is
  idempotent (re-running converges on one ruleset, never a duplicate) and leaves a
  repo's own hand-authored rulesets untouched. `strict_required_status_checks_policy`
  is **false** by design — requiring branches to be up-to-date would re-pend every
  open PR whenever the base moves, churning against the `merge-safety` check that
  already observes staleness. No review policy is set. Classic protection is never
  written and never deleted — drift is reported, not auto-migrated. Admin-level
  mutation, so it never runs unless explicitly requested; a failed write throws.

**Why the squash setting is part of this gate:** under auto-merge a merged PR must
land a **conventional commit subject** (its PR title) or release-please silently
skips the release — so an auto-merge repo with the squash commit set to anything
but PR title + body quietly breaks its own releases. Confirming it here couples it
to the same hard gate.

**Why the gate can't live in the workflow (token caveat):** reading whether checks
are _required_ needs **admin-level** access the workflow's default `GITHUB_TOKEN`
generally lacks (`allow_auto_merge` on the repo object is readable without admin;
`required_status_checks` protection is not). The user's `gh` auth does have admin,
so the confirmation is reliable in this bootstrap/agent step — not in the workflow
at runtime. **The hazard it closes:** `gh pr merge --auto` with **no** required
checks merges _immediately_, so an ungated file doesn't sit inert — it auto-merges
every patch/minor Dependabot PR with zero gate. The verifier prevents seeding the
file into that state.

**Relationship to the `/dependabot` flow:** native auto-merge silently clears
trivial _green_ patch/minor bumps with no agent tokens; the agent-driven
`/dependabot` + PR Shepherd path still owns _red_ and _major_ bumps. The two
complement rather than overlap.

### Fleet audit (`fleet-audit.ts`)

The **read-only, multi-repo** pre-flight before any fleet-wide `--apply`.
`auditFleet({ repos, gateChecks? })` runs one `verifyAutomergeGate` **confirm**
(never `apply`) per repo and aggregates the per-repo state into a report, so a
caller can decide go/no-go and spot which repos still carry legacy
classic-protection drift.

- **Strictly read-only** — it reuses the gate verifier's confirm path and never
  sets `apply`, so it is safe to sweep across the fleet before mutating anything.
- **Per-repo row** — `mechanism` (`none` / `classic` / `ruleset` / `both`, derived
  from the verifier's `rulesetProtection` + `classicProtection` flags),
  `allowAutoMerge`, `requiredChecks`, `missingChecks`, `squashCommitCorrect`,
  `classicProtection` (the migrate-and-remove drift signal), and `satisfied`.
- **Fail-closed** — a repo that cannot be read becomes an `ok: false`, unsatisfied
  row (counted in the summary's `errored`) rather than aborting the whole sweep.
- **Summary** — `total` / `satisfied` / `unsatisfied` / `classicDrift` / `errored`,
  the machine-readable basis for the CLI's go/no-go exit code.

### Squash-merge convention verifier (`verify-squash-merge-setting.ts`)

The **other network repo-settings verifier**, same class as the auto-merge gate.
`verifySquashMergeSetting({ repo?, cwd?, apply? })` confirms (and optionally
applies) the squash-merge default that carries a PR's _conventional_ title onto
`main`: `squash_merge_commit_title=PR_TITLE` + `squash_merge_commit_message=PR_BODY`.

- **Confirm (default, read-only):** read the repo's two `squash_merge_commit_*`
  sources in one `gh api repos/{repo}` call; `satisfied` is true only when the
  title source is `PR_TITLE` **and** the message source is `PR_BODY`.
- **`--apply` (opt-in, state-changing):** PATCH the repo defaults to `PR_TITLE` +
  `PR_BODY`. A failed write throws; it never runs unless the gate is unsatisfied.

**The hazard it closes:** with any other squash default, a merge squashes using the
branch **commit message** — plain, per the "no Conventional Commits within a
feature branch" rule — instead of the conventional PR **title**. release-please
only releases conventional commits, so a non-conventional subject on `main` is
**silently skipped**; this is the setting-side fix for the same failure the
`commit-convention.yml` tripwire alerts on after the fact. The pair — a **pre-set**
default here and a **post-merge** alarm in the workflow — closes the loop
`pr-title-lint` (pre-merge, title-only) cannot.

## CLIs

Thin `bin/` wrappers; all logic stays in the library:

- `ai-ensure-labels [owner/repo]` — reconcile the default roster on the target
  repo, resolved through `resolveRepoTarget` (positional `owner/repo` → `GH_REPO`
  → cwd), so a caller that cannot pin its cwd never needs `cd <dir> && ai-*`.
  Prints a per-label outcome summary; exits non-zero if any label failed.
- `ai-ensure-project-config [-C <dir>] [--with-gate [--repo <owner/repo>] [--check <ctx>]...]`
  — detect the repo root (`git rev-parse --show-toplevel`, run in `-C`/`--cwd <dir>`
  when given) and ensure the golden ignore blocks **and** seed the golden workflow
  files. Prints a per-file outcome summary; an existing workflow is left untouched
  (`unchanged`), and a `withheld` line flags the gated auto-merge workflow held
  back until its gate is satisfied. **By default the gated auto-merge workflow is
  withheld** (never seeded ungated). `--with-gate` reads the repo's real auto-merge
  gate (read-only, via `resolveSatisfiedGateChecks`) and seeds the gated workflow
  **only if the gate is actually satisfied** — `--check` (repeatable) overrides the
  gate-check set; a failed read withholds (the safe direction).
- `ai-verify-automerge-gate [-C <dir>] [--repo <owner/repo>] [--apply] [--check <ctx>]...`
  — confirm (default) or apply the auto-merge gate on the repo's default branch.
  Repo target: `--repo` → `GH_REPO` → the `-C`/`--cwd` checkout. `--check`
  (repeatable) overrides the default `goldenGateChecks` set. **Exits non-zero when
  the gate is unsatisfied** (and not applied) — the hard block the `/bootstrap`
  skill runs after writing files.
- `ai-verify-squash-setting [-C <dir>] [--repo <owner/repo>] [--apply]` — confirm
  (default) or apply the squash-merge commit convention (`PR_TITLE` + `PR_BODY`) on
  the repo. Same repo-target precedence as above. **Exits non-zero when the setting
  is unsatisfied** (and not applied) — the second hard block the `/bootstrap` skill
  runs, so a repo whose squash default would drop the conventional title is caught
  before the release-integrity failure it causes.
- `ai-fleet-audit --repo <owner/repo> [--repo <owner/repo>]... [--check <ctx>]... [--json]`
  — read-only audit of the auto-merge gate across every named repo. Prints a
  per-repo table + summary (or `--json` for the full report); `--check` (repeatable)
  overrides the default `goldenGateChecks`. **Never writes.** **Exits non-zero when
  any repo is unsatisfied or unreadable** — the go/no-go signal for a fleet apply.

## Testing

`ensure-labels`, `verify-automerge-gate`, and `verify-squash-merge-setting` tests
`vi.mock('@rmartz/github')` so no `gh` subprocess runs (each verifier routes its
mocked `ghCall` by argv shape to state repo state declaratively);
`ensure-project-config` / `ensure-workflow-files` tests mock `@rmartz/agent-runtime`
to a hard failure (proving the writers never shell out) and write to a tmpdir with
cleanup — deny-by-default, no network.
