/**
 * The golden `pr-lifecycle.yml` body — a thin, SHA-pinned consumer of the
 * `rmartz/pr-lifecycle-action` composite action, which runs the `@rmartz/pr-lifecycle`
 * reconciler: on every relevant PR event it recomputes the PR's lifecycle state from
 * its current facts and converges the lifecycle labels. Pure string data — no logic.
 * See `golden-config.ts` for how it is assembled into the golden set.
 */

// Consumer-shape `pr-lifecycle` workflow, seeded **labels-only**. `arm-auto-merge`
// is off and no real-actor token is passed, so it never arms, merges, disarms, or
// updates a branch. That is the first step of the fleet cutover
// (rmartz/pr-lifecycle#75): bot-automerge keeps arming eligible bot PRs until a
// repo removes it and turns arming on, and only then does the repo need the
// `merge-safety` gate for this file. So, like pr-policy, it is not an auto-merger
// here and its golden entry has `gateChecks: []`.
//
// Like the other thin references, the Action is pinned by full SHA with a `# vX.Y.Z`
// comment, so Dependabot's github-actions ecosystem bumps it (and the CLI version
// the action pins) with no per-repo edit. The trigger is `pull_request_target` (safe:
// the Action reads the PR over the API and never checks out PR code) so Dependabot
// and fork PRs still get a token that can write labels.
//
// `workflow_run` must name the Actions workflows behind the repo's required checks,
// so CI completing re-runs the reconcile. Bootstrap has no signal for those names,
// so it seeds `CI` and the golden `repo-hygiene` workflow; a repo whose required
// checks come from other workflows edits the list in its copy.
export const PR_LIFECYCLE = `name: pr-lifecycle
# Shows which event and action started each run (e.g. pull_request_target /
# review_requested), so the run list says what re-reconciled a PR.
run-name: pr-lifecycle (\${{ github.event_name }}\${{ github.event.action && format('/{0}', github.event.action) || '' }})

# Runs the @rmartz/pr-lifecycle reconciler via rmartz/pr-lifecycle-action: on every
# relevant event it recomputes each PR's lifecycle state and converges its labels.
#
# Labels only: arm-auto-merge is off and no real-actor token is passed, so this
# never arms, merges, disarms, or updates a branch. Turning arming on is a later,
# per-repo step; see rmartz/pr-lifecycle-action docs/consuming.md.
#
# pull_request_target is safe here only because nothing checks out or runs the
# PR's code; the Action reads everything through the API.

on:
  pull_request_target:
    types:
      - opened
      - reopened
      - ready_for_review
      - converted_to_draft
      - synchronize
      - edited
      - labeled
      - unlabeled
      - review_requested
      - review_request_removed
  pull_request_review:
    types: [submitted, dismissed, edited]
  # CI completion re-routes a PR through the CI gate. check_suite never fires for
  # suites GitHub Actions creates, so workflow_run lists the Actions workflows
  # behind this repo's required checks: edit it to match.
  check_suite:
    types: [completed]
  workflow_run:
    workflows: [CI, repo-hygiene]
    types: [completed]
  workflow_dispatch:
    inputs:
      pr:
        description: PR number to reconcile
        required: true

permissions:
  pull-requests: write # labels, review requests
  contents: read # branch rules, base head, commits for approval carry-over
  checks: read # the CI gate
  statuses: read # the CI gate
  actions: write # report a transient failure as a cancelled run

jobs:
  reconcile:
    # A review on a fork PR runs with a read-only token and no secrets, so it
    # cannot write labels; skip it. The fork PR is reconciled on its next
    # pull_request_target event, or on demand via workflow_dispatch.
    if: >-
      github.event_name != 'pull_request_review' ||
      github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-latest
    timeout-minutes: 5
    # One run per PR at a time; a newer event supersedes an in-flight run, since
    # every run recomputes the PR from its current facts.
    concurrency:
      group: >-
        pr-lifecycle-\${{ github.event.pull_request.number || inputs.pr ||
        github.event.workflow_run.head_sha || github.event.check_suite.head_sha }}
      cancel-in-progress: true
    steps:
      - uses: rmartz/pr-lifecycle-action@5db77fd5c50f0f63020e06fcceef603fa8cda944 # v4.2.0
        with:
          arm-auto-merge: false
`;
