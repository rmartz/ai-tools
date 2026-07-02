import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readlinkSync,
  lstatSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installClis } from './install-clis.js';

let root: string;
let packagesDir: string;
let binDir: string;

/** Create `packages/<pkg>` with a `bin` map, materializing each dist target
 *  unless `withDist` is false (to exercise the "not built yet" path). */
function makePackage(pkg: string, bin: Record<string, string>, withDist = true): void {
  const dir = join(packagesDir, pkg);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: `@rmartz/${pkg}`, bin }));
  if (withDist) {
    for (const rel of Object.values(bin)) {
      const abs = join(dir, rel);
      mkdirSync(join(abs, '..'), { recursive: true });
      writeFileSync(abs, '#!/usr/bin/env node\n');
    }
  }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'install-clis-'));
  packagesDir = join(root, 'packages');
  binDir = join(root, 'bin');
  mkdirSync(packagesDir);
  makePackage('worktree', { 'ai-new-worktree': './dist/bin/new-worktree.js' });
  makePackage('github', { 'ai-pr-summary': './dist/bin/pr-summary.js' });
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('installClis', () => {
  it('symlinks every built bin into the bin dir (creating it) and marks it executable', () => {
    const results = installClis({ packagesDir, binDir });
    expect(results.map((r) => r.name)).toEqual(['ai-new-worktree', 'ai-pr-summary']); // sorted
    expect(results.every((r) => r.action === 'linked')).toBe(true);

    const link = join(binDir, 'ai-new-worktree');
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readlinkSync(link)).toBe(join(packagesDir, 'worktree', 'dist/bin/new-worktree.js'));
    expect(statSync(link).mode & 0o111).toBeTruthy(); // executable
  });

  it('is idempotent — a second run reports unchanged', () => {
    installClis({ packagesDir, binDir });
    const second = installClis({ packagesDir, binDir });
    expect(second.every((r) => r.action === 'unchanged')).toBe(true);
  });

  it('reports a bin whose dist target is missing (build required)', () => {
    makePackage('verify', { 'ai-pre-push-verify': './dist/bin/pre-push-verify.js' }, false);
    const results = installClis({ packagesDir, binDir });
    const missing = results.find((r) => r.name === 'ai-pre-push-verify');
    expect(missing?.action).toBe('missing');
    expect(() => lstatSync(join(binDir, 'ai-pre-push-verify'))).toThrow(); // never linked
  });

  it('skips a conflicting real file without --force, replaces it with --force', () => {
    mkdirSync(binDir);
    writeFileSync(join(binDir, 'ai-pr-summary'), 'hand-written, do not clobber');

    const skipped = installClis({ packagesDir, binDir });
    expect(skipped.find((r) => r.name === 'ai-pr-summary')?.action).toBe('skipped');
    expect(lstatSync(join(binDir, 'ai-pr-summary')).isSymbolicLink()).toBe(false);

    const forced = installClis({ packagesDir, binDir, force: true });
    expect(forced.find((r) => r.name === 'ai-pr-summary')?.action).toBe('updated');
    expect(lstatSync(join(binDir, 'ai-pr-summary')).isSymbolicLink()).toBe(true);
  });

  it('writes nothing in dry-run', () => {
    const results = installClis({ packagesDir, binDir, dryRun: true });
    expect(results.every((r) => r.action === 'linked')).toBe(true);
    expect(() => lstatSync(binDir)).toThrow(); // bin dir never created
  });
});
