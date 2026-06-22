import { ghCall, issueNumber, type GhCallOptions, type Transport } from './gh-call.js';

/**
 * Repo label CRUD plus per-issue add/remove. Used by `@rmartz/bootstrap`
 * (`ensure-labels`) to reconcile the standard roster, and by any agent stamping
 * domain/status labels. Same REST-first + GraphQL-fallback + soft-fail posture
 * as the rest of `gh_issue_ops`.
 */

export interface Label {
  name: string;
  color: string;
  description: string | null;
}

/** GitHub's REST label API rejects a leading `#`; strip it if present. */
function stripHash(color: string): string {
  return color.startsWith('#') ? color.slice(1) : color;
}

/**
 * List all labels on `repo`, or `null` on total failure. The REST primary
 * paginates (one JSON object per line); the GraphQL fallback emits one array.
 * Both shapes are accepted.
 */
export async function listLabels(repo: string, call: GhCallOptions = {}): Promise<Label[] | null> {
  const rest: Transport = {
    argv: [
      'gh',
      'api',
      '--paginate',
      `repos/${repo}/labels?per_page=100`,
      '--jq',
      '.[] | {name: .name, color: .color, description: .description}',
    ],
  };
  const fb: Transport = {
    argv: [
      'gh',
      'label',
      'list',
      '--repo',
      repo,
      '--limit',
      '500',
      '--json',
      'name,color,description',
    ],
  };
  const out = await ghCall(rest, fb, call);
  if (out === null) return null;
  const text = out.trim();
  if (!text) return [];
  if (text.startsWith('[')) {
    try {
      return (JSON.parse(text) as Label[]) || [];
    } catch {
      return null;
    }
  }
  const labels: Label[] = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      labels.push(JSON.parse(t) as Label);
    } catch {
      return null;
    }
  }
  return labels;
}

/** Create label `name`. Returns stdout on success, `null` on failure. */
export async function createLabel(
  repo: string,
  name: string,
  color: string,
  description: string,
  call: GhCallOptions = {},
): Promise<string | null> {
  const c = stripHash(color);
  const rest: Transport = {
    argv: ['gh', 'api', '-X', 'POST', `repos/${repo}/labels`, '--input', '-'],
    stdin: JSON.stringify({ name, color: c, description }),
  };
  const fb: Transport = {
    argv: [
      'gh',
      'label',
      'create',
      name,
      '--repo',
      repo,
      '--color',
      c,
      '--description',
      description,
    ],
  };
  return ghCall(rest, fb, call);
}

export interface UpdateLabelOptions {
  /** Rename the label in place (preserves issue/PR associations). */
  newName?: string;
}

/**
 * Update label `name` with `color`/`description` (and optionally rename it via
 * `newName`). Returns stdout on success, `null` on failure. The name is
 * URL-encoded for the REST path.
 */
export async function updateLabel(
  repo: string,
  name: string,
  color: string,
  description: string,
  opts: UpdateLabelOptions = {},
  call: GhCallOptions = {},
): Promise<string | null> {
  const c = stripHash(color);
  const rename = opts.newName !== undefined && opts.newName !== name;
  const body: Record<string, unknown> = { color: c, description };
  if (rename) body.new_name = opts.newName;
  const rest: Transport = {
    argv: [
      'gh',
      'api',
      '-X',
      'PATCH',
      `repos/${repo}/labels/${encodeURIComponent(name)}`,
      '--input',
      '-',
    ],
    stdin: JSON.stringify(body),
  };
  const fbArgv = [
    'gh',
    'label',
    'edit',
    name,
    '--repo',
    repo,
    '--color',
    c,
    '--description',
    description,
  ];
  if (rename) fbArgv.push('--name', opts.newName!);
  return ghCall(rest, { argv: fbArgv }, call);
}

/** Add labels to an issue/PR (by number or URL). Additive. Returns stdout or `null`. */
export async function addLabels(
  repo: string,
  issue: string | number,
  labels: string[],
  call: GhCallOptions = {},
): Promise<string | null> {
  const number = issueNumber(issue);
  if (number === null || !labels.length) return null;
  const rest: Transport = {
    argv: ['gh', 'api', '-X', 'POST', `repos/${repo}/issues/${number}/labels`, '--input', '-'],
    stdin: JSON.stringify({ labels }),
  };
  const fb: Transport = {
    argv: ['gh', 'issue', 'edit', number, '--repo', repo, '--add-label', labels.join(',')],
  };
  const out = await ghCall(rest, fb, call);
  return out !== null ? out.trim() : null;
}

/** Remove a single label from an issue/PR (by number or URL). Returns stdout or `null`. */
export async function removeLabel(
  repo: string,
  issue: string | number,
  label: string,
  call: GhCallOptions = {},
): Promise<string | null> {
  const number = issueNumber(issue);
  if (number === null) return null;
  const rest: Transport = {
    argv: [
      'gh',
      'api',
      '-X',
      'DELETE',
      `repos/${repo}/issues/${number}/labels/${encodeURIComponent(label)}`,
    ],
  };
  const fb: Transport = {
    argv: ['gh', 'issue', 'edit', number, '--repo', repo, '--remove-label', label],
  };
  const out = await ghCall(rest, fb, call);
  return out !== null ? out.trim() : null;
}
