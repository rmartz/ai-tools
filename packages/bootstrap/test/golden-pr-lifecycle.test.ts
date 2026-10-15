import { describe, it, expect } from 'vitest';

import { goldenWorkflowFiles } from '../src/golden-config.js';

// Bootstrap seeds the pr-lifecycle reconciler labels-only, the first step of the
// fleet cutover (rmartz/pr-lifecycle#75). Arming is a later per-repo step.
const prLifecycle = goldenWorkflowFiles.find(
  (w) => w.filename === '.github/workflows/pr-lifecycle.yml',
);
const content = prLifecycle?.content ?? '';

describe('goldenWorkflowFiles — the pr-lifecycle caller is seeded', () => {
  it('is present in the golden set', () => {
    expect(prLifecycle).toBeDefined();
  });

  it('needs no gate check of its own (labels-only, not an auto-merger)', () => {
    expect(prLifecycle?.gateChecks).toEqual([]);
  });
});

describe('pr-lifecycle — a thin, SHA-pinned consumer of rmartz/pr-lifecycle-action', () => {
  it('pins the Action to a full 40-char SHA with a major.minor.patch comment', () => {
    expect(content).toMatch(/uses: rmartz\/pr-lifecycle-action@[0-9a-f]{40} # v\d+\.\d+\.\d+\n/);
  });

  it('runs on pull_request_target, including review requests', () => {
    expect(content).toContain('pull_request_target:');
    expect(content).toContain('- review_requested');
    expect(content).toContain('- review_request_removed');
    expect(content).not.toMatch(/^\s+pull_request:/m);
  });

  it('re-reconciles when CI completes', () => {
    expect(content).toContain('workflow_run:');
    expect(content).toContain('workflows: [CI, repo-hygiene]');
  });

  it('never checks out the PR (pull_request_target runs with a write token)', () => {
    expect(content).not.toContain('actions/checkout');
  });

  it('grants GITHUB_TOKEN nothing, since the App token does every read and write', () => {
    expect(content).toMatch(/^permissions: \{\}$/m);
  });
});

// Labels and API calls go through the rmartz-merge-bot App, not GITHUB_TOKEN, so
// they are attributed to the bot and use the App's own rate-limit pool
// (rmartz/scripts#22, matching rmartz/personal-budget#553).
describe('pr-lifecycle — runs with the rmartz-merge-bot App token', () => {
  it('mints the token from the shared MERGE_BOT secrets with a SHA-pinned step', () => {
    expect(content).toMatch(
      /uses: actions\/create-github-app-token@[0-9a-f]{40} # v\d+\.\d+\.\d+\n\s+id: app-token\n/,
    );
    expect(content).toContain('client-id: ${{ secrets.MERGE_BOT_CLIENT_ID }}');
    expect(content).toContain('private-key: ${{ secrets.MERGE_BOT_PRIVATE_KEY }}');
  });

  it('scopes the token to only the read and label permissions a labels-only run needs', () => {
    expect(content).toContain('permission-pull-requests: write');
    expect(content).toContain('permission-contents: read');
    expect(content).toContain('permission-checks: read');
    expect(content).toContain('permission-statuses: read');
    expect(content).toContain('permission-actions: write');
    expect(content).not.toContain('permission-contents: write');
  });

  it('passes the App token as github-token', () => {
    expect(content).toContain('github-token: ${{ steps.app-token.outputs.token }}');
  });

  it("skips the label and review-request events the App's own writes cause", () => {
    expect(content).toContain("github.event.sender.login == 'rmartz-merge-bot[bot]'");
    expect(content).toContain(
      `contains(fromJSON('["labeled", "unlabeled", "review_requested", "review_request_removed"]'),`,
    );
    expect(content).toContain("!(github.event_name == 'pull_request_target' &&");
  });

  it('keeps the fork-review guard', () => {
    expect(content).toContain("(github.event_name != 'pull_request_review' ||");
  });
});

// Arming without the repo's required checks in place merges immediately, so the
// seed must never arm; a repo turns it on deliberately later.
describe('pr-lifecycle — labels only', () => {
  it('turns arming off explicitly', () => {
    expect(content).toMatch(/^\s+arm-auto-merge: false$/m);
  });

  it('passes no real-actor token, so it cannot arm, merge, or update a branch', () => {
    expect(content).not.toMatch(/^\s+token:/m);
    expect(content).not.toContain('auto-update: true');
  });
});
