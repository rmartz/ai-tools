/**
 * The golden `pr-policy.yml` body — a thin, SHA-pinned consumer of the
 * `rmartz/pr-policy-action` composite action, which runs the `@rmartz/pr-policy`
 * read-only PR content checks and posts their one verdict as the `pr-policy` check.
 * It replaces the inline `pr-title-lint.yml` (context `Validate PR title`) the fleet
 * is retiring: pr-policy's `title` check validates the same conventional-commit
 * grammar, plus the breaking-marker and type rules. Pure string data — no logic.
 * See `golden-config.ts` for how it is assembled into the golden set.
 */

// Consumer-shape `pr-policy` workflow. Like the other thin references in
// `golden-workflows.ts`, the Action is pinned by full SHA with a `# vX.Y.Z` comment,
// so Dependabot's github-actions ecosystem bumps it and new checks reach the repo
// with no per-repo edit; bootstrap seeds it once and the repo owns it thereafter.
//
// UAT variant. Bootstrap has no project-type signal (it never inspects the repo for
// Next.js or Vercel), so it seeds the fleet default: `skip-uat: true`, for repos
// with nothing to user-test (npm packages, Actions, reusable workflows, tooling).
// A Next.js/Vercel app repo keeps the UAT gate by deleting the `skip-uat` line in
// its copy (and saying so in the header comment). The flag lives in this
// default-branch caller so a PR cannot switch off a gate it would otherwise wait on.
//
// The trigger is `pull_request_target` (safe: nothing checks out or runs PR code,
// the Action reads everything through the API) so fork and Dependabot PRs still get
// a write token for the check-run, status, and label. A consequence: the caller
// first runs on a PR only after it is on the default branch, so `pr-policy` can be
// made a required check only once it has posted on a PR — see docs/packages/
// bootstrap.md. The job is deliberately named `pr-policy (evaluate)`, not
// `pr-policy`: the Action posts its own check-run and status under that exact name
// (the lowercase shared-product half of the check-name convention at REPO_HYGIENE in
// `golden-workflows.ts`), and a same-named job would add a second, always-green
// entry. A CI check, not an auto-merger, so its golden entry has `gateChecks: []`.
export const PR_POLICY = `name: pr-policy

# Runs the @rmartz/pr-policy read-only PR content checks via
# rmartz/pr-policy-action, which posts the \`pr-policy\` verdict (a check-run and a
# matching commit status) and owns the \`CI approval needed\` label. The checks are
# listed in rmartz/pr-policy's docs/checks/index.md.
#
# skip-uat: this repo has nothing to user-test, so the UAT gate is off. It is set
# here, in the default-branch caller, so a PR can't switch off a gate it would
# otherwise wait on.
#
# pull_request_target is safe here only because nothing checks out or runs the
# PR's code; the Action reads everything through the API. It is needed so fork
# and Dependabot PRs still get a write token for the check-run, status, and label.

on:
  pull_request_target:
    types: [opened, synchronize, reopened, edited, labeled, unlabeled]

permissions:
  checks: write # post the pr-policy check-run
  pull-requests: write # write the labels pr-policy owns (CI approval needed)
  contents: read # read changed files at the merge base and head
  statuses: write # post the pr-policy commit status and one per policy check (pr-policy / <check>)

concurrency:
  group: pr-policy-\${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  # Not named \`pr-policy\`: the Action posts its own check-run and status under that
  # exact name, and a same-named job would add a second, always-green entry.
  pr-policy:
    name: pr-policy (evaluate)
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: rmartz/pr-policy-action@cdb083960965d0b2cc5033271186ec04020f87f4 # v1.4.5
        with:
          pr: \${{ github.event.pull_request.number }}
          skip-uat: true
`;
