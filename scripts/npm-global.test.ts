import { describe, it, expect } from 'vitest';

import { withoutInheritedPrefix, findVersionMismatches } from './npm-global.js';

describe('withoutInheritedPrefix', () => {
  it('strips the prefix pnpm run leaks, so `npm install -g` uses the real global prefix', () => {
    expect(
      withoutInheritedPrefix({
        PATH: '/x',
        npm_config_prefix: '/Users/me/Development/ai-tools',
        npm_config_global_prefix: '/Users/me/Development/ai-tools',
      }),
    ).toEqual({ PATH: '/x' });
  });

  it('keeps unrelated npm_config_* entries (only the prefix redirects the install)', () => {
    expect(
      withoutInheritedPrefix({ npm_config_registry: 'https://r.example', npm_config_prefix: '/p' }),
    ).toEqual({ npm_config_registry: 'https://r.example' });
  });

  it('leaves an env with no inherited prefix untouched', () => {
    const env = { PATH: '/x', GITHUB_PACKAGES_TOKEN: 'gho_abc' };
    expect(withoutInheritedPrefix(env)).toBe(env);
  });
});

describe('findVersionMismatches', () => {
  const pairs: Array<[string, string]> = [
    ['@rmartz/worktree', '0.3.1'],
    ['@rmartz/github', '0.5.0'],
  ];

  it('returns no mismatches when every package is installed at the intended version', () => {
    const installed: Record<string, string> = {
      '@rmartz/worktree': '0.3.1',
      '@rmartz/github': '0.5.0',
    };
    expect(findVersionMismatches(pairs, (name) => installed[name])).toEqual([]);
  });

  it('reports a package left at an older version — the silent no-op this guards', () => {
    const installed: Record<string, string> = {
      '@rmartz/worktree': '0.1.1',
      '@rmartz/github': '0.5.0',
    };
    expect(findVersionMismatches(pairs, (name) => installed[name])).toEqual([
      { name: '@rmartz/worktree', expected: '0.3.1', actual: '0.1.1' },
    ]);
  });

  it('reports a package that is absent from the global prefix entirely', () => {
    const installed: Record<string, string> = { '@rmartz/github': '0.5.0' };
    expect(findVersionMismatches(pairs, (name) => installed[name])).toEqual([
      { name: '@rmartz/worktree', expected: '0.3.1', actual: undefined },
    ]);
  });
});
