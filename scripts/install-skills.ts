#!/usr/bin/env tsx
import {
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export type SkillAction = 'linked' | 'unchanged' | 'updated' | 'skipped';

export interface SkillResult {
  name: string;
  action: SkillAction;
  detail?: string;
}

export interface InstallSkillsOptions {
  skillsDir: string;
  commandsDir: string;
  force?: boolean;
  dryRun?: boolean;
}

function safeReadlink(p: string): string {
  try {
    return readlinkSync(p);
  } catch {
    return '?';
  }
}

function sameTarget(linkPath: string, source: string): boolean {
  try {
    return realpathSync(linkPath) === realpathSync(source);
  } catch {
    return false;
  }
}

// Is `linkPath` a symlink already pointing somewhere inside `skillsDir`? Such a
// link is one we created (or a prior install did), so a re-run may refresh it to
// the canonical source without `--force`, even when it is now stale or broken —
// `readlinkSync` reads the raw target without resolving it, so a dangling link
// still classifies. A regular file or a symlink pointing elsewhere is foreign.
// Remove an existing file or symlink. `unlinkSync` never follows the link, so it
// reliably clears a broken symlink — unlike `rmSync({ force: true })`, which
// follows it, finds the target missing, and silently no-ops, leaving it in place.
function removeExisting(p: string): void {
  try {
    unlinkSync(p);
  } catch {
    /* best-effort; a following symlinkSync surfaces any real problem */
  }
}

function ownsLink(linkPath: string, skillsDir: string): boolean {
  try {
    const target = resolve(dirname(linkPath), readlinkSync(linkPath));
    const base = resolve(skillsDir);
    return target === base || target.startsWith(base + sep);
  } catch {
    return false;
  }
}

export function installSkills(opts: InstallSkillsOptions): SkillResult[] {
  const { skillsDir, commandsDir, force = false, dryRun = false } = opts;
  const skills = readdirSync(skillsDir)
    .filter((f) => f.endsWith('.md'))
    .sort();
  if (!dryRun) mkdirSync(commandsDir, { recursive: true });

  const results: SkillResult[] = [];
  for (const file of skills) {
    const source = resolve(skillsDir, file);
    const linkPath = join(commandsDir, file);

    let existing: ReturnType<typeof lstatSync> | null;
    try {
      existing = lstatSync(linkPath);
    } catch {
      existing = null;
    }

    if (existing === null) {
      if (!dryRun) symlinkSync(source, linkPath);
      results.push({ name: file, action: 'linked' });
      continue;
    }
    if (existing.isSymbolicLink() && sameTarget(linkPath, source)) {
      results.push({ name: file, action: 'unchanged' });
      continue;
    }

    // A stale/broken link we already own is refreshed to the canonical source
    // without `--force` — this is what makes the SessionStart re-install
    // self-healing. A foreign file/symlink is left untouched unless `--force`.
    const ours = ownsLink(linkPath, skillsDir);
    const kind = existing.isSymbolicLink()
      ? `symlink → ${safeReadlink(linkPath)}`
      : 'existing file';
    if (!ours && !force) {
      results.push({ name: file, action: 'skipped', detail: kind });
      continue;
    }
    if (!dryRun) {
      removeExisting(linkPath);
      symlinkSync(source, linkPath);
    }
    results.push({
      name: file,
      action: 'updated',
      detail: ours ? 'refreshed ai-tools link' : `replaced ${kind}`,
    });
  }
  return results;
}

interface CliArgs {
  force: boolean;
  dryRun: boolean;
  commandsDir?: string;
  skillsDir?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { force: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--force') args.force = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--commands-dir') args.commandsDir = argv[++i];
    else if (a === '--skills-dir') args.skillsDir = argv[++i];
  }
  return args;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const skillsDir = args.skillsDir ?? join(repoRoot, 'skills');
  const commandsDir = args.commandsDir ?? join(homedir(), '.claude', 'commands');

  const results = installSkills({ ...args, skillsDir, commandsDir });
  const prefix = args.dryRun ? '[dry-run] ' : '';
  for (const r of results) {
    console.log(`${prefix}${r.action.padEnd(9)} ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
  }
  const skipped = results.filter((r) => r.action === 'skipped').length;
  const tail = skipped ? `; ${skipped} skipped — re-run with --force to replace` : '';
  console.log(`\n${prefix}${results.length} skill(s) → ${commandsDir}${tail}`);
}

// Run only when invoked directly, so tests can import `installSkills` without
// triggering a real symlink pass against the user's ~/.claude.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
