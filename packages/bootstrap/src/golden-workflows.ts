/**
 * The verbatim golden **workflow / config file bodies** distributed to every repo
 * — the bulky data half extracted from `golden-config.ts` so that assembly file
 * (types, the `goldenWorkflowFiles` table, the gate) stays under the file-length
 * cap. Each constant is one file's body *without* the managed header, which
 * `ensure-workflow-files.ts` prepends at write time. Pure string data — no imports,
 * no logic. See `golden-config.ts` for how they are assembled into the golden set.
 *
 * Every body here is a **thin reference** to a shared CI product — a SHA-pinned
 * reusable-workflow caller or composite-action consumer that Dependabot keeps
 * current — or a short starting config a repo tailors. The one golden file whose
 * behaviour is implemented *inline* lives in `golden-commit-convention.ts`.
 */

// Consumer-shape `bot-automerge` workflow — a thin CONSUMER of the
// rmartz/bot-automerge-action composite action (SHA-pinned + version comment, so
// Dependabot's github-actions ecosystem bumps the pin, and the CLI version the
// action installs tracks its release in lockstep). bot-automerge ships from its own
// repo (#264), *expanded* from the old inline Dependabot-only auto-merge to also
// cover release-please release PRs: it enables GitHub-native auto-merge for
// trustworthy bot PRs (green Dependabot patch/minor bumps — majors stay manual —
// plus release-please release PRs), and the action owns the bot-detection +
// update-type/PR-type classification + `gh pr merge --auto` enablement. It
// superseded the reusable-workflow caller form (#282). The consumer carries the
// real trigger and the write scopes and passes two inputs: `pr` (required — unlike
// the reusable workflow, the action does not derive it from the event), and
// `release-please-token`. A composite action cannot `secrets: inherit`, so the
// release-please PAT must be passed explicitly: a release-PR merge enabled via
// GITHUB_TOKEN never re-triggers the consumer's release CD (#236). It is passed
// unconditionally — where the secret is unset it is empty and the action falls back
// to `github.token`. No checkout is needed: the action installs its CLI into its own
// directory and acts on the PR via the API. The trigger is `pull_request_target`
// (NOT `pull_request`) — required so Dependabot's read-only-token PRs get
// base-context write. It stays **gated**: its `goldenWorkflowFiles` entry keeps
// `gateChecks: ['merge-safety']`, so the hermetic writer withholds its *creation*
// until merge-safety is a satisfied required check (an ungated `gh pr merge --auto`
// merges immediately). It is a `seed` file (see the per-file seed-vs-manage
// principle in golden-config.ts) — a self-updating reference, so bootstrap seeds it
// once and Dependabot owns the pin thereafter.
export const BOT_AUTOMERGE = `name: bot-automerge

on:
  pull_request_target:
    types: [opened, reopened, synchronize, labeled]

permissions:
  contents: write
  pull-requests: write
  packages: read

jobs:
  bot-automerge:
    runs-on: ubuntu-latest
    steps:
      - uses: rmartz/bot-automerge-action@c71f5dfdeb4e275ee80b8b0c92de817f2edb68e0 # v1.0.2
        with:
          pr: \${{ github.event.pull_request.number }}
          release-please-token: \${{ secrets.RELEASE_PLEASE_PAT }}
`;

// Consumer-shape `merge-safety` workflow — a thin CALLER of the rmartz/merge-safety
// reusable workflow (SHA-pinned + version comment, so Dependabot's github-actions
// ecosystem bumps it, and the CLI version it installs tracks the release in
// lockstep). merge-safety now ships from its own repo (extracted from
// @rmartz/pr-review, #247). The caller carries the real triggers
// (pull_request_target/push/check_suite/workflow_dispatch) and the write scopes,
// threads the dispatch `pr` input via `with:`, and `secrets: inherit`; the reusable
// side is `on: workflow_call` and owns the evaluate-vs-invalidate branch + the
// label-narrowing logic.
// The PR trigger is `pull_request_target` (NOT `pull_request`) — GitHub does not
// dispatch `pull_request` runs for an unmergeable PR (it cannot build the
// `refs/pull/N/merge` commit those runs check out), so a required `merge-safety`
// check would sit "Expected — waiting for status" forever on exactly the conflicting
// PR where the verdict matters most (#272). `pull_request_target` fires in base
// context with no merge commit; it is safe here because the reusable `evaluate` job
// checks out the base ref, fetches the PR head only as git data, and runs the
// published CLI — never PR-authored code. `check_suite: [completed]` re-holds/releases
// open PRs when the base branch's own CI flips red/green.
// Advisory by default: seeding it makes the `merge-safety`
// check *run*; making it a required gate is the separate per-repo curation step.
// It is a `seed` file (see the per-file seed-vs-manage principle in
// golden-config.ts) — a self-updating reference, so bootstrap seeds it once and
// Dependabot owns the pin thereafter.
export const MERGE_SAFETY = `name: merge-safety

on:
  pull_request_target:
    types: [opened, synchronize, reopened, edited, labeled, unlabeled]
  push:
    branches: [main]
  check_suite:
    types: [completed]
  workflow_dispatch:
    inputs:
      pr:
        description: PR number to evaluate
        required: true

permissions:
  checks: write
  pull-requests: write
  contents: read
  actions: write
  packages: read

jobs:
  merge-safety:
    uses: rmartz/merge-safety/.github/workflows/merge-safety.yml@db145fb8c20164185eb9e1a1c237dc4d9085c69f # v0.1.0
    with:
      pr: \${{ inputs.pr }}
    secrets: inherit
`;

