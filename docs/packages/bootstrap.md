---
type: Library
title: bootstrap
description: Layer-1 repo bootstrapping — reconcile the canonical label roster, apply golden-state tooling-ignore and workflow files, and confirm the Dependabot auto-merge branch-protection gate.
resource: packages/bootstrap/src/index.ts
tags: [tooling, bootstrap, labels, config, ignore-files]
---

# @rmartz/bootstrap

One-time (idempotent) repository setup, layer-1. It composes `@rmartz/github`
(label CRUD) and `@rmartz/agent-runtime` (`boundedRun`, for the bins' git
shell-out) and nothing else internal. It knows nothing about PR Shepherd's
gate/verdict labels — the roster here is the cross-cutting + meta set only.

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
  `coverage`) plus `.git-worktrees/`, written to `.prettierignore`,
  `.eslintignore`, and `.gitignore`. The marker-block approach replaces the
  Python's fragile flat-config array splice entirely.

### Whole workflow files (`ensure-workflow-files.ts`, `golden-config.ts`)

A **second golden category**, distinct from the fenced-block ignores: whole
GitHub Actions workflow files that are byte-identical across every repo. A
workflow with zero project-specific logic is a copy-distribution candidate — the
win is drift control, not code reuse — so it is managed as a **whole file**, not
a block spliced into user content.

- `ensureWorkflowFiles(root, { workflows? })` — pure fs. Two per-file idempotency
  policies (`GoldenWorkflowFile.policy`):
  - **`manage`** (default) — a bootstrap-owned file: **write if absent**,
    **overwrite if drifted** from the golden template, report **unchanged** if
    identical, and **skip** if a _user-authored_ file (one lacking the managed
    header) already sits at that path. The managed header (`WORKFLOW_MANAGED_HEADER`,
    carrying `WORKFLOW_MANAGED_MARKER`) distinguishes "a file we own and may
    overwrite" from "leave it alone" — so a hand-written workflow of the same name
    is never clobbered.
  - **`seed`** — a starting point the repo then owns: write the plain content (no
    managed header) **only if absent**, and never touch it again once present. For
    files repos are expected to customize (`.github/dependabot.yml`), where
    overwriting local edits on every bootstrap would be wrong.

  `ensureProjectConfig` composes this after the ignore blocks, returning one
  combined outcome list.

- `goldenWorkflowFiles` — seeded with two `manage` workflows and one `seed` config:
  - `dependabot-auto-merge.yml`: on a green `semver-patch` / `semver-minor`
    Dependabot PR it enables GitHub-native auto-merge (majors stay manual).
    `dependabot/fetch-metadata` is pinned to a full commit SHA + `major.minor.patch`
    comment per the Actions-pinning convention; Dependabot's `github-actions`
    ecosystem keeps the SHA fresh. It declares the `gateChecks` its native
    auto-merge depends on (here `merge-safety`).
  - `merge-safety.yml`: posts the advisory `merge-safety` check (the coordinator's
    "must this PR be brought current before merge?" verdict). This is the
    **consumer shape** — it `npm install -g`s the published `@rmartz/pr-review` CLI
    (a **public** GitHub Packages package, read with the repo's own `GITHUB_TOKEN`
    — no grant or PAT) and runs `ai-merge-safety`, rather than building from source
    the way ai-tools' own in-repo copy does. Generic across repos: the base branch
    comes from the PR (falling back to the repo default) on the evaluate path;
    `push` fires on `main`. Seeding it makes the check **run**; making it a
    **required gate** is the separate per-repo curation step (it is `gateChecks: []`
    — it _provides_ the check the auto-merge file depends on, it doesn't consume
    one). Its `update required` / `merge conflict` labels are seeded by the label
    roster above.
  - `.github/dependabot.yml` (**`seed`**): a starting Dependabot config — the
    `github-actions` ecosystem (the minimum every repo wants; it keeps pinned
    action SHAs, including the auto-merge workflow's `fetch-metadata`, fresh) plus
    the `npm` ecosystem (the ideal for the JS repos this toolkit targets), both
    grouped. Written only if absent; a repo then owns and tailors it.
  - `repo-hygiene.yml` (**`manage`**): runs the **universally-safe `action-pins`**
    check via the published `@rmartz/repo-hygiene` CLI (consumer shape). Only
    `action-pins` is fleet-safe — the other registered checks (`okf` /
    `md-pairing` / `file-caps`) are ai-tools conventions that would false-fail on
    an arbitrary repo (e.g. `okf` flags any docs lacking OKF frontmatter), so
    distributing them fleet-wide is a deliberate **per-repo curation** decision
    (tracked with the gate-set curation follow-up), not part of the universal
    golden set. Advisory; `gateChecks: []`.

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

- **Confirm (default, read-only):** read the default branch's
  `required_status_checks` and the repo's `allow_auto_merge`; `satisfied` is true
  only when auto-merge is on **and** every gate check is marked required. A branch
  with no protection reads as "no required checks" — the **fail-closed** direction,
  so an unprotected branch reports the gate missing rather than silently passing.
- **`--apply` (opt-in, state-changing):** enable `allow_auto_merge` if off, and PUT
  a minimal branch protection requiring the **union** of the currently-required and
  gate contexts (`strict`). PUT replaces the whole protection object, so this
  configures a strict required-checks gate, **not** a review policy
  (`required_pull_request_reviews` / `restrictions` are set null). Admin-level
  mutation, so it never runs unless explicitly requested; a failed write throws.

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

## CLIs

Thin `bin/` wrappers; all logic stays in the library:

- `ai-ensure-labels [owner/repo]` — reconcile the default roster on the target
  repo, resolved through `resolveRepoTarget` (positional `owner/repo` → `GH_REPO`
  → cwd), so a caller that cannot pin its cwd never needs `cd <dir> && ai-*`.
  Prints a per-label outcome summary; exits non-zero if any label failed.
- `ai-ensure-project-config [-C <dir>]` — detect the repo root (`git rev-parse
--show-toplevel`, run in `-C`/`--cwd <dir>` when given) and ensure the golden
  ignore blocks **and** golden workflow files. Prints a per-file outcome summary;
  a `skipped` line flags any user-authored workflow left untouched.
- `ai-verify-automerge-gate [-C <dir>] [--repo <owner/repo>] [--apply] [--check <ctx>]...`
  — confirm (default) or apply the auto-merge gate on the repo's default branch.
  Repo target: `--repo` → `GH_REPO` → the `-C`/`--cwd` checkout. `--check`
  (repeatable) overrides the default `goldenGateChecks` set. **Exits non-zero when
  the gate is unsatisfied** (and not applied) — the hard block the `/bootstrap`
  skill runs after writing files.

## Testing

`ensure-labels` and `verify-automerge-gate` tests `vi.mock('@rmartz/github')` so
no `gh` subprocess runs (the verifier routes its mocked `ghCall` by argv shape to
state repo state declaratively); `ensure-project-config` / `ensure-workflow-files`
tests mock `@rmartz/agent-runtime` to a hard failure (proving the writers never
shell out) and write to a tmpdir with cleanup — deny-by-default, no network.
