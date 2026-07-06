#!/usr/bin/env tsx
/**
 * Install (and update) the published `ai-*` CLIs globally from GitHub Packages.
 *
 * For each bin-bearing workspace package it resolves the *highest published
 * version* from the registry (`npm view <pkg> versions`) and installs that exact
 * version globally. This deliberately avoids `@latest` and `@*`: GitHub Packages
 * does not reliably advance the `latest` dist-tag on publish, and the abbreviated
 * packument it serves to `npm install`'s range resolver can lag a fresh publish —
 * so both resolve to a *stale* version. `npm view` reads the full packument (which
 * is current), and installing the resolved exact version fetches the right tarball.
 * The install is decoupled from this local checkout (code always comes from the
 * registry), so the CLIs don't break when the root worktree switches branches or an
 * agent edits the source. Re-running is the updater (e.g. from a SessionStart hook).
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

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * The highest `X.Y.Z` version in `versions`, or `undefined` if none. Pre-release
 * and non-numeric tags are ignored — the CLIs publish plain semver. Comparison is
 * numeric per component, so `0.10.0` beats `0.9.0` (a string sort gets that wrong).
 */
export function maxStableVersion(versions: string[]): string | undefined {
  const stable = versions.filter((v) => /^\d+\.\d+\.\d+$/.test(v));
  return stable.length === 0
    ? undefined
    : stable.reduce((best, v) => (compareVersions(v, best) > 0 ? v : best));
}

/**
 * Pair each package name with its highest published version, dropping any the
 * registry can't resolve. `listVersions` is injected so resolution is testable
 * without hitting the network.
 */
export function resolveLatestVersions(
  names: string[],
  listVersions: (name: string) => string[],
): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (const name of names) {
    const version = maxStableVersion(listVersions(name));
    if (version) pairs.push([name, version]);
  }
  return pairs;
}

/** The `npm install -g <pkg@version> …` argv for the resolved packages. */
export function buildInstallArgs(pairs: Array<[string, string]>): string[] {
  return ['install', '-g', ...pairs.map(([name, version]) => `${name}@${version}`)];
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

/** A package's full published version list from the registry (empty on error). */
function npmViewVersions(name: string, env: NodeJS.ProcessEnv): string[] {
  try {
    const out = execFileSync('npm', ['view', name, 'versions', '--json', '--prefer-online'], {
      encoding: 'utf8',
      env,
    });
    const parsed: unknown = JSON.parse(out);
    if (Array.isArray(parsed)) return parsed.filter((v): v is string => typeof v === 'string');
    return typeof parsed === 'string' ? [parsed] : [];
  } catch {
    return [];
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
  packagesDir?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
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

  const env = withPackagesToken(process.env, ghAuthToken());
  const pairs = resolveLatestVersions(names, (name) => npmViewVersions(name, env));
  if (pairs.length === 0) {
    console.error(`\n${AUTH_HINT}`);
    process.exit(1);
  }
  const installArgs = buildInstallArgs(pairs);

  if (args.dryRun) {
    console.log(`[dry-run] npm ${installArgs.join(' ')}`);
    return;
  }
  try {
    // Run from a neutral cwd (home) so the install reads the user-level ~/.npmrc.
    execFileSync('npm', installArgs, { cwd: homedir(), stdio: 'inherit', env });
  } catch {
    console.error(`\n${AUTH_HINT}`);
    process.exit(1);
  }
  console.log(
    `\nInstalled/updated ${pairs.length} CLI package(s) globally:\n` +
      pairs.map(([name, version]) => `  ${name}@${version}`).join('\n'),
  );
}

// Run only when invoked directly, so tests can import the pure helpers without
// shelling out to a real global install.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
