import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Project-local permissions that coordinator-dispatched headless workers need.
 * TS port of dotfiles' `lib/worker_permissions.py`.
 *
 * A PR-review coordinator runs headless workers with cwd set to the repository
 * root. Those workers write scratch files under `.git-worktrees/` and create
 * per-task worktrees there. A path like `.git-worktrees/**` is only meaningful
 * relative to a project root, so it must live in that project's settings — a
 * repo that grants none of them makes every worker stop on a permission prompt
 * it cannot answer headless.
 *
 * This module declares those project-relative permissions, checks whether a
 * repo's effective allowlist already covers them, and — only when it does not —
 * adds the missing entries to `.claude/settings.local.json` without disturbing
 * any custom permissions the repo already defines.
 *
 * **Worktree-internal edits (#1201).** The relative grants suffice when a worker
 * edits worktree files from the repo root. But once cwd is the worktree, an
 * Edit/Write glob is matched relative to that cwd (`src/…`, no `.git-worktrees/`
 * prefix), so the relative grant no longer matches. The required set therefore
 * also includes an **absolute, repo-scoped** grant
 * (`Write(<repo>/.git-worktrees/**)`) that matches by absolute path regardless
 * of cwd, while staying bounded to that repo's worktree subtree.
 */

/**
 * The project-relative permissions a coordinator-dispatched worker performs.
 * `requiredWorkerPermissions` extends this with absolute, repo-scoped
 * equivalents (see the module docstring, #1201).
 */
export const REQUIRED_WORKER_PERMISSIONS: readonly string[] = [
  'Edit(.git-worktrees/**)',
  'Write(.git-worktrees/**)',
];

/**
 * The full grant set a worker needs for `repoDir`: the relative
 * `.git-worktrees/**` grants plus absolute, repo-scoped `Edit`/`Write` grants
 * that match a worktree file by its absolute path regardless of the worker's cwd
 * (#1201), bounded to this repo's worktree subtree.
 */
export function requiredWorkerPermissions(repoDir: string): string[] {
  const absRoot = resolve(repoDir);
  return [
    ...REQUIRED_WORKER_PERMISSIONS,
    `Edit(${absRoot}/.git-worktrees/**)`,
    `Write(${absRoot}/.git-worktrees/**)`,
  ];
}

const SETTINGS_FILES = [join('.claude', 'settings.json'), join('.claude', 'settings.local.json')];
const SETTINGS_LOCAL = join('.claude', 'settings.local.json');

/**
 * Return the `permissions.allow` list from a settings file, or `[]`. Tolerant of
 * a missing file, malformed JSON, or an unexpected shape.
 */
function loadAllow(path: string): string[] {
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return [];
  }
  if (typeof data !== 'object' || data === null) return [];
  const perms = (data as Record<string, unknown>).permissions;
  if (typeof perms !== 'object' || perms === null) return [];
  const allow = (perms as Record<string, unknown>).allow;
  if (!Array.isArray(allow)) return [];
  return allow.filter((entry): entry is string => typeof entry === 'string');
}

/**
 * The union of `permissions.allow` across a repo's `.claude/settings.json` and
 * `.claude/settings.local.json` (symlinks followed, mirroring how Claude Code
 * merges them).
 */
export function effectiveAllow(repoDir: string): Set<string> {
  const allow = new Set<string>();
  for (const rel of SETTINGS_FILES) {
    for (const entry of loadAllow(join(repoDir, rel))) allow.add(entry);
  }
  return allow;
}

/** Split `"Tool(arg)"` into `["Tool", "arg"]`; bare `"Tool"` → `["Tool", ""]`. */
function splitEntry(entry: string): [string, string] {
  if (entry.endsWith(')') && entry.includes('(')) {
    const open = entry.indexOf('(');
    return [entry.slice(0, open).trim(), entry.slice(open + 1, -1)];
  }
  return [entry.trim(), ''];
}

/**
 * Whether `required` is satisfied by the held `allowed` grants: an exact match,
 * or a tool-wide grant for the same tool (`Tool`, `Tool(*)`, or `Tool(**)`).
 */
function isCovered(required: string, allowed: Set<string>): boolean {
  if (allowed.has(required)) return true;
  const [tool] = splitEntry(required);
  return allowed.has(tool) || allowed.has(`${tool}(*)`) || allowed.has(`${tool}(**)`);
}

/** The required worker permissions a repo's root does not yet grant. */
export function missingWorkerPermissions(repoDir: string): string[] {
  const allowed = effectiveAllow(repoDir);
  return requiredWorkerPermissions(repoDir).filter((p) => !isCovered(p, allowed));
}

/**
 * Ensure `repoDir`'s root grants every required worker permission. Returns the
 * entries that were added (empty when already satisfied). Missing entries are
 * appended to `.claude/settings.local.json`, creating the file (and `.claude/`)
 * if absent and preserving existing keys and grants. A symlinked
 * `settings.local.json` is never written through — it is replaced with a
 * concrete file carrying the needed grants. Idempotent.
 */
export function ensureWorkerPermissions(repoDir: string): string[] {
  const missing = missingWorkerPermissions(repoDir);
  if (missing.length === 0) return [];

  const local = join(repoDir, SETTINGS_LOCAL);
  mkdirSync(join(repoDir, '.claude'), { recursive: true });

  let data: Record<string, unknown> = {};
  let isSymlink = false;
  try {
    isSymlink = lstatSync(local).isSymbolicLink();
  } catch {
    /* absent */
  }
  if (isSymlink) {
    rmSync(local);
  } else if (existsSync(local)) {
    try {
      const loaded = JSON.parse(readFileSync(local, 'utf8'));
      if (typeof loaded === 'object' && loaded !== null) {
        data = loaded as Record<string, unknown>;
      }
    } catch {
      data = {};
    }
  }

  let perms = data.permissions;
  if (typeof perms !== 'object' || perms === null) {
    perms = {};
    data.permissions = perms;
  }
  const permsObj = perms as Record<string, unknown>;
  let allow = permsObj.allow;
  if (!Array.isArray(allow)) allow = [];
  const allowList = allow as string[];
  for (const entry of missing) {
    if (!allowList.includes(entry)) allowList.push(entry);
  }
  permsObj.allow = allowList;

  writeFileSync(local, JSON.stringify(data, null, 2) + '\n');
  return missing;
}
