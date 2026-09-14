import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

import { ensureWorkflowFiles, renderManagedWorkflow } from '../src/ensure-workflow-files.js';
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

const fixture: GoldenWorkflowFile = {
  filename: '.github/workflows/demo.yml',
  content: 'name: Demo\non: push\n',
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

// Criterion A2 — seeded with the generic dependabot-auto-merge workflow: patch/
// minor only (majors stay manual), fetch-metadata pinned by full SHA + version.
describe('goldenWorkflowFiles — the seeded Dependabot auto-merge workflow', () => {
  const dependabot = goldenWorkflowFiles.find(
    (w) => w.filename === '.github/workflows/dependabot-auto-merge.yml',
  );

  it('is present in the golden set', () => {
    expect(dependabot).toBeDefined();
  });

  it('pins dependabot/fetch-metadata to a full 40-char SHA with a major.minor.patch comment', () => {
    expect(dependabot?.content).toMatch(/dependabot\/fetch-metadata@[0-9a-f]{40} # v\d+\.\d+\.\d+/);
  });

  it('enables auto-merge only for semver-patch and semver-minor (majors stay manual)', () => {
    const content = dependabot?.content ?? '';
    expect(content).toContain('version-update:semver-patch');
    expect(content).toContain('version-update:semver-minor');
    expect(content).not.toContain('version-update:semver-major');
  });

  it('declares the merge-safety gate check the auto-merge depends on', () => {
    expect(dependabot?.gateChecks).toContain('merge-safety');
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

  it('provides the check and so declares no gateChecks of its own', () => {
    expect(mergeSafety?.gateChecks).toEqual([]);
  });
});
