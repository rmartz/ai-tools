import { boundedRun } from '@rmartz/agent-runtime';

/**
 * Resolve the git ref a new worktree should fork from.
 *
 * A worktree is normally branched off the repository's default branch. For
 * **stacked** work — a task whose dependency is still an open PR — the worktree
 * is instead branched off that PR's head branch, so the dependent change builds
 * on top of the in-review work rather than waiting for it to merge. This module
 * holds both resolutions:
 *
 *   - `resolveDefaultBranch` — the repo's default branch, via a graceful
 *     GitHub-API → local-git → `main` fallback chain so an API outage never
 *     aborts worktree creation.
 *   - `resolveBaseRef` — turn a caller-supplied `--base` (a branch name, or a
 *     `#1271` / `1271` PR reference) into the origin branch to fork from. PR
 *     references are resolved to their head branch via `gh pr view`.
 *
 * Kept out of `new-worktree.ts` so the "what ref do we fork from" concept lives
 * in one conceptually-named place and the script stays focused on orchestration.
 * TS port of dotfiles' `lib/worktree_base.py`.
 */

const GIT_TIMEOUT_MS = 30_000;

/**
 * A `--base` value that is all digits (optionally a leading `#`) is treated as a
 * PR reference rather than a branch name. Numeric branch names are vanishingly
 * rare; the `#` form is always unambiguous.
 */
const PR_REF_RE = /^#?(\d+)$/;

/** Injectable logger so tests can assert (or silence) the fallback warning. */
export type Log = (message: string) => void;

/** Options shared by the resolvers — `cwd` for the git/gh subprocess. */
export interface ResolveOptions {
  cwd?: string;
  log?: Log;
}

/** Run a git/gh command, returning trimmed stdout on success or `null`. */
async function tryRun(argv: string[], cwd: string | undefined): Promise<string | null> {
  const [command, ...args] = argv;
  if (command === undefined) return null;
  try {
    const r = await boundedRun(command, args, { timeoutMs: GIT_TIMEOUT_MS, cwd });
    if (r.code !== 0) return null;
    return r.stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Best-effort local resolution of the default branch — no GitHub API.
 *
 * Tries, in order: the cached `origin/HEAD` symbolic ref (purely local, no
 * network — set by `git clone` / `git remote set-head`), then the `HEAD branch`
 * line from `git remote show origin`. Returns the bare branch name, or `null`
 * if neither yields one.
 */
async function resolveDefaultBranchLocal(cwd: string | undefined): Promise<string | null> {
  const symbolic = await tryRun(
    ['git', 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD'],
    cwd,
  );
  if (symbolic) {
    // `--short` yields e.g. `origin/main`; strip the remote prefix.
    return symbolic.includes('/') ? symbolic.slice(symbolic.indexOf('/') + 1) : symbolic;
  }
  const remoteShow = await tryRun(['git', 'remote', 'show', 'origin'], cwd);
  if (remoteShow) {
    for (const line of remoteShow.split('\n')) {
      const stripped = line.trim();
      if (stripped.startsWith('HEAD branch:')) {
        const branch = stripped.slice('HEAD branch:'.length).trim();
        if (branch && branch !== '(unknown)') return branch;
      }
    }
  }
  return null;
}

/**
 * Return the repo's default branch via `gh repo view`, falling back to local git
 * (`origin/HEAD`, then `git remote show origin`) and finally `"main"`, so a
 * GitHub API outage never aborts worktree creation. A warning is emitted
 * whenever a fallback past the API is taken. The happy path never hard-codes
 * `main`: a repo using `master`, `develop`, or any other default works the same.
 */
export async function resolveDefaultBranch(opts: ResolveOptions = {}): Promise<string> {
  const fromApi = await tryRun(
    ['gh', 'repo', 'view', '--json', 'defaultBranchRef', '--jq', '.defaultBranchRef.name'],
    opts.cwd,
  );
  if (fromApi) return fromApi;
  const resolved = (await resolveDefaultBranchLocal(opts.cwd)) ?? 'main';
  (opts.log ?? console.error)(
    `warning: could not resolve default branch via gh (API unavailable); ` +
      `falling back to local git resolution (using '${resolved}')`,
  );
  return resolved;
}

/**
 * Resolve a `--base` argument to the origin branch name to fork from.
 *
 * `base` is either a branch name (returned verbatim) or a PR reference —
 * `#1271` or `1271` — whose head branch is looked up via `gh pr view`. This is
 * what enables stacked worktrees: branching dependent work off an open PR's
 * branch rather than the default branch.
 *
 * Throws when a PR reference cannot be resolved (no such PR, network/auth
 * failure, or an empty head branch) so the caller aborts with a clear message
 * rather than silently forking from the wrong ref.
 */
export async function resolveBaseRef(base: string, opts: ResolveOptions = {}): Promise<string> {
  const trimmed = base.trim();
  const match = PR_REF_RE.exec(trimmed);
  const prNum = match?.[1];
  if (prNum === undefined) return trimmed;
  const branch = await tryRun(
    ['gh', 'pr', 'view', prNum, '--json', 'headRefName', '--jq', '.headRefName'],
    opts.cwd,
  );
  if (branch === null) {
    throw new Error(`failed to resolve base PR #${prNum} head branch via gh pr view`);
  }
  if (!branch) {
    throw new Error(`gh pr view for PR #${prNum} returned an empty head branch`);
  }
  return branch;
}
