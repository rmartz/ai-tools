import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readlinkSync,
  lstatSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installSkills } from './install-skills.js';

let root: string;
let skillsDir: string;
let commandsDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'install-skills-'));
  skillsDir = join(root, 'skills');
  commandsDir = join(root, 'commands');
  mkdirSync(skillsDir);
  writeFileSync(join(skillsDir, 'discuss.md'), '# discuss');
  writeFileSync(join(skillsDir, 'review.md'), '# review');
  writeFileSync(join(skillsDir, 'notes.txt'), 'ignored'); // non-md skipped
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('installSkills', () => {
  it('symlinks every .md skill into the commands dir (creating it)', () => {
    const results = installSkills({ skillsDir, commandsDir });
    expect(results.map((r) => r.name)).toEqual(['discuss.md', 'review.md']); // sorted, .txt excluded
    expect(results.every((r) => r.action === 'linked')).toBe(true);
    expect(lstatSync(join(commandsDir, 'discuss.md')).isSymbolicLink()).toBe(true);
    expect(readlinkSync(join(commandsDir, 'discuss.md'))).toBe(join(skillsDir, 'discuss.md'));
  });

  it('is idempotent — a second run reports unchanged', () => {
    installSkills({ skillsDir, commandsDir });
    const second = installSkills({ skillsDir, commandsDir });
    expect(second.every((r) => r.action === 'unchanged')).toBe(true);
  });

  it('skips a conflicting real file without --force, replaces it with --force', () => {
    mkdirSync(commandsDir);
    writeFileSync(join(commandsDir, 'discuss.md'), 'hand-written, do not clobber');

    const skipped = installSkills({ skillsDir, commandsDir });
    const discuss = skipped.find((r) => r.name === 'discuss.md');
    expect(discuss?.action).toBe('skipped');
    expect(lstatSync(join(commandsDir, 'discuss.md')).isSymbolicLink()).toBe(false);

    const forced = installSkills({ skillsDir, commandsDir, force: true });
    expect(forced.find((r) => r.name === 'discuss.md')?.action).toBe('updated');
    expect(lstatSync(join(commandsDir, 'discuss.md')).isSymbolicLink()).toBe(true);
  });

  it('refreshes a stale link it owns (points into skillsDir) without --force', () => {
    mkdirSync(commandsDir);
    // A prior install left discuss.md pointing at a now-missing file *inside*
    // skillsDir — a broken link we still own and should self-heal.
    symlinkSync(join(skillsDir, 'renamed-away.md'), join(commandsDir, 'discuss.md'));

    const discuss = installSkills({ skillsDir, commandsDir }).find((r) => r.name === 'discuss.md');
    expect(discuss?.action).toBe('updated');
    expect(discuss?.detail).toContain('refreshed');
    expect(readlinkSync(join(commandsDir, 'discuss.md'))).toBe(join(skillsDir, 'discuss.md'));
  });

  it('leaves a foreign symlink (points outside skillsDir) untouched without --force', () => {
    mkdirSync(commandsDir);
    const foreign = join(root, 'elsewhere.md');
    writeFileSync(foreign, '# elsewhere');
    symlinkSync(foreign, join(commandsDir, 'discuss.md'));

    const discuss = installSkills({ skillsDir, commandsDir }).find((r) => r.name === 'discuss.md');
    expect(discuss?.action).toBe('skipped');
    expect(readlinkSync(join(commandsDir, 'discuss.md'))).toBe(foreign); // untouched
  });

  it('writes nothing in dry-run', () => {
    const results = installSkills({ skillsDir, commandsDir, dryRun: true });
    expect(results.every((r) => r.action === 'linked')).toBe(true);
    expect(() => lstatSync(commandsDir)).toThrow(); // commands dir never created
  });
});
