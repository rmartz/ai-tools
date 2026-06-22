import { ghCall, currentRepo, type GhCallOptions } from './gh-call.js';

/**
 * Format the diff between two commits for review. Review *craft* — the
 * incremental diff the `/review` skill shows since the last review.
 *
 * Merge-from-main filtering: the GitHub three-dot `compare/base...head` range
 * includes every commit reachable from head but not base, so a branch that
 * pulled `main` in via a merge commit drags all of main's commits into the diff.
 * When the range contains a merge commit, we abandon the single unified diff and
 * walk the branch's **first-parent chain** from head back to base, emitting only
 * the author's own (non-merge) commits. Each merge commit is summarized: a clean
 * pull of main (every changed file matches one parent exactly) becomes a one-line
 * note, while any file the merge changed relative to *both* parents — where a
 * conflict resolution or evil merge hides — is surfaced with its patch so it is
 * never silently dropped. With no merge commit, an unreconstructable chain, or a
 * truncated compare (>250 commits), we fall back to the unified diff — never
 * guessing. TS port of dotfiles' `pr_diff.py`.
 */

interface DiffFile {
  filename: string;
  patch?: string;
  status?: string;
}

interface Commit {
  sha: string;
  commit?: { message?: string };
  parents?: { sha: string }[];
}

interface Compare {
  commits?: Commit[];
  files?: DiffFile[];
  total_commits?: number;
}

export interface PrDiffOptions extends GhCallOptions {
  /** Informational notes (truncation / fallback). Defaults to `console.error`. */
  warn?: (message: string) => void;
}

async function api<T>(path: string, opts: GhCallOptions): Promise<T> {
  const out = await ghCall({ argv: ['gh', 'api', path] }, null, opts);
  if (out === null) throw new Error(`gh api ${path} failed`);
  try {
    return JSON.parse(out) as T;
  } catch (e) {
    throw new Error(`could not parse response for ${path} — ${String(e)}`);
  }
}

function formatFile(f: DiffFile, label = ''): string {
  const suffix = label ? ` (${label})` : '';
  const patch = f.patch ? f.patch : `(no patch — ${f.status || 'binary or empty'})`;
  return `=== ${f.filename}${suffix} ===\n${patch}\n`;
}

function formatUnified(files: DiffFile[]): string {
  if (!files.length) return '(no file changes between these commits)\n';
  return files.map((f) => formatFile(f)).join('\n');
}

/**
 * Walk the first-parent chain from head back to base, oldest-first (base
 * excluded), or `null` if it cannot be reconstructed from the compare range.
 */
function firstParentChain(commits: Commit[], baseSha: string, headSha: string): Commit[] | null {
  const bySha = new Map(commits.map((c) => [c.sha, c]));
  const chain: Commit[] = [];
  const seen = new Set<string>();
  let cur = headSha;
  while (cur !== baseSha) {
    if (seen.has(cur)) return null; // cycle guard
    seen.add(cur);
    const commit = bySha.get(cur);
    if (commit === undefined) return null; // parent outside range and not base
    chain.push(commit);
    const parents = commit.parents ?? [];
    if (!parents.length) return null; // reached a root without hitting base
    cur = parents[0]!.sha;
  }
  chain.reverse();
  return chain;
}

async function formatMergeNote(repo: string, commit: Commit, short: string, opts: GhCallOptions) {
  const parents = commit.parents!;
  const sha = commit.sha;
  const p1 = parents[0]!.sha;
  const p2 = parents[1]!.sha;
  // A file changed relative to BOTH parents → the author edited it during the
  // merge (conflict resolution / evil merge). Changed relative to only one →
  // it came cleanly from one side.
  const fromP1 = (await api<Compare>(`repos/${repo}/compare/${p1}...${sha}`, opts)).files ?? [];
  const fromP2Names = new Set(
    ((await api<Compare>(`repos/${repo}/compare/${p2}...${sha}`, opts)).files ?? []).map(
      (f) => f.filename,
    ),
  );
  const both = fromP1.filter((f) => fromP2Names.has(f.filename));
  if (both.length) {
    const head =
      `[merge ${short}: ${both.length} file(s) changed by BOTH this branch and main — ` +
      'shown below; verify the merge combined them correctly]';
    return [head, ...both.map((f) => formatFile(f, 'merge: branch + main'))].join('\n');
  }
  return `[merge ${short}: clean merge from main — ${fromP1.length} file(s) brought in, skipped]\n`;
}

async function formatPerCommit(
  repo: string,
  chain: Commit[],
  opts: GhCallOptions,
): Promise<string> {
  const parts: string[] = [];
  for (const commit of chain) {
    const short = commit.sha.slice(0, 8);
    if ((commit.parents ?? []).length >= 2) {
      parts.push(await formatMergeNote(repo, commit, short, opts));
      continue;
    }
    const subject = (commit.commit?.message ?? '').split('\n')[0];
    const files = (await api<Commit & Compare>(`repos/${repo}/commits/${commit.sha}`, opts)).files;
    const body = files?.length
      ? files.map((f) => formatFile(f)).join('\n')
      : '(no file changes in this commit)\n';
    parts.push(`--- commit ${short}: ${subject} ---\n${body}`);
  }
  return parts.join('\n');
}

/** Compute the review diff between `baseSha` and `headSha`. `repo` defaults to the git remote. */
export async function computePrDiff(
  baseSha: string,
  headSha: string,
  repo?: string,
  opts: PrDiffOptions = {},
): Promise<string> {
  const warn = opts.warn ?? ((m: string) => console.error(m));
  const resolved = repo ?? (await currentRepo(opts));
  if (!resolved) throw new Error('could not determine repo');

  const compare = await api<Compare>(`repos/${resolved}/compare/${baseSha}...${headSha}`, opts);
  const commits = compare.commits ?? [];
  const files = compare.files ?? [];
  const total = compare.total_commits ?? commits.length;
  const mergeCommits = commits.filter((c) => (c.parents ?? []).length >= 2);

  if (mergeCommits.length && total > commits.length) {
    warn(
      'note: compare truncated (>250 commits) — showing full diff including merged-in main content',
    );
  } else if (mergeCommits.length) {
    const chain = firstParentChain(commits, baseSha, headSha);
    if (chain !== null) return formatPerCommit(resolved, chain, opts);
    warn(
      'note: first-parent chain did not reach base — showing full diff including merged-in main content',
    );
  }
  return formatUnified(files);
}
