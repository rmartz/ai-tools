#!/usr/bin/env tsx
/**
 * Install (and update) the published `ai-*` CLIs globally from GitHub Packages.
 *
 * Uses `npm install -g @rmartz/<pkg>@latest`, which pulls the *published* tarballs
 * into npm's global prefix — deliberately decoupled from this local checkout, so
 * the CLIs don't break when the root worktree switches to a feature branch or an
 * agent edits the source. Re-running always pulls `@latest`, so this doubles as
 * the updater (e.g. driven from a SessionStart hook — see docs/install-clis.md).
 *
 * npm (not `pnpm add -g`) is used deliberately: pnpm is corepack-pinned to the
 * workspace version here, and its `-g` store can mismatch the global pnpm major,
 * whereas `npm i -g` is invariant to that and reads the same `~/.npmrc` auth.
 *
 * Only the *names* of the bin-bearing packages are read from the workspace (stable
 * metadata); the code always comes from the registry. Requires `@rmartz` GitHub
 * Packages auth. `~/.npmrc` sources the token from `${GITHUB_PACKAGES_TOKEN}`; that
 * env var is only exported in interactive shells, so — for non-interactive callers
 * (the SessionStart hook, agent shells) — we self-source it from `gh auth token`.
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

/** The `npm install -g <pkg@tag> …` argv that installs/updates the CLIs. */
export function buildInstallArgs(packageNames: string[], tag = 'latest'): string[] {
  return ['install', '-g', ...packageNames.map((name) => `${name}@${tag}`)];
}

/**
 * Ensure `GITHUB_PACKAGES_TOKEN` (which `~/.npmrc` expands for the `@rmartz`
 * registry) is set for the npm child process. If already present, keep it;
 * otherwise fall back to the supplied `ghToken` (from `gh auth token`) so a
 * non-interactive caller still authenticates. Returns the env to pass to npm.
 */
export function withPackagesToken(env: NodeJS.ProcessEnv, ghToken?: string): NodeJS.ProcessEnv {
  if (env.GITHUB_PACKAGES_TOKEN || !ghToken) return env;
  return { ...env, GITHUB_PACKAGES_TOKEN: ghToken };
}

function ghAuthToken(): string | undefined {
  try {
    return (
      execFileSync('gh', ['auth', 'token', '-h', 'github.com'], { encoding: 'utf8' }).trim() ||
      undefined
    );
  } catch {
    return undefined;
  }
}

const AUTH_HINT = [
  'error: global install failed — check @rmartz GitHub Packages auth:',
  '  gh auth refresh -h github.com -s read:packages',
  '  ~/.npmrc:  @rmartz:registry=https://npm.pkg.github.com',
  '             //npm.pkg.github.com/:_authToken=${GITHUB_PACKAGES_TOKEN}',
  '  and a valid `gh auth token` (used automatically when the env var is unset).',
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
  const installArgs = buildInstallArgs(names, args.tag);

  if (args.dryRun) {
    console.log(`[dry-run] npm ${installArgs.join(' ')}`);
    return;
  }
  const env = withPackagesToken(process.env, ghAuthToken());
  try {
    // Run from a neutral cwd (home) so the install reads the user-level ~/.npmrc.
    execFileSync('npm', installArgs, { cwd: homedir(), stdio: 'inherit', env });
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
