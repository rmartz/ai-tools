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
is the cross-cutting + meta set plus the labels its seeded checks apply.

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
- `defaultRoster` = `crossCuttingLabels` + `metaLabels` + `mergeSafetyLabels` +
  `prPolicyLabels`. **Reframe from dotfiles' `labels.yml`:** only the cross-cutting
  domain labels carry over, plus `tracking` and `discussion` (the meta set), the
  `merge-safety` check's own `update required` / `merge conflict` labels, and the
  one label the `pr-policy` check writes, `CI approval needed` (each seeded because
  its golden workflow applies it; `CI approval needed` copies `labels.yml`'s color
  and description so the two reconcilers agree). The labels pr-policy only _reads_
  (`CI change approved`, `no UAT needed`, `UAT passed`/`tested`, `do not merge`,
  `blocked`, `escalation needed`, `contained break`, `epic`, `breaking change`,
  `hotfix`) are workflow labels and stay in that roster (`ensure-labels.py`). The
  dotfiles `workflow` set (PR-Shepherd gate/verdict labels) and per-app `projects`
  families are deliberately excluded —
  this layer must not know PR Shepherd's labels, and project families live with
  their projects. Colors are kept verbatim as 6-hex without a leading `#` (REST
  contract). Every label that also appears in `labels.yml` copies its color and
  description verbatim, since both reconcilers run on the same repos and any
  drift makes each revert the other. `test/labels-roster.test.ts` pins those
  shared values; only `discussion` is bootstrap-only.

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
  `dependabot-auto-merge.yml` superseded by `bot-automerge.yml`, a leftover
  `golden-sync.yml`, or a `pr-title-lint.yml` superseded by `pr-policy.yml`) is
  **not** bootstrap's job — that is an ongoing-manager behavior
  it no longer performs. Sweeping such files is a repository-checklist conformance
  item (the checklist asserts their absence); an agent auditing an existing repo
  removes them.

### Whole workflow files (`ensure-workflow-files.ts`, `golden-config.ts`)

A **second golden category**, distinct from the fenced-block ignores: whole
GitHub Actions workflow files that are byte-identical across every repo, seeded
**write-if-absent** (an existing file is never touched) and then repo-owned.
`ensureWorkflowFiles(root, { workflows?, satisfiedGateChecks? })` is pure fs, and
`ensureProjectConfig` composes it after the ignore blocks. The seeded set, the
gate-before-go-live (`withheld`) rule, per-workflow behavior, and the check-name
convention are documented on [bootstrap-workflows](bootstrap-workflows.md).

`goldenGateChecks` — the union of every golden workflow's `gateChecks` — is the
cross-repo **floor** of the auto-merge gate. It is a floor, not a sufficient gate:
native auto-merge ignores non-required checks, so a safe gate also requires the
repo's substantive CI checks, supplied per repo via the verifier's `--check` flags.

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
default here and a **post-merge** alarm in the workflow — closes the loop the
seeded `pr-policy.yml`'s `title` check (pre-merge, title-only) cannot.

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
