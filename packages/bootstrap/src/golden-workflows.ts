/**
 * The verbatim golden **workflow / config file bodies** distributed to every repo
 * — the bulky data half extracted from `golden-config.ts` so that assembly file
 * (types, the `goldenWorkflowFiles` table, the gate) stays under the file-length
 * cap. Each constant is one file's body *without* the managed header, which
 * `ensure-workflow-files.ts` prepends at write time. Pure string data — no imports,
 * no logic. See `golden-config.ts` for how they are assembled into the golden set.
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
// (pull_request/push/workflow_dispatch) and the write scopes, threads the dispatch
// `pr` input via `with:`, and `secrets: inherit`; the reusable side is
// `on: workflow_call` and owns the evaluate-vs-invalidate branch + the
// label-narrowing logic. Advisory by default: seeding it makes the `merge-safety`
// check *run*; making it a required gate is the separate per-repo curation step.
// It is a `seed` file (see the per-file seed-vs-manage principle in
// golden-config.ts) — a self-updating reference, so bootstrap seeds it once and
// Dependabot owns the pin thereafter.
export const MERGE_SAFETY = `name: merge-safety

on:
  pull_request:
    types: [opened, synchronize, reopened, edited, labeled, unlabeled]
  push:
    branches: [main]
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

// Post-merge conventional-commit tripwire. A `push: [main]` alert (it can't gate
// — the commit is already merged) that fails loudly when a subject reaches the
// default branch without a valid conventional-commit prefix. It catches the exact
// silent-skip that pre-merge `pr-title-lint` cannot see: a squash-merge setting
// that used the branch commit message instead of the PR title, a direct push, or
// a squash that dropped the prefix — any of which makes release-please silently
// skip the release. Validates the first-parent chain of the pushed range (so a
// squash merge is its single new commit, a stray merge commit is flagged, and a
// merged branch's internal plain commits are not re-litigated). `actions/checkout`
// is pinned by full SHA + `major.minor.patch` comment per the Actions-pinning
// convention; `push` fires on `main` (a non-`main` repo adjusts that one literal).
export const COMMIT_CONVENTION = `name: Conventional Commits (main)

on:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  commit-convention:
    name: Validate commit subjects on main
    runs-on: ubuntu-latest
    timeout-minutes: 2
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          fetch-depth: 0 # the pushed range's history must be present to read subjects
      - name: Validate new commit subjects
        env:
          BEFORE: \${{ github.event.before }}
          AFTER: \${{ github.event.after }}
        run: |
          set -euo pipefail
          # Conventional-commit subject grammar — mirrors pr-title-lint.yml.
          pattern='^(feat|fix|docs|chore|refactor|test|style|perf|ci|build|revert)(\\([^)]+\\))?!?: [^[:space:]].*$'
          # On a branch's first push BEFORE is all-zeros; validate just the tip.
          if printf '%s' "$BEFORE" | grep -qE '^0+$'; then
            revs="$AFTER"
          else
            revs="$(git rev-list --first-parent "\${BEFORE}..\${AFTER}")"
          fi
          status=0
          for sha in $revs; do
            subject="$(git show -s --format=%s "$sha")"
            if printf '%s\\n' "$subject" | grep -qE "$pattern"; then
              echo "ok:   $sha $subject"
            else
              echo "FAIL: $sha $subject"
              status=1
            fi
          done
          if [ "$status" -ne 0 ]; then
            echo
            echo "A commit reached \${GITHUB_REF_NAME:-main} with a non-conventional subject."
            echo "release-please only releases conventional commits, so it silently skips a"
            echo "non-conventional one. Likely cause: a squash merge used the branch commit"
            echo "message instead of the PR title. Set the repo squash-merge default to"
            echo "'PR_TITLE' (ai-verify-squash-setting --apply) so PR titles reach main."
            exit 1
          fi
          echo "All new commit subjects are valid conventional commits."
`;
