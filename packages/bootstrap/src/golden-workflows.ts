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
 * behaviour is implemented *inline* lives in `golden-commit-convention.ts`; the
 * `pr-policy` caller lives in `golden-pr-policy.ts`.
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
// `token`. A composite action cannot `secrets: inherit`, so the real-actor
// `BOT_AUTOMERGE_TOKEN` PAT must be passed explicitly: GitHub fires no `push`
// workflows for a merge whose auto-merge was enabled with GITHUB_TOKEN, so a merged
// Dependabot bump or release PR would never re-trigger the consumer's release CD
// (#236, rmartz/bot-automerge-action#31). The repo stores it as both an Actions and
// a Dependabot secret, since a Dependabot-triggered run sees only the latter. It is
// passed unconditionally — where the secret is unset it is empty and the action
// falls back to `github.token`. v2.x installs its CLI from npmjs, so no
// `packages: read`. No checkout is needed: the action installs its CLI into its own
// directory and acts on the PR via the API. The trigger is `pull_request_target`
// (NOT `pull_request`) — required so Dependabot's read-only-token PRs get
// base-context write. It stays **gated**: its `goldenWorkflowFiles` entry keeps
// `gateChecks: ['merge-safety']`, so the hermetic writer withholds its *creation*
// until merge-safety is a satisfied required check (an ungated `gh pr merge --auto`
// merges immediately). It is a `seed` file (see the per-file seed-vs-manage
// principle in golden-config.ts) — a self-updating reference, so bootstrap seeds it
// once and Dependabot owns the pin thereafter. The job skips fork PRs
// (GHSA-39fm-72q5-676g): a fork picks its own branch name, so it could pose as a
// release-please PR under this write-token trigger. The action rejects forks
// itself from v1.1.1; the job-level guard is a second layer in case an older pin
// comes back. The pin must stay at v2.0.0 or later, the first release with the
// `token` input. The job guard deliberately has no `autorelease: pending` label
// condition: from v2.0.0 the CLI detects release-please PRs by `release-please--`
// head branch only (rmartz/bot-automerge#41, GHSA-4f7f-7fcp-gcm6).
export const BOT_AUTOMERGE = `name: bot-automerge

on:
  pull_request_target:
    types: [opened, reopened, synchronize, labeled]

permissions:
  contents: write
  pull-requests: write

jobs:
  bot-automerge:
    if: github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-latest
    steps:
      - uses: rmartz/bot-automerge-action@3e26c765f2da6c360fd39ab8aef7a50090a96657 # v2.1.1
        with:
          pr: \${{ github.event.pull_request.number }}
          token: \${{ secrets.BOT_AUTOMERGE_TOKEN }}
`;

// Consumer-shape `merge-safety` workflow — a thin consumer of the
// rmartz/merge-safety-action COMPOSITE ACTION (a step-level `- uses:`), SHA-pinned +
// version comment so Dependabot's github-actions ecosystem bumps it; each action
// release pins a specific @rmartz/merge-safety CLI in its lockfile. It supersedes
// the rmartz/merge-safety reusable-workflow caller, which is deprecated. The
// consumer carries the real triggers (pull_request_target/push/check_suite/
// workflow_dispatch) and the write scopes, threads the dispatch `pr` input via
// `with:`, and owns the job: an `if:` that skips (without a runner) the events the
// action would no-op on, and a concurrency group that serializes base-moved
// fan-outs per branch while giving each per-PR evaluate run its own group (run_id),
// so a burst of PR events never cancels a run. The action picks evaluate vs
// invalidate from the event and re-dispatches the workflow it runs in, and needs no
// checkout (it fetches git data into $RUNNER_TEMP).
// The PR trigger is `pull_request_target` (NOT `pull_request`) — GitHub does not
// dispatch `pull_request` runs for an unmergeable PR (it cannot build the
// `refs/pull/N/merge` commit those runs check out), so a required `merge-safety`
// check would sit "Expected — waiting for status" forever on exactly the conflicting
// PR where the verdict matters most (#272). `pull_request_target` fires in base
// context with no merge commit; it is safe here because the action fetches the PR
// head only as git data and runs the published CLI — never PR-authored code.
// `check_suite: [completed]` re-holds/releases open PRs when the base branch's own
// CI flips red/green.
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
  statuses: write # mirror the verdict to the merge-safety commit status (rmartz/merge-safety#73)
  pull-requests: write
  contents: read
  actions: write

jobs:
  merge-safety:
    if: >-
      (github.event_name != 'push' && github.event_name != 'check_suite') ||
      (github.event_name == 'push' && startsWith(github.ref, 'refs/heads/') && !github.event.deleted) ||
      (github.event_name == 'check_suite' &&
       github.event.check_suite.app.slug == 'github-actions' &&
       github.event.check_suite.head_branch == github.event.repository.default_branch)
    concurrency:
      group: >-
        \${{ (github.event_name == 'push' || github.event_name == 'check_suite')
        && format('merge-safety-invalidate-{0}', github.event_name == 'push' && github.ref_name || github.event.check_suite.head_branch)
        || format('merge-safety-evaluate-{0}', github.run_id) }}
      cancel-in-progress: false
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: rmartz/merge-safety-action@a327f9599a1da413a08e4b831d8babe075935e27 # v0.1.0
        with:
          pr: \${{ inputs.pr }}
`;

// Generic Dependabot config, seeded (write-if-absent) as a starting point repos
// then own. github-actions is the minimum every repo wants (it keeps pinned
// action SHAs — including the bot-automerge consumer's composite-action pin — fresh);
// the npm ecosystem is the ideal for the JS repos this toolkit targets (it also
// feeds the native auto-merge path). Patch and minor bumps are grouped so they land
// as one auto-mergeable PR; a major matches no group, so Dependabot opens it as its
// own PR for review instead of holding the whole group (rmartz/ai
// repository-checklist §Supply chain). A repo without an npm manifest, or wanting
// other ecosystems, edits its copy — which the `seed` policy then leaves untouched.
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
        update-types:
          - minor
          - patch
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
    groups:
      dev-dependencies:
        dependency-type: development
        update-types:
          - minor
          - patch
      production-dependencies:
        dependency-type: production
        update-types:
          - minor
          - patch
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
// its `.repo-hygiene.yml` by adding those inputs to its own copy. Since v3.1.0 the
// action installs the public @rmartz/repo-hygiene from npmjs with no auth, so there
// is no `packages: read` and no Dependabot PAT. Since v3.2.0 it posts one commit
// status per check (`repo-hygiene / <check>`) with the default `github.token`, which
// needs `statuses: write` — without it the action only warns, but the golden grants
// it so the per-check breakdown works out of the box.
//
// CHECK-NAME CONVENTION (fleet-wide, #299) — the `hygiene` job deliberately sets no
// `name:`, so GitHub posts the check under the bare job id, `hygiene`. That is the
// rule, not an omission: a check supplied by one of the SHARED CI PRODUCTS is
// lowercase-kebab (`hygiene`, `merge-safety`, `bot-automerge`, `pr-policy`), while a job a
// repo DEFINES ITSELF is Title Case and human-readable (`Build`, `Format`, `Lint`,
// `Test`, `Typecheck`, and COMMIT_CONVENTION's
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
      statuses: write
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - uses: rmartz/repo-hygiene-action@bca5c484060d5d608333810b4e042cd39c59f7a9 # v3.2.0
`;
