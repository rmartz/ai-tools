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

// Consumer-shape `bot-automerge` workflow — a thin CALLER of the
// rmartz/bot-automerge reusable workflow (SHA-pinned + version comment, so
// Dependabot's github-actions ecosystem bumps the pin, and the CLI version it
// installs tracks the release in lockstep). bot-automerge ships from its own repo
// (#264), *expanded* from the old inline Dependabot-only auto-merge to also cover
// release-please release PRs: it enables GitHub-native auto-merge for trustworthy
// bot PRs (green Dependabot patch/minor bumps — majors stay manual — plus
// release-please release PRs), and the reusable side (`on: workflow_call`) owns the
// bot-detection + update-type/PR-type classification + `gh pr merge --auto`
// enablement. The caller carries the real trigger and the write scopes and
// `secrets: inherit`; the reusable workflow derives the PR from the event context,
// so no `with:` input is needed. The trigger is `pull_request_target` (NOT
// `pull_request`) — required so Dependabot's read-only-token PRs get base-context
// write. It stays **gated**: its `goldenWorkflowFiles` entry keeps
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
    uses: rmartz/bot-automerge/.github/workflows/bot-automerge.yml@139f4ce609c2dfe65f1e090c00f17204bfce1b3e # v0.1.1
    secrets: inherit
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
// action SHAs — including the bot-automerge caller's reusable-workflow pin — fresh);
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
// lowercase-kebab (`hygiene`, `merge-safety`, `bot-automerge`, `ci-change-guard`),
// while a job a repo
// DEFINES ITSELF is Title Case and human-readable (`Build`, `Format`, `Lint`,
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

// Consumer-shape `ci-change-guard` workflow — a thin CALLER of the
// rmartz/ci-change-guard reusable workflow (SHA-pinned + version comment, so
// Dependabot's github-actions ecosystem bumps the pin and the `action-pins` hygiene
// check passes; the CLI version it installs is resolved from the release tag at that
// same pinned commit, so the two move in lockstep and nothing writes a version into
// this file). The guard classifies a PR's `.github/workflows/**` diff as *tightening*
// or *loosening*, posts the `ci-change-guard` check-run, and reconciles the
// `CI approval needed` merge-gate label; a human clears the gate by applying
// `CI change approved`, which the guard never applies itself. Extracted from
// `review.md` Step 5 (#302): the gate was already structural, but its producer was an
// LLM review step, so a PR that was never reviewed skipped the gate entirely.
//
// The trigger is `pull_request_target` (NOT `pull_request`) — a fork PR and *every*
// Dependabot PR get a read-only token under `pull_request`, so the guard could post
// neither the check-run nor the label on precisely the PRs that most often touch
// workflow files (Dependabot's own action bumps). It is safe here because the
// reusable workflow never checks out or executes PR code: it reads the workflow blobs
// through the API, so the elevated token never meets untrusted code.
// `labeled`/`unlabeled` are load-bearing trigger types — applying `CI change approved`
// is the human act that clears the gate, and it arrives as a label event — and
// `synchronize` is what keeps the label tracking the head while nobody has signed off.
//
// It is **ungated** (`gateChecks: []`, see golden-config.ts): the guard posts a
// `neutral`, never-failing check-run and enforces at the merge queue via the
// `CI approval needed` label, so unlike the auto-merge caller there is no
// merges-immediately hazard for the hermetic writer to withhold against. Like its
// siblings it is a `seed` file — a self-updating reference, so bootstrap seeds it once
// and Dependabot owns the pin thereafter.
export const CI_CHANGE_GUARD = `name: ci-change-guard

on:
  # pull_request_target (not pull_request) because a fork PR and EVERY Dependabot
  # PR get a read-only token under \`pull_request\` — the guard could post neither
  # the check-run nor the label on precisely the PRs that most often touch
  # workflow files (Dependabot's own action bumps). The reusable workflow never
  # checks out or executes PR code; it reads the workflow blobs through the API,
  # so the elevated token never meets untrusted code.
  pull_request_target:
    # \`labeled\`/\`unlabeled\` are load-bearing: applying \`CI change approved\` is the
    # human act that clears the gate, and it arrives as a label event.
    # \`synchronize\` is what makes the label track the head while nobody has signed
    # off — a push that removes the loosening removes the label with it.
    types: [opened, synchronize, reopened, labeled, unlabeled]
  workflow_dispatch:
    inputs:
      pr:
        description: PR number to evaluate
        required: true

permissions:
  checks: write # post the ci-change-guard check-run
  pull-requests: write # reconcile the \`CI approval needed\` merge-gate label
  contents: read # read the workflow blobs at the merge base and at head
  packages: read # install @rmartz/ci-change-guard from GitHub Packages

jobs:
  ci-change-guard:
    uses: rmartz/ci-change-guard/.github/workflows/ci-change-guard.yml@f88d32d70864d0db202a99a37fb6ae66d539bb7b # v0.1.0
    with:
      pr: \${{ inputs.pr }}
    secrets: inherit
`;
