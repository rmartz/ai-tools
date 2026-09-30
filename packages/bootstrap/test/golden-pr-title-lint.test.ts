import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';

import { goldenWorkflowFiles } from '../src/golden-config.js';
import { CONVENTIONAL_SUBJECT_PATTERN } from '../src/conventional-grammar.js';

// rmartz/repo-hygiene#49 — the pre-merge PR-title linter, distributed as a golden
// workflow so consumers stop hand-rolling it. It needs the pull_request payload,
// which the tree-based repo-hygiene check cannot see, so it is not a registry check.
const titleLint = goldenWorkflowFiles.find(
  (w) => w.filename === '.github/workflows/pr-title-lint.yml',
);
const tripwire = goldenWorkflowFiles.find(
  (w) => w.filename === '.github/workflows/commit-convention.yml',
);
const content = titleLint?.content ?? '';

// The step's `run: |` block, dedented — the exact script a consumer's CI executes.
const runScript = () => {
  const lines = content.slice(content.indexOf('run: |\n') + 'run: |\n'.length).split('\n');
  const indent = /^\s*/.exec(lines[0] ?? '')?.[0].length ?? 0;
  return lines.map((l) => l.slice(indent)).join('\n');
};

// Hermetic: a local bash subprocess, no network — the script reads only PR_TITLE.
const lint = (title: string) =>
  spawnSync('bash', ['-c', runScript()], {
    env: { PATH: process.env.PATH, PR_TITLE: title },
    encoding: 'utf8',
  });

describe('goldenWorkflowFiles — the pr-title-lint workflow is seeded', () => {
  it('is present in the golden set', () => {
    expect(titleLint).toBeDefined();
  });

  it('needs no gate check of its own (it is a CI check, not an auto-merger)', () => {
    expect(titleLint?.gateChecks).toEqual([]);
  });
});

describe('pr-title-lint — runs on the pull_request title, pre-merge', () => {
  it('triggers on pull_request, including title-only edits, not on push', () => {
    expect(content).toContain('pull_request:');
    expect(content).toContain('types: [opened, edited, synchronize, reopened]');
    expect(content).not.toMatch(/^\s+push:/m);
  });

  it('passes the title through env, never an inline ${{ }} expansion in run:', () => {
    expect(content).toContain('PR_TITLE: ${{ github.event.pull_request.title }}');
    expect(runScript()).not.toContain('${{');
  });

  it('requests no token scopes', () => {
    expect(content).toContain('permissions: {}');
  });

  // #299 — a job the repo defines itself carries an explicit Title Case name, which
  // is also its required-status-check context.
  it('posts under the Title Case check context `Validate PR title`', () => {
    expect(content).toContain('name: Validate PR title');
  });
});

describe('pr-title-lint — shares one grammar with the commit-convention tripwire', () => {
  it('embeds the shared conventional-subject pattern', () => {
    expect(content).toContain(`pattern='${CONVENTIONAL_SUBJECT_PATTERN}'`);
  });

  it('is the same pattern the post-merge tripwire validates main against', () => {
    expect(tripwire?.content).toContain(`pattern='${CONVENTIONAL_SUBJECT_PATTERN}'`);
  });
});

describe('pr-title-lint — accepts conventional titles and rejects the rest', () => {
  it.each([
    'feat: add a thing',
    'fix(parser): handle empty input',
    'feat!: drop Node 18',
    'refactor(core)!: rename the entry point',
    'revert: undo the thing',
    'ci(tests): split the matrix',
  ])('accepts %j', (title) => {
    const result = lint(title);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('PR title is valid');
  });

  it.each([
    'Add a thing',
    'feature: add a thing',
    'feat:add a thing',
    'feat: ',
    'feat(): empty scope',
    '[WIP] feat: add a thing',
    'Feat: capitalised type',
  ])('rejects %j', (title) => {
    const result = lint(title);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('does not follow Conventional Commits');
  });

  it('treats shell metacharacters in the title as inert data', () => {
    const result = lint('feat: $(echo pwned) `echo pwned`');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('$(echo pwned) `echo pwned`');
  });
});
