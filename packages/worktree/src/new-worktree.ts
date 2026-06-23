import { existsSync, mkdirSync, rmSync, symlinkSync, lstatSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { boundedRun } from '@rmartz/agent-runtime';
import { addAssignees, currentRepo } from '@rmartz/github';

import { resolveBaseRef, resolveDefaultBranch, type Log } from './worktree-base.js';

/**
 * Create a git worktree with project-aware setup boilerplate. TS reframe of
 * dotfiles' `new_worktree.py`: same orchestration (fetch the default branch,
 * `git worktree add` under `.git-worktrees/`, symlink the shared Claude
 * settings, assign the issue to the current gh user, support `--base` stacking)
 * but with **no Python venv** — the install step detects the JS package manager
 * from the lockfile and runs its install instead.
 *
 * Library surface (for tests): `deriveSlug`, `composeBranchName`,
 * `composeWorktreeDir`, `detectInstallCommand`, `createWorktree`,
 * `symlinkClaudeSettings`, `installDeps`, `assignIssue`, `runNewWorktree`.
 */

const GIT_TIMEOUT_MS = 60_000;
const INSTALL_TIMEOUT_MS = 600_000;
const GH_TIMEOUT_MS = 30_000;

/** The shared Claude project settings symlinked into each worktree (#573). */
export const CLAUDE_SETTINGS_SOURCE = join(homedir(), '.claude', 'project-settings.local.json');

/**
 * JS lockfile → install command. First match wins: `pnpm-lock.yaml` beats
 * `package-lock.json` because pnpm/npm aren't interchangeable — the lockfile the
 * repo ships dictates which package manager is authoritative.
 */
const JS_LOCKFILE_INSTALLS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['pnpm-lock.yaml', ['pnpm', 'install', '--frozen-lockfile']],
  ['package-lock.json', ['npm', 'ci']],
  ['yarn.lock', ['yarn', 'install', '--frozen-lockfile']],
];
/**
 * `package.json` without any lockfile — no manifest to honour, so the fallback
 * is a regular `npm install` (won't fail on a missing lockfile the way `npm ci`
 * would).
 */
const JS_LOOSE_FALLBACK: readonly string[] = ['npm', 'install'];

export const DEFAULT_BRANCH_PREFIX = 'feat';
export const VALID_BRANCH_PREFIXES = ['feat', 'fix', 'chore', 'refactor', 'test', 'docs'] as const;
export type BranchPrefix = (typeof VALID_BRANCH_PREFIXES)[number];

// ── Slug / branch / path composition ───────────────────────────────────────

/**
 * Derive a kebab-case slug from an issue title. Strips a Conventional Commits
 * prefix (`feat(scope): `), lowercases, replaces non-alphanumeric runs with
 * single dashes, trims edge dashes, and truncates to `maxWords` tokens. Returns
 * `"task"` for empty or all-symbol titles so branch composition never produces a
 * trailing dash.
 */
export function deriveSlug(title: string, maxWords = 4): string {
  if (!title) return 'task';
  const cleaned = title.trim().replace(/^[a-z]+(\([^)]+\))?!?:\s*/i, '');
  const slug = cleaned
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!slug) return 'task';
  const parts = slug.split('-').slice(0, maxWords);
  return parts.join('-') || 'task';
}

export interface ComposeBranchOptions {
  issueNum?: number;
  slug?: string;
  name?: string;
}

/**
 * Compose the feature branch name. With `issueNum`:
 * `<prefix>/issue-<N>-<slug>` (slug defaults to `"task"`). With only `name`:
 * `<prefix>/<name>`. Throws if neither is provided.
 */
export function composeBranchName(prefix: string, opts: ComposeBranchOptions): string {
  if (opts.issueNum !== undefined) {
    return `${prefix}/issue-${opts.issueNum}-${opts.slug || 'task'}`;
  }
  if (opts.name) return `${prefix}/${opts.name}`;
  throw new Error('composeBranchName requires either issueNum or name');
}

/**
 * Compose the worktree directory under `<repo>/.git-worktrees/`, using the
 * branch's last segment (leaf) as the directory name.
 */
export function composeWorktreeDir(repoRoot: string, branchName: string): string {
  const segments = branchName.split('/');
  const leaf = segments[segments.length - 1] ?? branchName;
  return join(repoRoot, '.git-worktrees', leaf);
}

// ── Filesystem / subprocess actions ────────────────────────────────────────

