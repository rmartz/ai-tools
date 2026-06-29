#!/usr/bin/env tsx
import {
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
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

    const kind = existing.isSymbolicLink()
      ? `symlink → ${safeReadlink(linkPath)}`
      : 'existing file';
    if (!force) {
      results.push({ name: file, action: 'skipped', detail: kind });
      continue;
    }
    if (!dryRun) {
      rmSync(linkPath, { force: true });
      symlinkSync(source, linkPath);
    }
    results.push({ name: file, action: 'updated', detail: `replaced ${kind}` });
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
