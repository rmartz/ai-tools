import { ghCall, currentRepo, type GhCallOptions } from './gh-call.js';

/**
 * Gather open issues, milestones, and PR data for the `/status` and
 * `/implement-all` skills. TS port of dotfiles' `repo_status.py` (keys are
 * camelCase TS-native, not the Python snake_case).
 *
 * `openPrs` exposes each PR's head branch and the same-repo issue numbers it
 * closes, resolved in order: (1) `closingIssuesReferences` filtered to same-repo
 * entries — a PR that closes only cross-repo issues yields `[]`, intentionally
 * suppressing the fallbacks; (2) the `feat/issue-<N>-*` branch convention;
 * (3) `Closes/Fixes/Resolves #N` in the PR body. This lets `/implement-all`
 * identify resume targets without re-fetching PR data.
 */

export interface RepoStatusMilestone {
  title: string;
  number: number;
  openIssues: number;
}

export interface RepoStatusIssue {
  number: number;
  title: string;
  milestone: string | null;
  labels: string[];
  assignees: string[];
  deps: number[];
}

export interface RepoStatusPr {
  number: number;
  headRefName: string;
  issueNumbers: number[];
}

export interface RepoStatus {
  milestones: RepoStatusMilestone[];
  issues: RepoStatusIssue[];
  openPrNumbers: number[];
  openPrs: RepoStatusPr[];
}

const DEP_RE = /(?:depends on|blocked by|requires)\s+#(\d+)/gi;
// `/implement` creates branches as `feat/issue-<N>-<slug>` (slug optional).
const BRANCH_ISSUE_RE = /^feat\/issue-(\d+)(?:-|$)/;
const PR_BODY_CLOSING_RE = /(?:closes|fixes|resolves)\s+#(\d+)/gi;

async function run<T>(argv: string[], opts: GhCallOptions): Promise<T> {
  const out = await ghCall({ argv }, null, opts);
  if (out === null) throw new Error(`${argv.join(' ')} failed`);
  try {
    return JSON.parse(out) as T;
  } catch (e) {
    throw new Error(`could not parse output of ${argv.join(' ')} — ${String(e)}`);
  }
}

function matchAll(re: RegExp, text: string): number[] {
  return [...text.matchAll(re)].map((m) => Number(m[1]));
}

interface RawIssue {
  number: number;
  title: string;
  body?: string;
  labels?: { name: string }[];
  milestone?: { title: string } | null;
  assignees?: { login: string }[];
}

interface RawPr {
  number: number;
  headRefName?: string;
  body?: string;
  closingIssuesReferences?: { number: number; repository?: { nameWithOwner?: string } }[];
}

function resolveIssueNumbers(p: RawPr, repo: string): number[] {
  const closing = p.closingIssuesReferences ?? [];
  if (closing.length) {
    return closing.filter((r) => r.repository?.nameWithOwner === repo).map((r) => r.number);
  }
  const bm = BRANCH_ISSUE_RE.exec(p.headRefName ?? '');
  if (bm) return [Number(bm[1])];
  return matchAll(PR_BODY_CLOSING_RE, p.body ?? '');
}

/** Fetch and structure the repo's open issues, milestones, and PRs. */
export async function gatherRepoStatus(opts: GhCallOptions = {}): Promise<RepoStatus> {
  const repo = await currentRepo(opts);
  if (!repo) throw new Error('could not determine repo');

  const [rawIssues, rawMilestones, rawPrs] = await Promise.all([
    run<RawIssue[]>(
      [
        'gh',
        'issue',
        'list',
        '--state',
        'open',
        '--limit',
        '1000',
        '--json',
        'number,title,body,labels,milestone,assignees',
      ],
      opts,
    ),
    run<{ title: string; number: number; open_issues: number }[]>(
      ['gh', 'api', `repos/${repo}/milestones`],
      opts,
    ),
    run<RawPr[]>(
      [
        'gh',
        'pr',
        'list',
        '--state',
        'open',
        '--limit',
        '1000',
        '--json',
        'number,headRefName,closingIssuesReferences,body',
      ],
      opts,
    ),
  ]);

  const issues: RepoStatusIssue[] = [];
  for (const i of rawIssues) {
    const labels = (i.labels ?? []).map((l) => l.name);
    if (labels.includes('blocked') || labels.includes('manual')) continue;
    issues.push({
      number: i.number,
      title: i.title,
      milestone: i.milestone?.title ?? null,
      labels,
      assignees: (i.assignees ?? []).map((a) => a.login),
      deps: matchAll(DEP_RE, i.body ?? ''),
    });
  }

  const milestones: RepoStatusMilestone[] = rawMilestones.map((m) => ({
    title: m.title,
    number: m.number,
    openIssues: m.open_issues,
  }));

  return {
    milestones,
    issues,
    openPrNumbers: rawPrs.map((p) => p.number),
    openPrs: rawPrs.map((p) => ({
      number: p.number,
      headRefName: p.headRefName ?? '',
      issueNumbers: resolveIssueNumbers(p, repo),
    })),
  };
}