/**
 * Detect the JS dependency-install command for `repoRoot`, or `null` if no
 * recognized manifest is present. First matching lockfile from
 * `JS_LOCKFILE_INSTALLS` wins; falls back to `npm install` when only
 * `package.json` is present. The Python original also installed Python deps into
 * a per-worktree venv — this TS reframe is JS-only.
 */
export function detectInstallCommand(repoRoot: string): string[] | null {
  for (const [lockfile, command] of JS_LOCKFILE_INSTALLS) {
    if (existsSync(join(repoRoot, lockfile))) return [...command];
  }
  if (existsSync(join(repoRoot, 'package.json'))) return [...JS_LOOSE_FALLBACK];
  return null;
}

/**
 * Create the git worktree at `worktreePath`. Refuses to silently reuse an
 * existing path — silent reuse would hide stale state (uncommitted changes,
 * wrong base) from the agent setting up the new task. Throws on failure.
 */
export async function createWorktree(
  repoRoot: string,
  worktreePath: string,
  branch: string,
  baseRef: string,
): Promise<void> {
  if (existsSync(worktreePath)) {
    throw new Error(
      `worktree path already exists: ${worktreePath}. Remove it first ` +
        `(git worktree remove --force <path>) or pick a different name.`,
    );
  }
  const r = await boundedRun(
    'git',
    ['worktree', 'add', worktreePath, '-b', branch, `origin/${baseRef}`],
    { timeoutMs: GIT_TIMEOUT_MS, cwd: repoRoot },
  );
  if (r.code !== 0) throw new Error(`git worktree add failed: ${r.stderr.trim()}`);
}

/**
 * Symlink the shared Claude project settings into the worktree (the #573
 * footgun: without it, every Edit/Write inside the worktree prompts for
 * permission). Returns `true` if a symlink was created, `false` if the source is
 * absent. An existing file/symlink at the target is replaced, healing a stale
 * worktree on re-run.
 */
export function symlinkClaudeSettings(
  worktreePath: string,
  source: string = CLAUDE_SETTINGS_SOURCE,
): boolean {
  if (!existsSync(source)) return false;
  const claudeDir = join(worktreePath, '.claude');
  mkdirSync(claudeDir, { recursive: true });
  const link = join(claudeDir, 'settings.local.json');
  try {
    // lstat (not exists) so a broken/dangling symlink is also detected.
    lstatSync(link);
    rmSync(link);
  } catch {
    /* nothing there to remove */
  }
  symlinkSync(source, link);
  return true;
}

/**
 * Run the dependency-install command inside the worktree. Throws on failure — a
 * partial install leaves the worktree in an unknown state, better to surface
 * loudly than have tests fail later for confusing reasons.
 */
export async function installDeps(worktreePath: string, command: string[]): Promise<void> {
  const [cmd, ...args] = command;
  if (cmd === undefined) return;
  const r = await boundedRun(cmd, args, { timeoutMs: INSTALL_TIMEOUT_MS, cwd: worktreePath });
  if (r.code !== 0) {
    throw new Error(`dependency install failed (${command.join(' ')}): ${r.stderr.trim()}`);
  }
}

/**
 * Assign `issueNum` to `assignee` via `@rmartz/github` (REST-first, GraphQL
 * fallback). Returns `true` on success, `false` on failure — non-fatal, since
 * the worktree is already created and useful.
 */
export async function assignIssue(
  repo: string,
  issueNum: number,
  assignee: string,
  cwd?: string,
): Promise<boolean> {
  const result = await addAssignees(repo, issueNum, [assignee], { cwd });
  return result !== null;
}

// ── Orchestration ──────────────────────────────────────────────────────────

/** Resolve the git repo root containing `cwd`, or `null` if not in a repo. */
async function resolveRepoRoot(cwd: string): Promise<string | null> {
  const r = await boundedRun('git', ['rev-parse', '--show-toplevel'], {
    timeoutMs: GH_TIMEOUT_MS,
    cwd,
  });
  if (r.code !== 0) return null;
  return r.stdout.trim() || null;
}

/** Resolve the current gh user's login, or `null` on failure. */
async function resolveAssignee(cwd: string): Promise<string | null> {
  try {
    const r = await boundedRun('gh', ['api', 'user', '--jq', '.login'], {
      timeoutMs: GH_TIMEOUT_MS,
      cwd,
    });
    if (r.code !== 0) return null;
    return r.stdout.trim() || null;
  } catch {
    return null;
  }
}

