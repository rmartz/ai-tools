/**
 * Getting `npm install -g` to land in npm's real global prefix — and proving it
 * did.
 *
 * Both halves exist because of one failure mode: `pnpm run` (and `npm run`)
 * export `npm_config_prefix=<project dir>` into every script's environment, npm
 * honours it as the **global prefix**, and so an `install -g` inherited from a
 * `pnpm run` script silently installs into `<repo>/lib/node_modules` +
 * `<repo>/bin` and still exits 0. The CLIs on `PATH` never move, and nothing
 * says so. See #290.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The npm config vars that relocate a global install. */
const INHERITED_PREFIX_VARS = ['npm_config_prefix', 'npm_config_global_prefix'] as const;

/**
 * Strip the package-manager lifecycle's prefix from the env handed to npm, so
 * `install -g` resolves npm's *real* global prefix instead of the project.
 *
 * Only the prefix vars are removed; other inherited `npm_config_*` (registry,
 * proxy) are the user's and are left alone. Returns `env` unchanged when neither
 * var is present.
 */
export function withoutInheritedPrefix(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (!INHERITED_PREFIX_VARS.some((key) => key in env)) return env;
  const sanitized = { ...env };
  for (const key of INHERITED_PREFIX_VARS) delete sanitized[key];
  return sanitized;
}

/** npm's global `node_modules` for this env, or `null` if npm can't report it. */
export function npmGlobalRoot(env: NodeJS.ProcessEnv): string | null {
  try {
    return execFileSync('npm', ['root', '-g'], { encoding: 'utf8', env }).trim() || null;
  } catch {
    return null;
  }
}

/** `name`'s installed version under `globalRoot`, or `undefined` if absent. */
export function installedVersion(globalRoot: string, name: string): string | undefined {
  const pkgJson = join(globalRoot, name, 'package.json');
  if (!existsSync(pkgJson)) return undefined;
  try {
    return (JSON.parse(readFileSync(pkgJson, 'utf8')) as { version?: string }).version;
  } catch {
    return undefined;
  }
}

export interface VersionMismatch {
  name: string;
  expected: string;
  /** The version found on disk, or `undefined` when the package is absent. */
  actual: string | undefined;
}

/**
 * The packages that are not installed at their intended version, given a reader
 * of on-disk versions. `npm install -g` exiting 0 does not prove the packages
 * landed where this machine resolves its CLIs from, so callers verify rather
 * than assume — a silent no-op must not read as success.
 */
export function findVersionMismatches(
  pairs: Array<[string, string]>,
  readInstalledVersion: (name: string) => string | undefined,
): VersionMismatch[] {
  const mismatches: VersionMismatch[] = [];
  for (const [name, expected] of pairs) {
    const actual = readInstalledVersion(name);
    if (actual !== expected) mismatches.push({ name, expected, actual });
  }
  return mismatches;
}

/** Operator guidance for a verification failure: the likely cause is the prefix. */
export const PREFIX_HINT = [
  'This usually means npm installed somewhere other than its global prefix.',
  'A `npm_config_prefix` inherited from `pnpm run`/`npm run` redirects `install -g`',
  'into the project (<repo>/lib/node_modules + <repo>/bin). Check with:',
  '  npm root -g',
  '  env | grep npm_config_prefix',
].join('\n');
