#!/usr/bin/env tsx
/**
 * Symlink the workspace `ai-*` CLIs onto a PATH directory, mirroring
 * `install-skills.ts` for skills. Walks each package's `package.json` `bin` map
 * and links the built `dist/bin/<name>.js` into `binDir` (default `~/.claude/bin`),
 * marking the dist file executable. Dogfood-friendly: the links point at locally
 * built code, so `pnpm build` must run first — a missing dist target is reported
 * (not silently skipped) so the install fails loudly rather than half-linking.
 */
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type CliAction = 'linked' | 'unchanged' | 'updated' | 'skipped' | 'missing';

export interface CliResult {
  name: string;
  action: CliAction;
  detail?: string;
}

export interface InstallClisOptions {
  packagesDir: string;
  binDir: string;
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

/** Collect `{ commandName → absolute dist bin path }` from every package's `bin`. */
function collectBins(packagesDir: string): Map<string, string> {
  const bins = new Map<string, string>();
  for (const entry of readdirSync(packagesDir).sort()) {
    const pkgJson = join(packagesDir, entry, 'package.json');
    if (!existsSync(pkgJson)) continue;
    const parsed = JSON.parse(readFileSync(pkgJson, 'utf8')) as {
      name?: string;
      bin?: Record<string, string> | string;
    };
    if (!parsed.bin) continue;
    const map =
      typeof parsed.bin === 'string'
        ? { [(parsed.name ?? entry).split('/').pop() as string]: parsed.bin }
        : parsed.bin;
    for (const [name, rel] of Object.entries(map)) {
      bins.set(name, resolve(packagesDir, entry, rel));
    }
  }
  return bins;
}

export function installClis(opts: InstallClisOptions): CliResult[] {
  const { packagesDir, binDir, force = false, dryRun = false } = opts;
  const bins = collectBins(packagesDir);
  if (!dryRun) mkdirSync(binDir, { recursive: true });

  const results: CliResult[] = [];
  for (const [name, source] of [...bins].sort(([a], [b]) => a.localeCompare(b))) {
    if (!existsSync(source)) {
      results.push({ name, action: 'missing', detail: 'run `pnpm build` first' });
      continue;
    }
    const linkPath = join(binDir, name);

    let existing: ReturnType<typeof lstatSync> | null;
    try {
      existing = lstatSync(linkPath);
    } catch {
      existing = null;
    }

    if (existing !== null && existing.isSymbolicLink() && sameTarget(linkPath, source)) {
      if (!dryRun) chmodSync(source, 0o755);
      results.push({ name, action: 'unchanged' });
      continue;
    }
    if (existing !== null) {
      const kind = existing.isSymbolicLink()
        ? `symlink → ${safeReadlink(linkPath)}`
        : 'existing file';
      if (!force) {
        results.push({ name, action: 'skipped', detail: kind });
        continue;
      }
      if (!dryRun) rmSync(linkPath, { force: true });
      if (!dryRun) {
        symlinkSync(source, linkPath);
        chmodSync(source, 0o755);
      }
      results.push({ name, action: 'updated', detail: `replaced ${kind}` });
      continue;
    }
    if (!dryRun) {
      symlinkSync(source, linkPath);
      chmodSync(source, 0o755);
    }
    results.push({ name, action: 'linked' });
  }
  return results;
}

interface CliArgs {
  force: boolean;
  dryRun: boolean;
  binDir?: string;
  packagesDir?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { force: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--force') args.force = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--bin-dir') args.binDir = argv[++i];
    else if (a === '--packages-dir') args.packagesDir = argv[++i];
  }
  return args;
}

function onPath(binDir: string): boolean {
  const entries = (process.env.PATH ?? '').split(delimiter);
  return entries.some((e) => e && realpathSyncOr(e) === realpathSyncOr(binDir));
}

function realpathSyncOr(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const packagesDir = args.packagesDir ?? join(repoRoot, 'packages');
  const binDir = args.binDir ?? join(homedir(), '.claude', 'bin');

  const results = installClis({ ...args, packagesDir, binDir });
  const prefix = args.dryRun ? '[dry-run] ' : '';
  for (const r of results) {
    console.log(`${prefix}${r.action.padEnd(9)} ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
  }
  const missing = results.filter((r) => r.action === 'missing');
  const skipped = results.filter((r) => r.action === 'skipped').length;
  const tail = skipped ? `; ${skipped} skipped — re-run with --force to replace` : '';
  console.log(`\n${prefix}${results.length - missing.length} CLI(s) → ${binDir}${tail}`);

  if (!args.dryRun && !onPath(binDir)) {
    console.log(`\nNote: ${binDir} is not on your PATH. Add it (e.g. in your shell profile):`);
    console.log(`  export PATH="${binDir}:$PATH"`);
  }
  if (missing.length > 0) {
    console.error(`\nerror: ${missing.length} bin(s) not built — run \`pnpm build\`, then re-run.`);
    process.exit(1);
  }
}

// Run only when invoked directly, so tests can import `installClis` without
// touching the user's ~/.claude.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
