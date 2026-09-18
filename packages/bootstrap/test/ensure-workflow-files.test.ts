import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

import {
  ensureWorkflowFiles,
  renderManagedWorkflow,
  retireWorkflowFile,
} from '../src/ensure-workflow-files.js';
import {
  goldenWorkflowFiles,
  WORKFLOW_MANAGED_MARKER,
  type GoldenWorkflowFile,
} from '../src/golden-config.js';

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

// Ungated: the whole-file-management tests exercise create/update/skip, not the
// gate. A gated fixture is used by the withhold tests further down.
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

// Criterion A1 — a "managed whole-file" category: write if absent, overwrite if
// drifted, leave user-authored files alone.
describe('ensureWorkflowFiles — whole-file management', () => {
  it('creates the file (and its parent dirs) when absent', () => {
    const [outcome] = ensureWorkflowFiles(dir, { workflows: [fixture] });
    expect(outcome).toEqual({ filename: fixture.filename, action: 'created' });
    expect(existsSync(join(dir, fixture.filename))).toBe(true);
  });

  it('prepends the managed header carrying the marker', () => {
    ensureWorkflowFiles(dir, { workflows: [fixture] });
    const text = read(fixture.filename);
    expect(text).toContain(WORKFLOW_MANAGED_MARKER);
    expect(text).toContain('name: Demo');
    // Header precedes the body.
    expect(text.indexOf(WORKFLOW_MANAGED_MARKER)).toBeLessThan(text.indexOf('name: Demo'));
  });

  it('reports unchanged on a second run and does not rewrite', () => {
    ensureWorkflowFiles(dir, { workflows: [fixture] });
    const first = read(fixture.filename);
    const [outcome] = ensureWorkflowFiles(dir, { workflows: [fixture] });
    expect(outcome?.action).toBe('unchanged');
    expect(read(fixture.filename)).toBe(first);
  });

  it('overwrites a drifted managed file back to golden', () => {
    // A previously-managed file (carries the marker) that a user edited.
    writeAt(
      fixture.filename,
      renderManagedWorkflow(fixture).replace('on: push', 'on: pull_request'),
    );
    const [outcome] = ensureWorkflowFiles(dir, { workflows: [fixture] });
    expect(outcome?.action).toBe('updated');
    expect(read(fixture.filename)).toBe(renderManagedWorkflow(fixture));
    expect(read(fixture.filename)).toContain('on: push');
  });

  it('skips a user-authored file with no managed header — never clobbers it', () => {
    const userContent = 'name: My Own Workflow\non: schedule\n';
    writeAt(fixture.filename, userContent);
    const [outcome] = ensureWorkflowFiles(dir, { workflows: [fixture] });
    expect(outcome?.action).toBe('skipped');
    expect(read(fixture.filename)).toBe(userContent);
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
    writeAt(gatedFixture.filename, renderManagedWorkflow(gatedFixture));
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
// rmartz/bot-automerge reusable workflow (SHA-pinned, Dependabot-bumped), seeded
// once and thereafter repo-owned (`seed`). Expanded from the old inline
// Dependabot-only `dependabot-auto-merge.yml` to also cover release-please PRs; the
// old file is retired via `retiredWorkflowFiles`. Still gated on `merge-safety`.
describe('goldenWorkflowFiles — the seeded bot-automerge reusable-workflow caller', () => {
  const botAutomerge = goldenWorkflowFiles.find(
    (w) => w.filename === '.github/workflows/bot-automerge.yml',
  );

  it('is present with the seed policy', () => {
    expect(botAutomerge).toBeDefined();
    expect(botAutomerge?.policy).toBe('seed');
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

// #264 — retireWorkflowFile: delete the copy *we* wrote (managed marker), leave a
// user-authored file at the same path untouched, no-op when absent. The whole-file
// analogue of ensure-project-config's retireFile for managed-block ignore files.
describe('retireWorkflowFile', () => {
  const retired: GoldenWorkflowFile = {
    filename: '.github/workflows/dependabot-auto-merge.yml',
    content: 'name: Old Auto-merge\non: pull_request_target\n',
    gateChecks: [],
  };

  it('removes a file we previously wrote (carries the managed marker)', () => {
    writeAt(retired.filename, renderManagedWorkflow(retired));
    const outcome = retireWorkflowFile(dir, retired.filename);
    expect(outcome).toEqual({ filename: retired.filename, action: 'removed' });
    expect(existsSync(join(dir, retired.filename))).toBe(false);
  });

  it('leaves a user-authored file (no managed marker) untouched', () => {
    const userContent = 'name: My Own Auto-merge\non: pull_request_target\n';
    writeAt(retired.filename, userContent);
    const outcome = retireWorkflowFile(dir, retired.filename);
    expect(outcome).toEqual({ filename: retired.filename, action: 'skipped' });
    expect(read(retired.filename)).toBe(userContent);
  });

  it('reports unchanged when the file is absent', () => {
    const outcome = retireWorkflowFile(dir, retired.filename);
    expect(outcome).toEqual({ filename: retired.filename, action: 'unchanged' });
  });
});

// #188 — the seeded merge-safety check workflow (consumer shape: installs the
// published CLI, provides the check rather than depending on one).
describe('goldenWorkflowFiles — the seeded merge-safety workflow', () => {
  const mergeSafety = goldenWorkflowFiles.find(
    (w) => w.filename === '.github/workflows/merge-safety.yml',
  );

  it('is present in the golden set', () => {
    expect(mergeSafety).toBeDefined();
  });

  it('installs the published @rmartz/pr-review CLI rather than building from source', () => {
    const content = mergeSafety?.content ?? '';
    expect(content).toContain('npm install -g "@rmartz/pr-review@');
    expect(content).toContain('ai-merge-safety evaluate');
    expect(content).toContain('ai-merge-safety invalidate');
    expect(content).not.toContain('pnpm build');
  });

  it('pins actions/checkout to a full 40-char SHA with a major.minor.patch comment', () => {
    expect(mergeSafety?.content).toMatch(/actions\/checkout@[0-9a-f]{40} # v\d+\.\d+\.\d+/);
  });

  it('reads the base branch from the PR (falling back to the repo default) for portability', () => {
    expect(mergeSafety?.content).toContain('github.event.pull_request.base.ref');
    expect(mergeSafety?.content).toContain('github.event.repository.default_branch');
  });

  it('narrows label events to the verdict-relevant `breaking change` label', () => {
    // #229 — a labeled/unlabeled event only changes the verdict for `breaking
    // change`; every other label (approved, no UAT needed, domain labels) must
    // not spin up an evaluate run.
    const content = mergeSafety?.content ?? '';
    expect(content).toContain("github.event.action != 'labeled'");
    expect(content).toContain("github.event.action != 'unlabeled'");
    expect(content).toContain("github.event.label.name == 'breaking change'");
  });

  it('provides the check and so declares no gateChecks of its own', () => {
    expect(mergeSafety?.gateChecks).toEqual([]);
  });
});

// #209 — the `seed` policy: write-if-absent, repo-owned thereafter.
describe('ensureWorkflowFiles — seed policy', () => {
  const seed: GoldenWorkflowFile = {
    filename: '.github/dependabot.yml',
    content: 'version: 2\n',
    gateChecks: [],
    policy: 'seed',
  };

  it('writes plain content (no managed header) when absent', () => {
    const [outcome] = ensureWorkflowFiles(dir, { workflows: [seed] });
    expect(outcome).toEqual({ filename: seed.filename, action: 'created' });
    const text = read(seed.filename);
    expect(text).toBe('version: 2\n');
    expect(text).not.toContain(WORKFLOW_MANAGED_MARKER);
  });

  it('never overwrites an existing file — leaves the repo-owned edits intact', () => {
    const local = 'version: 2\n# customized by the repo\n';
    writeAt(seed.filename, local);
    const [outcome] = ensureWorkflowFiles(dir, { workflows: [seed] });
    expect(outcome?.action).toBe('unchanged');
    expect(read(seed.filename)).toBe(local);
  });
});

// #209 — the seeded Dependabot config.
describe('goldenWorkflowFiles — the seeded Dependabot config', () => {
  const dependabotConfig = goldenWorkflowFiles.find((w) => w.filename === '.github/dependabot.yml');

  it('is present with the seed policy', () => {
    expect(dependabotConfig?.policy).toBe('seed');
  });

  it('covers github-actions (minimum) and npm (ideal) ecosystems', () => {
    const content = dependabotConfig?.content ?? '';
    expect(content).toContain('package-ecosystem: github-actions');
    expect(content).toContain('package-ecosystem: npm');
  });
});

// #251 — the seeded repo-hygiene CI is a thin caller of the rmartz/repo-hygiene
// reusable workflow (SHA-pinned, Dependabot-bumped), seeded once and thereafter
// repo-owned (`seed`), so bootstrap re-seed / golden-sync never fights Dependabot
// over the pin.
describe('goldenWorkflowFiles — the seeded repo-hygiene reusable-workflow caller', () => {
  const repoHygiene = goldenWorkflowFiles.find(
    (w) => w.filename === '.github/workflows/repo-hygiene.yml',
  );

  it('is present with the seed policy and no gate check of its own', () => {
    expect(repoHygiene).toBeDefined();
    expect(repoHygiene?.policy).toBe('seed');
    expect(repoHygiene?.gateChecks).toEqual([]);
  });

  it('calls the rmartz/repo-hygiene reusable workflow, SHA-pinned with a version comment', () => {
    expect(repoHygiene?.content).toMatch(
      /uses: rmartz\/repo-hygiene\/\.github\/workflows\/hygiene\.yml@[0-9a-f]{40} # v\d+\.\d+\.\d+/,
    );
  });

  it('grants packages: read so the reusable workflow can install from GitHub Packages', () => {
    expect(repoHygiene?.content).toContain('packages: read');
  });

  it('drops the hand-rolled CLI install and the bare env version pin', () => {
    const content = repoHygiene?.content ?? '';
    expect(content).not.toContain('npm install -g');
    expect(content).not.toContain('REPO_HYGIENE_VERSION');
  });
});

// #219 — the post-merge conventional-commit tripwire: a push:[main] alert that
// fails loudly when a commit subject reaches the default branch without a valid
// conventional-commit prefix (the silent release-please skip pre-merge title-lint
// can't see).
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
});

// #233 — the seeded self-sync workflow: it re-runs `ai-ensure-project-config`
// against the latest published @rmartz/bootstrap on a schedule and opens a
// golden-refresh PR only when a managed file drifted — so golden-config updates
// reach the fleet automatically, with no per-repo manual `/bootstrap` re-run and
// no per-repo secret. Being a `manage` file, it also self-propagates: a change to
// its own definition reaches every repo through the next sync.
describe('goldenWorkflowFiles — the golden-sync self-update workflow', () => {
  const goldenSync = goldenWorkflowFiles.find(
    (w) => w.filename === '.github/workflows/golden-sync.yml',
  );

  it('is present as a managed (self-propagating) file with no gate check of its own', () => {
    expect(goldenSync).toBeDefined();
    expect(goldenSync?.policy ?? 'manage').toBe('manage');
    expect(goldenSync?.gateChecks).toEqual([]);
  });

  it('runs automatically on a schedule and manual dispatch — never on pull_request', () => {
    const content = goldenSync?.content ?? '';
    expect(content).toContain('schedule:');
    expect(content).toContain('cron:');
    expect(content).toContain('workflow_dispatch:');
    expect(content).not.toContain('pull_request');
  });

  it('installs the latest published @rmartz/bootstrap (unpinned) and re-runs ai-ensure-project-config', () => {
    const content = goldenSync?.content ?? '';
    expect(content).toContain('npm install -g "@rmartz/bootstrap"');
    expect(content).toContain('ai-ensure-project-config');
  });

  it('opens a PR only when golden files actually changed — not a blind overwrite', () => {
    const content = goldenSync?.content ?? '';
    // Staged-diff guard catches both modified and newly-created managed files.
    expect(content).toContain('git diff --cached --quiet');
    expect(content).toContain('gh pr create');
  });

  it('needs only the default token — contents + pull-requests write, packages read', () => {
    const content = goldenSync?.content ?? '';
    expect(content).toContain('contents: write');
    expect(content).toContain('pull-requests: write');
    expect(content).toContain('packages: read');
  });

  it('pins actions/checkout to a full 40-char SHA with a major.minor.patch comment', () => {
    expect(goldenSync?.content).toMatch(/actions\/checkout@[0-9a-f]{40} # v\d+\.\d+\.\d+/);
  });
});
