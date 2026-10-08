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

  it('grants only the read and label scopes a labels-only run needs', () => {
    expect(content).toContain('pull-requests: write');
    expect(content).toContain('contents: read');
    expect(content).not.toContain('contents: write');
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
