import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveBinPackages, buildInstallArgs, withPackagesToken } from './install-clis.js';

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

describe('buildInstallArgs', () => {
  it('builds an `npm install -g <pkg@latest> …` argv', () => {
    expect(buildInstallArgs(['@rmartz/worktree', '@rmartz/github'])).toEqual([
      'install',
      '-g',
      '@rmartz/worktree@latest',
      '@rmartz/github@latest',
    ]);
  });

  it('honors an explicit dist-tag', () => {
    expect(buildInstallArgs(['@rmartz/worktree'], 'next')).toEqual([
      'install',
      '-g',
      '@rmartz/worktree@next',
    ]);
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
