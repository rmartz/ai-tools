import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  resolveBinPackages,
  maxStableVersion,
  resolveLatestVersions,
  buildInstallArgs,
  withPackagesToken,
} from './install-clis.js';

let packagesDir: string;

/** Create `packages/<dir>/package.json` with the given name + bin field. */
function makePackage(dir: string, name: string, bin?: unknown): void {
  mkdirSync(join(packagesDir, dir), { recursive: true });
  writeFileSync(join(packagesDir, dir, 'package.json'), JSON.stringify({ name, bin }));
}

beforeEach(() => {
  packagesDir = mkdtempSync(join(tmpdir(), 'install-clis-'));
});

afterEach(() => rmSync(packagesDir, { recursive: true, force: true }));

describe('resolveBinPackages', () => {
  it('returns only packages that expose a bin, by name, sorted by directory', () => {
    makePackage('worktree', '@rmartz/worktree', { 'ai-new-worktree': './dist/bin/x.js' });
    makePackage('github', '@rmartz/github', { 'ai-pr-summary': './dist/bin/y.js' });
    makePackage('agent-runtime', '@rmartz/agent-runtime'); // no bin → excluded
    expect(resolveBinPackages(packagesDir)).toEqual(['@rmartz/github', '@rmartz/worktree']);
  });

  it('accepts a string bin and excludes an empty bin object', () => {
    makePackage('a', '@rmartz/a', './cli.js'); // string bin
    makePackage('b', '@rmartz/b', {}); // empty → excluded
    expect(resolveBinPackages(packagesDir)).toEqual(['@rmartz/a']);
  });
});

describe('maxStableVersion', () => {
  it('returns the highest version, comparing numerically not lexically', () => {
    // 0.10.0 > 0.9.0 numerically, but a string sort would pick 0.9.0.
    expect(maxStableVersion(['0.1.0', '0.10.0', '0.9.0', '0.2.0'])).toBe('0.10.0');
  });

  it('ignores pre-release and non-numeric tags', () => {
    expect(maxStableVersion(['0.1.0', 'latest', '1.0.0-beta.1', '0.2.0'])).toBe('0.2.0');
  });

  it('returns undefined when no plain semver version is present', () => {
    expect(maxStableVersion([])).toBeUndefined();
    expect(maxStableVersion(['next', '1.0.0-rc.0'])).toBeUndefined();
  });
});

describe('resolveLatestVersions', () => {
  it('pairs each name with its max version and drops names the registry cannot resolve', () => {
    const versions: Record<string, string[]> = {
      '@rmartz/github': ['0.1.3', '0.2.0'],
      '@rmartz/worktree': ['0.1.1'],
      '@rmartz/missing': [], // unresolvable → dropped
    };
    expect(
      resolveLatestVersions(
        ['@rmartz/github', '@rmartz/worktree', '@rmartz/missing'],
        (name) => versions[name] ?? [],
      ),
    ).toEqual([
      ['@rmartz/github', '0.2.0'],
      ['@rmartz/worktree', '0.1.1'],
    ]);
  });
});

describe('buildInstallArgs', () => {
  it('builds an `npm install -g <pkg@version> …` argv from resolved pairs', () => {
    expect(
      buildInstallArgs([
        ['@rmartz/worktree', '0.1.1'],
        ['@rmartz/github', '0.2.0'],
      ]),
    ).toEqual(['install', '-g', '@rmartz/worktree@0.1.1', '@rmartz/github@0.2.0']);
  });
});

describe('withPackagesToken', () => {
  it('injects the gh token when GITHUB_PACKAGES_TOKEN is unset', () => {
    expect(withPackagesToken({ PATH: '/x' }, 'gho_abc')).toEqual({
      PATH: '/x',
      GITHUB_PACKAGES_TOKEN: 'gho_abc',
    });
  });

  it('keeps an already-set token (interactive shell already exported it)', () => {
    const env = { GITHUB_PACKAGES_TOKEN: 'existing' };
    expect(withPackagesToken(env, 'gho_abc')).toBe(env); // unchanged, not overwritten
  });

  it('leaves the env untouched when no gh token is available', () => {
    const env = { PATH: '/x' };
    expect(withPackagesToken(env, undefined)).toBe(env);
  });
});
