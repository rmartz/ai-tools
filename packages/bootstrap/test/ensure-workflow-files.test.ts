import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

import { ensureWorkflowFiles } from '../src/ensure-workflow-files.js';
import { goldenWorkflowFiles, type GoldenWorkflowFile } from '../src/golden-config.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ewf-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const read = (name: string) => readFileSync(join(dir, name), 'utf8');
const writeAt = (name: string, text: string) => {
  const path = join(dir, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf8');
};

// Ungated: the write-if-absent tests exercise create/unchanged, not the gate. A
// gated fixture is used by the withhold tests further down.
const fixture: GoldenWorkflowFile = {
  filename: '.github/workflows/demo.yml',
  content: 'name: Demo\non: push\n',
  gateChecks: [],
};

const gatedFixture: GoldenWorkflowFile = {
  filename: '.github/workflows/gated.yml',
  content: 'name: Gated\non: push\n',
  gateChecks: ['demo-check'],
};

// Bootstrap is a new-repo initializer: seed a whole file write-if-absent, verbatim,
// then leave the repo to own it. An existing file is never overwritten.
describe('ensureWorkflowFiles — write-if-absent seeding', () => {
  it('creates the file (and its parent dirs) when absent', () => {
    const [outcome] = ensureWorkflowFiles(dir, { workflows: [fixture] });
    expect(outcome).toEqual({ filename: fixture.filename, action: 'created' });
    expect(existsSync(join(dir, fixture.filename))).toBe(true);
  });

  it('writes the golden body verbatim — no managed header prepended', () => {
    ensureWorkflowFiles(dir, { workflows: [fixture] });
    expect(read(fixture.filename)).toBe(fixture.content);
  });

  it('reports unchanged on a second run and does not rewrite', () => {
    ensureWorkflowFiles(dir, { workflows: [fixture] });
    const first = read(fixture.filename);
    const [outcome] = ensureWorkflowFiles(dir, { workflows: [fixture] });
    expect(outcome?.action).toBe('unchanged');
    expect(read(fixture.filename)).toBe(first);
  });

  it('never overwrites an existing file — leaves the repo-owned copy intact', () => {
    // A repo that has drifted from (or customized) the golden body keeps its copy;
    // bootstrap no longer manages/overwrites it — that is the checklist audit's job.
    const local = 'name: Demo\non: pull_request\n# customized by the repo\n';
    writeAt(fixture.filename, local);
    const [outcome] = ensureWorkflowFiles(dir, { workflows: [fixture] });
    expect(outcome?.action).toBe('unchanged');
    expect(read(fixture.filename)).toBe(local);
  });
});

// #239 — a gated workflow is withheld unless its gateChecks are satisfied, so a
// `gh pr merge --auto` workflow never lands ungated.
describe('ensureWorkflowFiles — gate-before-go-live', () => {
  it('withholds an absent gated workflow when its gate is not satisfied (default)', () => {
    const [outcome] = ensureWorkflowFiles(dir, { workflows: [gatedFixture] });
    expect(outcome).toEqual({ filename: gatedFixture.filename, action: 'withheld' });
    expect(existsSync(join(dir, gatedFixture.filename))).toBe(false);
  });

  it('seeds the gated workflow once its gate check is satisfied', () => {
    const [outcome] = ensureWorkflowFiles(dir, {
      workflows: [gatedFixture],
      satisfiedGateChecks: ['demo-check'],
    });
    expect(outcome?.action).toBe('created');
    expect(existsSync(join(dir, gatedFixture.filename))).toBe(true);
  });

  it('withholds when only some of the required gate checks are satisfied', () => {
    const twoGate: GoldenWorkflowFile = { ...gatedFixture, gateChecks: ['a', 'b'] };
    const [outcome] = ensureWorkflowFiles(dir, {
      workflows: [twoGate],
      satisfiedGateChecks: ['a'],
    });
    expect(outcome?.action).toBe('withheld');
  });

  it('does not touch an already-present gated workflow even with an empty satisfied set', () => {
    // seed-then-gate ordering: once the file exists, an unproven gate must not
    // delete it — withholding blocks creation only.
    writeAt(gatedFixture.filename, gatedFixture.content);
    const [outcome] = ensureWorkflowFiles(dir, { workflows: [gatedFixture] });
    expect(outcome?.action).toBe('unchanged');
    expect(existsSync(join(dir, gatedFixture.filename))).toBe(true);
  });

  it('leaves ungated workflows unaffected by the satisfied set', () => {
    const [outcome] = ensureWorkflowFiles(dir, { workflows: [fixture], satisfiedGateChecks: [] });
    expect(outcome?.action).toBe('created');
  });
});

// #264 — the seeded bot-automerge workflow is a thin caller of the
// rmartz/bot-automerge reusable workflow (SHA-pinned, Dependabot-bumped), seeded once
// and thereafter repo-owned. Covers Dependabot patch/minor bumps and release-please
// PRs; the old inline `dependabot-auto-merge.yml` is gone. Still gated on merge-safety.
describe('goldenWorkflowFiles — the seeded bot-automerge reusable-workflow caller', () => {
  const botAutomerge = goldenWorkflowFiles.find(
    (w) => w.filename === '.github/workflows/bot-automerge.yml',
  );

  it('is present in the golden set', () => {
    expect(botAutomerge).toBeDefined();
  });

  it('calls the rmartz/bot-automerge reusable workflow, SHA-pinned with a version comment', () => {
    expect(botAutomerge?.content).toMatch(
      /uses: rmartz\/bot-automerge\/\.github\/workflows\/bot-automerge\.yml@[0-9a-f]{40} # v\d+\.\d+\.\d+/,
    );
  });

  it('triggers on pull_request_target (not pull_request) and inherits secrets', () => {
    const content = botAutomerge?.content ?? '';
    expect(content).toContain('pull_request_target:');
    expect(content).toContain('secrets: inherit');
  });

  it('grants packages: read so the reusable workflow can install from GitHub Packages', () => {
    expect(botAutomerge?.content).toContain('packages: read');
  });

  it('drops the inline fetch-metadata step and the inline merge command', () => {
    const content = botAutomerge?.content ?? '';
    expect(content).not.toContain('dependabot/fetch-metadata');
    expect(content).not.toContain('gh pr merge');
  });

  it('stays gated on the merge-safety check (an ungated auto-merge would merge immediately)', () => {
    expect(botAutomerge?.gateChecks).toContain('merge-safety');
  });

  it('no longer ships the retired inline dependabot-auto-merge.yml', () => {
    expect(
      goldenWorkflowFiles.find((w) => w.filename === '.github/workflows/dependabot-auto-merge.yml'),
    ).toBeUndefined();
  });
});

// #247 — the seeded merge-safety CI is a thin caller of the rmartz/merge-safety
// reusable workflow (SHA-pinned, Dependabot-bumped), seeded once and thereafter
// repo-owned. The evaluate/invalidate logic + the label-narrowing live inside the
// reusable workflow now, not the caller.
describe('goldenWorkflowFiles — the seeded merge-safety reusable-workflow caller', () => {
  const mergeSafety = goldenWorkflowFiles.find(
    (w) => w.filename === '.github/workflows/merge-safety.yml',
  );

  it('is present with no gate check of its own', () => {
    expect(mergeSafety).toBeDefined();
    expect(mergeSafety?.gateChecks).toEqual([]);
  });

  it('calls the rmartz/merge-safety reusable workflow, SHA-pinned with a version comment', () => {
    expect(mergeSafety?.content).toMatch(
      /uses: rmartz\/merge-safety\/\.github\/workflows\/merge-safety\.yml@[0-9a-f]{40} # v\d+\.\d+\.\d+/,
    );
  });

  it('carries the triggers + write scopes the reusable workflow needs, threads pr, inherits secrets', () => {
    const content = mergeSafety?.content ?? '';
    // pull_request_target (NOT pull_request) so the check fires on unmergeable PRs (#272);
    // check_suite re-holds/releases PRs when the base branch's CI flips.
    expect(content).toContain('pull_request_target:');
    expect(content).toContain('check_suite:');
    expect(content).toContain('push:');
    expect(content).toContain('workflow_dispatch:');
    expect(content).toContain('checks: write');
    expect(content).toContain('pull-requests: write');
    expect(content).toContain('actions: write');
    expect(content).toContain('pr: ${{ inputs.pr }}');
    expect(content).toContain('secrets: inherit');
  });

  it('drops the hand-rolled CLI install and the bare env version pin', () => {
    const content = mergeSafety?.content ?? '';
    expect(content).not.toContain('npm install -g');
    expect(content).not.toContain('MERGE_SAFETY_VERSION');
  });
});

// #209 — the seeded Dependabot config.
describe('goldenWorkflowFiles — the seeded Dependabot config', () => {
  const dependabotConfig = goldenWorkflowFiles.find((w) => w.filename === '.github/dependabot.yml');

  it('is present in the golden set', () => {
    expect(dependabotConfig).toBeDefined();
  });

  it('covers github-actions (minimum) and npm (ideal) ecosystems', () => {
    const content = dependabotConfig?.content ?? '';
    expect(content).toContain('package-ecosystem: github-actions');
    expect(content).toContain('package-ecosystem: npm');
  });
});

// #278 — the seeded repo-hygiene CI is a thin consumer of the rmartz/repo-hygiene-action
// COMPOSITE ACTION (a step-level `- uses:` after actions/checkout), SHA-pinned +
// Dependabot-bumped, seeded once and thereafter repo-owned. Replaces the earlier
// rmartz/repo-hygiene reusable-workflow caller (#251).
describe('goldenWorkflowFiles — the seeded repo-hygiene composite-action consumer', () => {
  const repoHygiene = goldenWorkflowFiles.find(
    (w) => w.filename === '.github/workflows/repo-hygiene.yml',
  );

  it('is present with no gate check of its own', () => {
    expect(repoHygiene).toBeDefined();
    expect(repoHygiene?.gateChecks).toEqual([]);
  });

  it('uses the rmartz/repo-hygiene-action composite action, SHA-pinned with a version comment', () => {
    expect(repoHygiene?.content).toMatch(
      /- uses: rmartz\/repo-hygiene-action@[0-9a-f]{40} # v\d+\.\d+\.\d+/,
    );
  });

  it('checks out the tree before the action step (the action scans the workspace, not history)', () => {
    const content = repoHygiene?.content ?? '';
    expect(content).toMatch(/- uses: actions\/checkout@[0-9a-f]{40} # v\d+\.\d+\.\d+/);
    // Tree-based checks — a plain shallow checkout, never fetch-depth: 0.
    expect(content).not.toContain('fetch-depth: 0');
  });

  it('grants packages: read so the action can install the CLI from GitHub Packages', () => {
    expect(repoHygiene?.content).toContain('packages: read');
  });

  it('is no longer a reusable-workflow caller and carries no hand-rolled CLI install', () => {
    const content = repoHygiene?.content ?? '';
    expect(content).not.toContain('rmartz/repo-hygiene/.github/workflows/hygiene.yml');
    expect(content).not.toContain('npm install -g');
    expect(content).not.toContain('REPO_HYGIENE_VERSION');
  });

  // #299 — the shared-product half of the check-name convention. The job sets no
  // `name:`, so the check posts under the bare job id, `hygiene`. Renaming it would
  // block every consumer's PRs against a context that can never post, so this pins
  // the name a well-meaning "Hygiene" edit would otherwise change silently.
  it('posts as the lowercase shared-product context `hygiene` (the job sets no name:)', () => {
    const content = repoHygiene?.content ?? '';
    expect(content).toContain('jobs:\n  hygiene:\n');
    expect(content.slice(content.indexOf('jobs:'))).not.toMatch(/^\s+name:/m);
  });
});

// #302 — the seeded ci-change-guard CI is a thin caller of the rmartz/ci-change-guard
// reusable workflow (SHA-pinned, Dependabot-bumped), seeded once and thereafter
// repo-owned. It classifies a PR's `.github/workflows/**` diff as tightening or
// loosening, posts the `ci-change-guard` check-run, and reconciles the
// `CI approval needed` merge-gate label; the classification used to live in an LLM
// review step, so a PR that was never reviewed skipped the gate entirely.
describe('goldenWorkflowFiles — the seeded ci-change-guard reusable-workflow caller', () => {
  const ciChangeGuard = goldenWorkflowFiles.find(
    (w) => w.filename === '.github/workflows/ci-change-guard.yml',
  );

  it('is present in the golden set', () => {
    expect(ciChangeGuard).toBeDefined();
  });

  it('calls the rmartz/ci-change-guard reusable workflow, SHA-pinned with a version comment', () => {
    expect(ciChangeGuard?.content).toMatch(
      /uses: rmartz\/ci-change-guard\/\.github\/workflows\/ci-change-guard\.yml@[0-9a-f]{40} # v\d+\.\d+\.\d+/,
    );
  });

  // A fork PR and every Dependabot PR get a read-only token under `pull_request` —
  // and Dependabot's own action bumps are exactly the PRs that touch workflow files.
  it('triggers on pull_request_target (not bare pull_request), threads pr, inherits secrets', () => {
    const content = ciChangeGuard?.content ?? '';
    expect(content).toContain('pull_request_target:');
    expect(content).not.toMatch(/^ {2}pull_request:/m);
    expect(content).toContain('workflow_dispatch:');
    expect(content).toContain('pr: ${{ inputs.pr }}');
    expect(content).toContain('secrets: inherit');
  });

  // `labeled`/`unlabeled` are load-bearing: applying `CI change approved` is the act
  // that clears the gate, and it arrives as a label event.
  it('listens for the label events that clear the gate', () => {
    expect(ciChangeGuard?.content).toContain(
      'types: [opened, synchronize, reopened, labeled, unlabeled]',
    );
  });

  it('grants the scopes the guard needs to post its check-run and reconcile the label', () => {
    const content = ciChangeGuard?.content ?? '';
    expect(content).toMatch(/^ {2}checks: write/m);
    expect(content).toMatch(/^ {2}pull-requests: write/m);
    expect(content).toMatch(/^ {2}contents: read/m);
    expect(content).toMatch(/^ {2}packages: read/m);
  });

  // The check-run is `neutral` and never fails; the gate is enforced at the merge
  // queue by the `CI approval needed` label, so there is no merges-immediately
  // hazard for the hermetic writer to withhold against (unlike bot-automerge).
  it('needs no gate check of its own (it posts a neutral check, it does not auto-merge)', () => {
    expect(ciChangeGuard?.gateChecks).toEqual([]);
  });
});

// #219 — the post-merge conventional-commit tripwire: a push:[main] alert that fails
// loudly when a commit subject reaches the default branch without a valid
// conventional-commit prefix (the silent release-please skip pre-merge title-lint
// can't see). Its logic is inline, so it is seeded once and the repo owns it; the
// checklist audit re-propagates a later revision (there is no golden-sync loop).
describe('goldenWorkflowFiles — the commit-convention tripwire', () => {
  const tripwire = goldenWorkflowFiles.find(
    (w) => w.filename === '.github/workflows/commit-convention.yml',
  );

  it('is present in the golden set', () => {
    expect(tripwire).toBeDefined();
  });

  it('runs on push to main (post-merge), not on pull_request', () => {
    const content = tripwire?.content ?? '';
    expect(content).toContain('push:');
    expect(content).toContain('branches: [main]');
    expect(content).not.toContain('pull_request');
  });

  it('validates the pushed commit range along the first-parent chain', () => {
    const content = tripwire?.content ?? '';
    expect(content).toContain('github.event.before');
    expect(content).toContain('github.event.after');
    expect(content).toContain('--first-parent');
  });

  it('accepts every conventional type and the breaking-change marker', () => {
    const content = tripwire?.content ?? '';
    expect(content).toContain('feat|fix|docs|chore|refactor|test|style|perf|ci|build|revert');
    // The `!` breaking-change marker is optional in the subject grammar.
    expect(content).toContain('!?:');
  });

  it('pins actions/checkout to a full 40-char SHA with a major.minor.patch comment', () => {
    expect(tripwire?.content).toMatch(/actions\/checkout@[0-9a-f]{40} # v\d+\.\d+\.\d+/);
  });

  it('needs no gate check of its own (it alerts, it does not gate)', () => {
    expect(tripwire?.gateChecks).toEqual([]);
  });

  // #299 — the repo's-own-job half of the check-name convention: a job the repo
  // defines itself carries an explicit Title Case `name:`, unlike a shared-product
  // check such as `hygiene`, which stays lowercase-kebab.
  it('names its job in Title Case, as a job the repo defines itself', () => {
    expect(tripwire?.content).toContain('name: Validate commit subjects on main');
  });
});

// #263 — bootstrap is a new-repo initializer, not an ongoing manager: the golden set
// no longer ships the golden-sync self-update loop (its removal is what makes
// bootstrap init-only). Keeping an existing repo current is the repository
// checklist's job.
describe('goldenWorkflowFiles — no ongoing-manager machinery', () => {
  it('no longer ships the golden-sync self-update workflow', () => {
    expect(
      goldenWorkflowFiles.find((w) => w.filename === '.github/workflows/golden-sync.yml'),
    ).toBeUndefined();
  });
});
