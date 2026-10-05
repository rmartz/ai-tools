import { describe, it, expect } from 'vitest';

import { goldenWorkflowFiles } from '../src/golden-config.js';

// The fleet retired the inline pr-title-lint.yml (`Validate PR title`): the
// @rmartz/pr-policy `title` check, posted inside the required `pr-policy` check by
// rmartz/pr-policy-action, validates the same grammar. Bootstrap seeds that caller.
const prPolicy = goldenWorkflowFiles.find((w) => w.filename === '.github/workflows/pr-policy.yml');
const content = prPolicy?.content ?? '';

describe('goldenWorkflowFiles — the pr-policy caller is seeded', () => {
  it('is present in the golden set', () => {
    expect(prPolicy).toBeDefined();
  });

  it('needs no gate check of its own (it is a CI check, not an auto-merger)', () => {
    expect(prPolicy?.gateChecks).toEqual([]);
  });

  it('no longer seeds pr-title-lint.yml', () => {
    expect(goldenWorkflowFiles.map((w) => w.filename)).not.toContain(
      '.github/workflows/pr-title-lint.yml',
    );
  });
});

describe('pr-policy — a thin, SHA-pinned consumer of rmartz/pr-policy-action', () => {
  it('pins the Action to a full 40-char SHA with a major.minor.patch comment', () => {
    expect(content).toMatch(/uses: rmartz\/pr-policy-action@[0-9a-f]{40} # v\d+\.\d+\.\d+\n/);
  });

  it('passes the PR number from the event payload', () => {
    expect(content).toContain('pr: ${{ github.event.pull_request.number }}');
  });

  it('runs on pull_request_target, including label and title edits', () => {
    expect(content).toContain('pull_request_target:');
    expect(content).toContain('types: [opened, synchronize, reopened, edited, labeled, unlabeled]');
    expect(content).not.toMatch(/^\s+pull_request:/m);
  });

  it('never checks out the PR (pull_request_target runs with a write token)', () => {
    expect(content).not.toContain('actions/checkout');
  });

  it('grants the scopes the Action needs', () => {
    expect(content).toContain('checks: write');
    expect(content).toContain('pull-requests: write');
    expect(content).toContain('contents: read');
    expect(content).toContain('statuses: write');
  });

  // The Action posts the `pr-policy` check itself; a job with the same name would
  // add a second, always-green `pr-policy` entry that a ruleset could match.
  it('names its job so it never collides with the `pr-policy` context', () => {
    expect(content).toContain('name: pr-policy (evaluate)');
    expect(content).not.toMatch(/^\s+name: pr-policy$/m);
  });
});

describe('pr-policy — UAT variant', () => {
  // Bootstrap has no project-type signal, so it seeds the fleet default; an app
  // repo turns the gate on by deleting this line from its copy.
  it('seeds skip-uat: true by default', () => {
    expect(content).toMatch(/^\s+skip-uat: true$/m);
  });
});
