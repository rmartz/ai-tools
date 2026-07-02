import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveBinPackages, buildAddArgs } from './install-clis.js';

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

describe('buildAddArgs', () => {
  it('builds a `pnpm add -g <pkg@latest> …` argv', () => {
    expect(buildAddArgs(['@rmartz/worktree', '@rmartz/github'])).toEqual([
      'add',
      '-g',
      '@rmartz/worktree@latest',
      '@rmartz/github@latest',
    ]);
  });

  it('honors an explicit dist-tag', () => {
    expect(buildAddArgs(['@rmartz/worktree'], 'next')).toEqual([
      'add',
      '-g',
      '@rmartz/worktree@next',
    ]);
  });
});
