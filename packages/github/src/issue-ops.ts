import { ghCall, issueNumber, type GhCallOptions, type Transport } from './gh-call.js';

/**
 * REST-first GitHub issue operations: find, create, comment, assign. The shared
 * client `@rmartz/reporting` (tracking ledgers) and most of the toolkit build on.
 * Each op prefers REST and falls back to the GraphQL `gh` subcommand on
 * rate-limit, and soft-fails to `null` rather than throwing. TS port of dotfiles'
 * `gh_issue_ops.py`.
 */

export interface FindOpenIssueOptions {
  label?: string;
  titleEquals?: string;
  titlePrefix?: string;
  titleContains?: string;
}

/**
 * Return the URL of the first open issue matching the title criteria (exact,
 * prefix, or substring) and optional label, or `null`. The match is applied
 * client-side, so it is exact regardless of GitHub's fuzzy server-side search.
 * PRs are excluded.
 */
export async function findOpenIssue(
  repo: string,
  opts: FindOpenIssueOptions = {},
  call: GhCallOptions = {},
): Promise<string | null> {
  let path = `repos/${repo}/issues?state=open&per_page=100`;
  if (opts.label) path += `&labels=${encodeURIComponent(opts.label)}`;
  const rest: Transport = {
    argv: [
      'gh',
      'api',
      path,
      '--jq',
      '[.[] | select(.pull_request == null) | {title: .title, url: .html_url}]',
    ],
  };
  const fbArgv = ['gh', 'issue', 'list', '--repo', repo, '--state', 'open', '--limit', '100'];
  if (opts.label) fbArgv.push('--label', opts.label);
  const search = opts.titleEquals ?? opts.titlePrefix ?? opts.titleContains;
  if (search) fbArgv.push('--search', `${search} in:title`);
  fbArgv.push('--json', 'title,url', '--jq', '[.[] | {title, url}]');

  const out = await ghCall(rest, { argv: fbArgv }, call);
  if (out === null) return null;
  let issues: { title?: string; url?: string }[];
  try {
    issues = (JSON.parse(out) as typeof issues) || [];
  } catch {
    return null;
  }
  for (const issue of issues) {
    const title = issue.title ?? '';
    if (opts.titleEquals !== undefined && title !== opts.titleEquals) continue;
    if (opts.titlePrefix !== undefined && !title.startsWith(opts.titlePrefix)) continue;
    if (opts.titleContains !== undefined && !title.includes(opts.titleContains)) continue;
    if (issue.url) return issue.url;
  }
  return null;
}

export interface CreateIssueOptions {
  title: string;
  body: string;
  labels?: string[];
}

/** Create an issue. Returns the new issue's URL, or `null` on failure. */
export async function createIssue(
  repo: string,
  opts: CreateIssueOptions,
  call: GhCallOptions = {},
): Promise<string | null> {
  const payload: Record<string, unknown> = { title: opts.title, body: opts.body };
  if (opts.labels?.length) payload.labels = opts.labels;
  const rest: Transport = {
    argv: ['gh', 'api', '-X', 'POST', `repos/${repo}/issues`, '--input', '-', '--jq', '.html_url'],
    stdin: JSON.stringify(payload),
  };
  const fbArgv = [
    'gh',
    'issue',
    'create',
    '--repo',
    repo,
    '--title',
    opts.title,
    '--body-file',
    '-',
  ];
  if (opts.labels?.length) fbArgv.push('--label', opts.labels.join(','));
  const out = await ghCall(rest, { argv: fbArgv, stdin: opts.body }, call);
  return out ? out.trim() : null;
}

/**
 * Comment on an issue (by number or URL). Returns the comment URL, or `null`.
 * Named `addIssueComment` to avoid colliding with the Discussions `addComment`.
 */
export async function addIssueComment(
  repo: string,
  issue: string | number,
  body: string,
  call: GhCallOptions = {},
): Promise<string | null> {
  const number = issueNumber(issue);
  if (number === null) return null;
  const rest: Transport = {
    argv: [
      'gh',
      'api',
      '-X',
      'POST',
      `repos/${repo}/issues/${number}/comments`,
      '--input',
      '-',
      '--jq',
      '.html_url',
    ],
    stdin: JSON.stringify({ body }),
  };
  const fb: Transport = {
    argv: ['gh', 'issue', 'comment', number, '--repo', repo, '--body-file', '-'],
    stdin: body,
  };
  const out = await ghCall(rest, fb, call);
  return out ? out.trim() : null;
}

/**
 * Add assignees to an issue (by number or URL). Returns stdout, or `null` on
 * failure, an empty list, or an unparseable reference.
 */
export async function addAssignees(
  repo: string,
  issue: string | number,
  assignees: string[],
  call: GhCallOptions = {},
): Promise<string | null> {
  if (!assignees.length) return null;
  const number = issueNumber(issue);
  if (number === null) return null;
  const rest: Transport = {
    argv: ['gh', 'api', '-X', 'POST', `repos/${repo}/issues/${number}/assignees`, '--input', '-'],
    stdin: JSON.stringify({ assignees }),
  };
  const fb: Transport = {
    argv: ['gh', 'issue', 'edit', number, '--repo', repo, '--add-assignee', assignees.join(',')],
  };
  const out = await ghCall(rest, fb, call);
  return out !== null ? out.trim() : null;
}
