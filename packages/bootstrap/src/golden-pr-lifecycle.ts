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
//
// Every read and label write goes through an installation token for the private
// `rmartz-merge-bot` GitHub App, passed as `github-token` (not the real-actor
// `token`, so labels-only still holds). It is minted the same way as in
// bot-automerge.yml, from the same `MERGE_BOT_CLIENT_ID` / `MERGE_BOT_PRIVATE_KEY`
// secrets, so it adds no new provisioning: labels are attributed to the bot and API
// calls draw on the App's own rate-limit pool, not the user's (rmartz/scripts#22,
// matching rmartz/personal-budget#553). `permissions: {}` because GITHUB_TOKEN is
// unused. With the secrets unset the token step fails closed rather than falling
// back to GITHUB_TOKEN. App-authored events, unlike GITHUB_TOKEN ones, trigger
// workflows, so the job skips the label and review-request events the App itself
// sends; the login is hard-coded like the secret names, since the fleet shares one App.
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
#
# Every read and write goes through an installation token for the
# rmartz-merge-bot GitHub App, not GITHUB_TOKEN, so labels are attributed to the
# bot and API calls draw on the App's own rate-limit pool rather than the
# user's (rmartz/scripts#22). Unlike GITHUB_TOKEN, App-authored events trigger
# workflows, so the job skips the label and review-request events the App
# itself causes; see the job's \`if\`.

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

# GITHUB_TOKEN is unused: the App token below carries every permission the
# action needs.
permissions: {}

jobs:
  reconcile:
    # A review on a fork PR runs with a read-only token and no secrets, so it
    # cannot write labels; skip it. The fork PR is reconciled on its next
    # pull_request_target event, or on demand via workflow_dispatch.
    #
    # Also skip the label and review-request events this workflow's own writes
    # cause. Every run recomputes the PR from its current facts, so the run that
    # wrote them already converged, and a follow-up run would only no-op while
    # cancelling the in-flight writer. Only the App's own login is excluded: a
    # label from a person or another workflow still re-reconciles.
    if: >-
      (github.event_name != 'pull_request_review' ||
      github.event.pull_request.head.repo.full_name == github.repository) &&
      !(github.event_name == 'pull_request_target' &&
      github.event.sender.login == 'rmartz-merge-bot[bot]' &&
      contains(fromJSON('["labeled", "unlabeled", "review_requested", "review_request_removed"]'),
      github.event.action))
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
      # The App's Client ID and private key are stored as both Actions and
      # Dependabot secrets (a Dependabot-triggered run sees only the latter). The
      # step fails closed if they are missing or the App lacks a permission.
      - uses: actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1 # v3.2.0
        id: app-token
        with:
          client-id: \${{ secrets.MERGE_BOT_CLIENT_ID }}
          private-key: \${{ secrets.MERGE_BOT_PRIVATE_KEY }}
          permission-pull-requests: write # labels, review requests
          permission-contents: read # branch rules, base head, commits for approval carry-over
          permission-checks: read # the CI gate
          permission-statuses: read # the CI gate
          permission-actions: write # report a transient failure as a cancelled run
      - uses: rmartz/pr-lifecycle-action@1916e94c1956f3cef31ac6496a03ffb3d4824f33 # v4.2.1
        with:
          github-token: \${{ steps.app-token.outputs.token }}
          arm-auto-merge: false
`;