/** Fetch an issue's title via `gh issue view`, or `null` on any failure. */
async function resolveIssueTitle(issueNum: number, cwd: string): Promise<string | null> {
  try {
    const r = await boundedRun(
      'gh',
      ['issue', 'view', String(issueNum), '--json', 'title', '--jq', '.title'],
      { timeoutMs: GH_TIMEOUT_MS, cwd },
    );
    if (r.code !== 0) return null;
    return r.stdout.trim() || null;
  } catch {
    return null;
  }
}

export interface NewWorktreeOptions {
  /** GitHub issue number to tie the worktree to. */
  issue?: number;
  /** Short slug for the worktree (overrides the issue-title-derived slug). */
  name?: string;
  /** Conventional-commit type prefix for the branch (default `feat`). */
  branchPrefix?: string;
  /** Branch or PR to fork from instead of the default branch (stacked work). */
  base?: string;
  /** Skip the dependency-install step. */
  skipInstall?: boolean;
  /** Working directory the command runs in (default `process.cwd()`). */
  cwd?: string;
  /** Progress logger (defaults to stderr). */
  log?: Log;
}

export interface NewWorktreeResult {
  worktreePath: string;
  branch: string;
  baseRef: string;
  defaultBranch: string;
}

/**
 * Create a worktree end-to-end and return its path/branch. Throws on any fatal
 * step (not a git repo, repo-slug resolution, git fetch/add, dep install);
 * issue assignment is non-fatal. The thin `bin/new-worktree.ts` wrapper prints
 * the path; all orchestration lives here.
 */
export async function runNewWorktree(opts: NewWorktreeOptions): Promise<NewWorktreeResult> {
  if (opts.issue === undefined && !opts.name) {
    throw new Error('either an issue number or name is required');
  }
  const log = opts.log ?? console.error;
  const cwd = opts.cwd ?? process.cwd();
  const prefix = opts.branchPrefix ?? DEFAULT_BRANCH_PREFIX;

  const repoRoot = await resolveRepoRoot(cwd);
  if (!repoRoot) throw new Error(`not a git repository (cwd=${cwd})`);

  const repoSlug = await currentRepo({ cwd: repoRoot });
  if (!repoSlug) throw new Error('failed to resolve repo slug via gh repo view');

  const defaultBranch = await resolveDefaultBranch({ cwd: repoRoot, log });
  let baseRef = defaultBranch;
  if (opts.base) baseRef = await resolveBaseRef(opts.base, { cwd: repoRoot });

  let branch: string;
  if (opts.issue !== undefined) {
    let slug = opts.name;
    if (slug === undefined) {
      const title = await resolveIssueTitle(opts.issue, repoRoot);
      slug = title ? deriveSlug(title) : 'task';
    }
    branch = composeBranchName(prefix, { issueNum: opts.issue, slug });
  } else {
    branch = composeBranchName(prefix, { name: opts.name });
  }
  const worktreePath = composeWorktreeDir(repoRoot, branch);

  const fetched = await boundedRun('git', ['fetch', 'origin', baseRef], {
    timeoutMs: GIT_TIMEOUT_MS,
    cwd: repoRoot,
  });
  if (fetched.code !== 0) throw new Error(`git fetch failed: ${fetched.stderr.trim()}`);

  await createWorktree(repoRoot, worktreePath, branch, baseRef);
  log(`[new-worktree] created ${worktreePath} on branch ${branch}`);

  if (baseRef !== defaultBranch) {
    log(
      `[new-worktree] stacked on '${baseRef}' (not the default branch ` +
        `'${defaultBranch}'). Open this worktree's PR against that base: ` +
        `gh pr create --base ${baseRef}`,
    );
  }

  if (symlinkClaudeSettings(worktreePath)) {
    log(
      '[new-worktree] symlinked ~/.claude/project-settings.local.json ' +
        'into .claude/settings.local.json',
    );
  }

  if (!opts.skipInstall) {
    const command = detectInstallCommand(repoRoot);
    if (command) {
      log(`[new-worktree] installing dependencies (${command.join(' ')})`);
      await installDeps(worktreePath, command);
    }
  }

  if (opts.issue !== undefined) {
    const assignee = await resolveAssignee(repoRoot);
    if (assignee) {
      if (await assignIssue(repoSlug, opts.issue, assignee, repoRoot)) {
        log(`[new-worktree] assigned issue #${opts.issue} to ${assignee}`);
      } else {
        log(`[new-worktree] warning: failed to assign issue #${opts.issue} to ${assignee}`);
      }
    }
  }

  return { worktreePath, branch, baseRef, defaultBranch };
}
