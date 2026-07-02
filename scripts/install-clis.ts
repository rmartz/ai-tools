#!/usr/bin/env tsx
/**
 * Install (and update) the published `ai-*` CLIs globally from GitHub Packages.
 *
 * Uses `pnpm add -g @rmartz/<pkg>@latest`, which pulls the *published* tarballs
 * into pnpm's global store — deliberately decoupled from this local checkout, so
 * the CLIs don't break when the root worktree switches to a feature branch or an
 * agent edits the source. Re-running always pulls `@latest`, so this doubles as
 * the updater (e.g. driven from a SessionStart hook — see docs/install-clis.md).
 *
 * Only the *names* of the bin-bearing packages are read from the workspace (stable
 * metadata); the executable code always comes from the registry. Requires `@rmartz`
 * GitHub Packages auth (a token with `read:packages`) and `pnpm setup`.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function hasBin(bin: unknown): boolean {
  if (typeof bin === 'string') return bin.length > 0;
  return bin != null && typeof bin === 'object' && Object.keys(bin).length > 0;
}

/** Names of workspace packages that expose a `bin` (i.e. ship CLIs to install). */
export function resolveBinPackages(packagesDir: string): string[] {
  const names: string[] = [];
  for (const entry of readdirSync(packagesDir).sort()) {
    const pkgJson = join(packagesDir, entry, 'package.json');
    if (!existsSync(pkgJson)) continue;
    const parsed = JSON.parse(readFileSync(pkgJson, 'utf8')) as { name?: string; bin?: unknown };
    if (parsed.name && hasBin(parsed.bin)) names.push(parsed.name);
  }
  return names;
}

/** The `pnpm add -g <pkg@tag> …` argv that installs/updates the CLIs. */
export function buildAddArgs(packageNames: string[], tag = 'latest'): string[] {
  return ['add', '-g', ...packageNames.map((name) => `${name}@${tag}`)];
}

const AUTH_HINT = [
  'error: global install failed — check @rmartz GitHub Packages auth and pnpm setup:',
  '  gh auth refresh -h github.com -s read:packages',
  '  ~/.npmrc:  @rmartz:registry=https://npm.pkg.github.com',
  '             //npm.pkg.github.com/:_authToken=<token with read:packages>',
  '  pnpm setup   # if the global bin dir is not yet configured',
].join('\n');

interface CliArgs {
  dryRun: boolean;
  tag: string;
  packagesDir?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { dryRun: false, tag: 'latest' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--tag') args.tag = argv[++i] ?? args.tag;
    else if (a === '--packages-dir') args.packagesDir = argv[++i];
  }
  return args;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const packagesDir = args.packagesDir ?? join(repoRoot, 'packages');

  const names = resolveBinPackages(packagesDir);
  if (names.length === 0) {
    console.error('error: no bin-bearing packages found');
    process.exit(1);
  }
  const addArgs = buildAddArgs(names, args.tag);

  if (args.dryRun) {
    console.log(`[dry-run] pnpm ${addArgs.join(' ')}`);
    return;
  }
  try {
    // Run from a neutral cwd (home) so the `-g` install resolves from the
    // registry via the user-level ~/.npmrc, not this workspace's config.
    execFileSync('pnpm', addArgs, { cwd: homedir(), stdio: 'inherit' });
  } catch {
    console.error(`\n${AUTH_HINT}`);
    process.exit(1);
  }
  console.log(`\nInstalled/updated ${names.length} CLI package(s) globally (@${args.tag}).`);
}

// Run only when invoked directly, so tests can import the pure helpers without
// shelling out to a real global install.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
