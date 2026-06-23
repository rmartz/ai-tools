import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  readFileSync,
  writeFileSync,
  symlinkSync,
  lstatSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  REQUIRED_WORKER_PERMISSIONS,
  requiredWorkerPermissions,
  effectiveAllow,
  missingWorkerPermissions,
  ensureWorkerPermissions,
} from '../src/worker-permissions.js';

let repo: string;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'worker-perms-'));
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

function writeSettings(rel: string, allow: string[]): void {
  mkdirSync(join(repo, '.claude'), { recursive: true });
  writeFileSync(join(repo, rel), JSON.stringify({ permissions: { allow } }));
}

function readLocalAllow(): string[] {
  const data = JSON.parse(readFileSync(join(repo, '.claude', 'settings.local.json'), 'utf8'));
  return data.permissions.allow as string[];
}

describe('requiredWorkerPermissions', () => {
  it('extends the relative grants with absolute repo-scoped grants', () => {
    const abs = resolve(repo);
    expect(requiredWorkerPermissions(repo)).toEqual([
      ...REQUIRED_WORKER_PERMISSIONS,
      `Edit(${abs}/.git-worktrees/**)`,
      `Write(${abs}/.git-worktrees/**)`,
    ]);
  });
});

describe('effectiveAllow', () => {
  it('unions allow lists across both settings files', () => {
    writeSettings(join('.claude', 'settings.json'), ['Bash(ls)']);
    writeSettings(join('.claude', 'settings.local.json'), ['Edit(.git-worktrees/**)']);
    const allow = effectiveAllow(repo);
    expect(allow.has('Bash(ls)')).toBe(true);
    expect(allow.has('Edit(.git-worktrees/**)')).toBe(true);
  });

  it('tolerates missing and malformed files', () => {
    expect(effectiveAllow(repo).size).toBe(0);
    mkdirSync(join(repo, '.claude'), { recursive: true });
    writeFileSync(join(repo, '.claude', 'settings.json'), 'not json');
    expect(effectiveAllow(repo).size).toBe(0);
  });
});

describe('missingWorkerPermissions', () => {
  it('reports all four grants on a fresh repo', () => {
    expect(missingWorkerPermissions(repo)).toEqual(requiredWorkerPermissions(repo));
  });

  it('treats a tool-wide Write(**) grant as covering the Write entries', () => {
    writeSettings(join('.claude', 'settings.local.json'), [
      'Write(**)',
      'Edit(.git-worktrees/**)',
      `Edit(${resolve(repo)}/.git-worktrees/**)`,
    ]);
    expect(missingWorkerPermissions(repo)).toEqual([]);
  });
});

describe('ensureWorkerPermissions', () => {
  it('creates settings.local.json with the required grants on a fresh repo', () => {
    const added = ensureWorkerPermissions(repo);
    expect(added).toEqual(requiredWorkerPermissions(repo));
    expect(readLocalAllow()).toEqual(requiredWorkerPermissions(repo));
  });

  it('appends only missing grants, preserving existing keys and grants', () => {
    mkdirSync(join(repo, '.claude'), { recursive: true });
    writeFileSync(
      join(repo, '.claude', 'settings.local.json'),
      JSON.stringify({
        custom: true,
        permissions: { allow: ['Bash(ls)', 'Edit(.git-worktrees/**)'] },
      }),
    );
    const added = ensureWorkerPermissions(repo);
    expect(added).not.toContain('Edit(.git-worktrees/**)');
    const data = JSON.parse(readFileSync(join(repo, '.claude', 'settings.local.json'), 'utf8'));
    expect(data.custom).toBe(true);
    expect(data.permissions.allow).toContain('Bash(ls)');
    expect(data.permissions.allow).toContain('Write(.git-worktrees/**)');
  });

  it('is idempotent — a second run adds nothing', () => {
    ensureWorkerPermissions(repo);
    expect(ensureWorkerPermissions(repo)).toEqual([]);
  });

  it('replaces a symlinked settings.local.json rather than writing through it', () => {
    const target = join(repo, 'shared-settings.json');
    writeFileSync(target, JSON.stringify({ permissions: { allow: [] } }));
    mkdirSync(join(repo, '.claude'), { recursive: true });
    const link = join(repo, '.claude', 'settings.local.json');
    symlinkSync(target, link);

    ensureWorkerPermissions(repo);

    // The symlink target must be untouched; the link is now a concrete file.
    expect(JSON.parse(readFileSync(target, 'utf8')).permissions.allow).toEqual([]);
    expect(lstatSync(link).isSymbolicLink()).toBe(false);
    expect(readLocalAllow()).toEqual(requiredWorkerPermissions(repo));
  });
});
