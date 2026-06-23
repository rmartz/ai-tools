import { describe, it, expect } from 'vitest';
import { splitCommands, selectChecks } from '../src/workflow-checks.js';
import type { WorkflowFs } from '../src/workflow-checks.js';

describe('splitCommands', () => {
  it('joins backslash continuations and splits on newlines and &&', () => {
    const run = 'pnpm install && pnpm run lint\npnpm run \\\n  test';
    expect(splitCommands(run)).toEqual(['pnpm install', 'pnpm run lint', 'pnpm run    test']);
  });

  it('drops blank and comment lines', () => {
    expect(splitCommands('# a comment\n\n  prettier --check .')).toEqual(['prettier --check .']);
  });
});

/** In-memory workflow filesystem keyed by filename → YAML text. */
function fsFrom(files: Record<string, string>): WorkflowFs {
  return {
    readdir: (dir) => {
      if (!dir.endsWith('workflows')) throw new Error('ENOENT');
      return Object.keys(files);
    },
    readFile: (path) => {
      const name = path.split('/').pop()!;
      const text = files[name];
      if (text === undefined) throw new Error(`ENOENT: ${path}`);
      return text;
    },
  };
}

const CI_YAML = `
name: CI
on: [push]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - run: pnpm install
      - run: pnpm exec prettier --check .
      - run: |
          pnpm run lint
          pnpm exec tsc --noEmit
      - run: pnpm run test
`;

describe('selectChecks', () => {
  it('extracts and category-orders the locally-runnable checks', () => {
    const checks = selectChecks('/repo', fsFrom({ 'ci.yml': CI_YAML }));
    expect(checks.map((c) => c.category)).toEqual(['format', 'lint', 'typecheck', 'test']);
    expect(checks.map((c) => c.tool)).toEqual(['prettier', 'lint', 'tsc', 'test']);
  });

  it('selects a `pnpm exec vitest run` step as a test check', () => {
    const yaml = `
jobs:
  j:
    steps:
      - run: pnpm install
      - run: pnpm exec vitest run
`;
    const checks = selectChecks('/repo', fsFrom({ 'ci.yml': yaml }));
    expect(checks).toEqual([{ category: 'test', command: 'pnpm exec vitest run', tool: 'vitest' }]);
  });

  it('skips installs, deploys, and unrecognized commands', () => {
    const yaml = `
jobs:
  j:
    steps:
      - run: pnpm install
      - run: vercel deploy --prod
      - run: rm -rf dist
`;
    expect(selectChecks('/repo', fsFrom({ 'ci.yml': yaml }))).toEqual([]);
  });

  it('deduplicates the same command across whitespace and files', () => {
    const a = `
jobs:
  j:
    steps:
      - run: pnpm exec tsc  --noEmit
`;
    const b = `
jobs:
  j:
    steps:
      - run: pnpm exec tsc --noEmit
`;
    const checks = selectChecks('/repo', fsFrom({ 'a.yml': a, 'b.yml': b }));
    expect(checks).toHaveLength(1);
  });

  it('returns an empty list when there is no workflows directory', () => {
    const fs: WorkflowFs = {
      readdir: () => {
        throw new Error('ENOENT');
      },
      readFile: () => '',
    };
    expect(selectChecks('/repo', fs)).toEqual([]);
  });

  it('ignores non-yaml files and unparseable yaml', () => {
    const checks = selectChecks(
      '/repo',
      fsFrom({ 'readme.md': 'nope', 'bad.yml': ': : :', 'ci.yaml': CI_YAML }),
    );
    expect(checks.length).toBeGreaterThan(0);
  });
});