// Generic Dependabot config, seeded (write-if-absent) as a starting point repos
// then own. github-actions is the minimum every repo wants (it keeps pinned
// action SHAs — including the bot-automerge consumer's composite-action pin — fresh);
// the npm ecosystem is the ideal for the JS repos this toolkit targets (it also
// feeds the native auto-merge path). Both are grouped so related bumps land as one PR.
// A repo without an npm manifest, or wanting other ecosystems, edits its copy —
// which the `seed` policy then leaves untouched.
export const DEPENDABOT_CONFIG = `version: 2
updates:
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
    groups:
      github-actions:
        patterns:
          - "*"
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
    groups:
      dev-dependencies:
        dependency-type: development
      production-dependencies:
        dependency-type: production
`;

// Generic repo-hygiene CI, consumer shape — a thin consumer of the
// rmartz/repo-hygiene-action COMPOSITE ACTION (a step-level `- uses:`), replacing
// the earlier reusable-workflow caller (#278). SHA-pinned with a version comment,
// so Dependabot's github-actions ecosystem bumps the pin (and the CLI version the
// action ships in its own lockfile, in lockstep) via reviewable PRs — updates,
// including newly-added universally-safe checks, propagate with no per-repo YAML
// edit and no bootstrap re-manage. The job MUST run `actions/checkout` before the
// action step — the action scans `$GITHUB_WORKSPACE` and never checks out itself —
// and a *plain shallow* checkout suffices: the checks are tree-based, so no
// `fetch-depth: 0` (unlike merge-safety). Passing no `checks:` input runs the
// package's registry-derived default-on set (the universally-safe checks); a repo
// opts into repo-specific checks (e.g. `okf`, `docs-links`) and points `config:` at
// its `.repo-hygiene.yml` by adding those inputs to its own copy. Only
// `packages: read` is needed at runtime — the action reads the public
// @rmartz/repo-hygiene from GitHub Packages via the default `github.token`, so no
// Dependabot PAT (that is only for repos holding @rmartz/* as an npm dep).
//
// CHECK-NAME CONVENTION (fleet-wide, #299) — the `hygiene` job deliberately sets no
// `name:`, so GitHub posts the check under the bare job id, `hygiene`. That is the
// rule, not an omission: a check supplied by one of the SHARED CI PRODUCTS is
// lowercase-kebab (`hygiene`, `merge-safety`, `bot-automerge`), while a job a
// repo DEFINES ITSELF is Title Case and human-readable (`Build`, `Format`, `Lint`,
// `Test`, `Typecheck`, `Validate PR title`, and COMMIT_CONVENTION's
// `Validate commit subjects on main` in `golden-commit-convention.ts` — which sets
// an explicit `name:` for exactly that reason). The casing encodes *who owns the check*, which is why the
// #278 reusable-workflow → composite-action migration shortened the context from
// `hygiene / Repo hygiene` to plain `hygiene` without moving it across the rule:
// the supplier is still the shared repo-hygiene product. Do not "correct" this to
// `Hygiene`.
// BLAST RADIUS: a check's name *is* its required-status-check context. Renaming it
// blocks every consumer's PRs against a context that can never post, until each
// repo's ruleset is updated in the SAME rollout — that is what left four migration
// PRs stuck at BLOCKED (rmartz/repo-hygiene#65 and siblings). Treat any rename as a
// fleet-wide, lockstep change, never a local edit. (One known outlier, internally
// consistent but divergent: rmartz/group-picks names its job `Hygiene` and requires
// that context.)
export const REPO_HYGIENE = `name: repo-hygiene

on:
  pull_request:
  push:
    branches: [main]

jobs:
  hygiene:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: read
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - uses: rmartz/repo-hygiene-action@66118369122afacf29241703137f60cbfa0315f0 # v1.0.0
`;
