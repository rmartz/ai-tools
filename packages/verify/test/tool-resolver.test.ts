import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { localBin, onPath, resolveTool, LOCAL_BIN_DIR } from '../src/tool-resolver.js';

// Hermetic: every fs/PATH boundary is injected, so no real disk or PATH is read.
const repo = '/repo';
const localPath = join(repo, LOCAL_BIN_DIR, 'prettier');

describe('localBin', () => {
  it('returns the node_modules/.bin path when it exists', () => {
    expect(localBin(repo, 'prettier', (p) => p === localPath)).toBe(localPath);
  });

  it('returns null when the binary is absent', () => {
    expect(localBin(repo, 'prettier', () => false)).toBeNull();
  });
});

describe('onPath', () => {
  it('returns the first PATH dir containing the tool', () => {
    const found = onPath('eslint', {
      path: ['/a', '/b'].join(':'),
      pathDelimiter: ':',
      exists: (p) => p === '/b/eslint',
    });
    expect(found).toBe('/b/eslint');
  });

  it('skips empty PATH segments and returns null when not found', () => {
    expect(onPath('eslint', { path: '::', pathDelimiter: ':', exists: () => false })).toBeNull();
  });
});

describe('resolveTool', () => {
  it('prefers the local node_modules/.bin binary', () => {
    const argv = resolveTool(repo, 'prettier', {
      exists: (p) => p === localPath,
      path: '/usr/bin',
      pathDelimiter: ':',
    });
    expect(argv).toEqual([localPath]);
  });

  it('falls back to a PATH lookup when no local bin exists', () => {
    const argv = resolveTool(repo, 'tsc', {
      exists: (p) => p === '/usr/bin/tsc',
      path: '/usr/bin',
      pathDelimiter: ':',
    });
    expect(argv).toEqual(['/usr/bin/tsc']);
  });

  it('falls back to `pnpm exec` when only pnpm is on PATH', () => {
    const argv = resolveTool(repo, 'vitest', {
      exists: (p) => p === '/usr/bin/pnpm',
      path: '/usr/bin',
      pathDelimiter: ':',
    });
    expect(argv).toEqual(['pnpm', 'exec', 'vitest']);
  });

  it('returns null when nothing — not even pnpm — is available', () => {
    const argv = resolveTool(repo, 'vitest', {
      exists: () => false,
      path: '/usr/bin',
      pathDelimiter: ':',
    });
    expect(argv).toBeNull();
  });
});
