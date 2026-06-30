import { boundedRun } from '@rmartz/agent-runtime';

const GH_API_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 2;
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_CAP_MS = 8_000;

/**
 * A single `gh` invocation: an argv plus an optional stdin body. `stdin` is set
 * when the call sends a request body (`gh api --input -` / `--body-file -`).
 */
export interface Transport {
  argv: string[];
  stdin?: string;
}

/** Injectable sleeper so tests can drive backoff without real delays. */
export type Sleeper = (ms: number) => Promise<void>;

const realSleep: Sleeper = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export interface GhCallOptions {
  /** Working directory for the `gh` subprocess. */
  cwd?: string;
  sleep?: Sleeper;
}

function isRateLimited(text: string): boolean {
  const t = (text ?? '').toLowerCase();
  return t.includes('rate limit') || t.includes('rate-limit');
}

async function runTransport(
  { argv, stdin }: Transport,
  cwd: string | undefined,
): Promise<{ stdout: string | null; stderr: string }> {
  const [command, ...args] = argv;
  if (command === undefined) return { stdout: null, stderr: 'empty argv' };
  try {
    const r = await boundedRun(command, args, { timeoutMs: GH_API_TIMEOUT_MS, cwd, input: stdin });
    if (r.code === 0) return { stdout: r.stdout, stderr: '' };
    return { stdout: null, stderr: r.stderr || '' };
  } catch (err) {
    return { stdout: null, stderr: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Run `primary` (REST via `gh api`) with bounded exponential-backoff retry; on a
 * rate-limit error, fall back to `fallback` (the equivalent GraphQL `gh`
 * subcommand) immediately — REST and GraphQL draw from separate hourly pools, so
 * exhausting one degrades to the other rather than failing. Returns the winning
 * transport's stdout, or `null` on total failure (soft-fail, matching the
 * tracking/self-report callers' posture). TS port of dotfiles' `gh_issue_ops._call`.
 */
export async function ghCall(
  primary: Transport,
  fallback: Transport | null,
  opts: GhCallOptions = {},
): Promise<string | null> {
  const sleep = opts.sleep ?? realSleep;
  for (const transport of [primary, fallback]) {
    if (!transport) continue;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const { stdout, stderr } = await runTransport(transport, opts.cwd);
      if (stdout !== null) return stdout;
      // This pool is exhausted — don't burn retries on it; switch transports.
      if (isRateLimited(stderr)) break;
      if (attempt < MAX_RETRIES) {
        await sleep(Math.min(BACKOFF_BASE_MS * 2 ** attempt, BACKOFF_CAP_MS));
      }
    }
  }
  return null;
}

/** Resolve the current `owner/repo` from the git remote via `gh`, or `null`. */
export async function currentRepo(opts: GhCallOptions = {}): Promise<string | null> {
  const out = await ghCall(
    { argv: ['gh', 'repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'] },
    null,
    opts,
  );
  return out && out.trim() ? out.trim() : null;
}

/** A repo's identity plus the current HEAD of its default branch. */
export interface ProjectRef {
  repo: string;
  branch: string;
  sha: string;
}

/**
 * Resolve a repo's `owner/repo`, default branch, and that branch's current HEAD
 * sha via `gh`. With no `repo`, resolves the working repo (`gh repo view`).
 * Used to stamp a discussion comment with the project's mainline commit, so a
 * perspective is anchored to how the project looked when it was posted — and can
 * be compared against how it later evolved. Soft-fails to `null`.
 */
export async function resolveProjectRef(
  repo?: string,
  opts: GhCallOptions = {},
): Promise<ProjectRef | null> {
  const viewArgv = ['gh', 'repo', 'view'];
  if (repo) viewArgv.push(repo);
  viewArgv.push('--json', 'nameWithOwner,defaultBranchRef');
  const viewOut = await ghCall({ argv: viewArgv }, null, opts);
  if (viewOut === null) return null;
  let view: { nameWithOwner?: string; defaultBranchRef?: { name?: string } | null };
  try {
    view = JSON.parse(viewOut) as typeof view;
  } catch {
    return null;
  }
  const resolvedRepo = view.nameWithOwner;
  const branch = view.defaultBranchRef?.name;
  if (!resolvedRepo || !branch) return null;
  const shaOut = await ghCall(
    { argv: ['gh', 'api', `repos/${resolvedRepo}/commits/${branch}`, '--jq', '.sha'] },
    null,
    opts,
  );
  const sha = shaOut?.trim();
  return sha ? { repo: resolvedRepo, branch, sha } : null;
}

/** Normalize an issue/PR number or URL to its numeric string, or `null`. */
export function issueNumber(ref: string | number): string | null {
  const s = String(ref);
  if (/^\d+$/.test(s)) return s;
  const m = s.match(/\/(?:issues|pull)\/(\d+)/);
  return m?.[1] ?? null;
}
