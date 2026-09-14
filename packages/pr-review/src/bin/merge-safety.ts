#!/usr/bin/env node
// Thin CLI over the merge-safety predicate. Two modes:
//   evaluate  — gather facts for one PR, post its `merge-safety` check-run, and
//               reconcile the `update required` / `merge conflict` labels.
//   invalidate — (push-to-base fan-out) flip every OTHER open PR's check to
//               pending and dispatch its own evaluate run, so a moved base holds
//               auto-merge until each PR re-clears against the new base.
// All judgment lives in the library; this only parses args and talks to `gh`.
import { ghCall, resolveRepoTarget, addLabels, removeLabel } from '@rmartz/github';
import { evaluateMergeSafety } from '../merge-safety.js';
import { gatherMergeSafetyFacts, makeGitRunner, type PrMergeMeta } from '../merge-safety-facts.js';

const CHECK_NAME = 'merge-safety';

interface Args {
  mode: 'evaluate' | 'invalidate';
  pr?: number;
  exclude?: number;
  repo?: string;
  baseRef: string;
  cwd?: string;
}

function usage(): never {
  console.error(
    'usage: ai-merge-safety evaluate --pr <n> [--repo <o/r>] [--base <ref>] [--cwd <path>]\n' +
      '       ai-merge-safety invalidate [--exclude <n>] [--repo <o/r>] [--cwd <path>]',
  );
  process.exit(2);
}

function parse(argv: string[]): Args {
  const mode = argv[0];
  if (mode !== 'evaluate' && mode !== 'invalidate') usage();
  const args: Args = { mode, baseRef: 'origin/main' };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--pr') args.pr = Number(argv[++i]);
    else if (a === '--exclude') args.exclude = Number(argv[++i]);
    else if (a === '--repo') args.repo = argv[++i];
    else if (a === '--base') args.baseRef = argv[++i] ?? args.baseRef;
    else if (a === '--cwd') args.cwd = argv[++i];
    else usage();
  }
  if (mode === 'evaluate' && !args.pr) usage();
  return args;
}

async function ghJson<T>(argv: string[], cwd?: string): Promise<T | null> {
  const out = await ghCall({ argv }, null, { cwd });
  if (out === null) return null;
  try {
    return JSON.parse(out) as T;
  } catch {
    return null;
  }
}

/** Post (create) a check-run on a head SHA. `conclusion` omitted → pending. */
async function postCheck(
  repo: string,
  headSha: string,
  output: { title: string; summary: string },
  conclusion: 'success' | 'failure' | null,
  cwd?: string,
): Promise<void> {
  const payload = {
    name: CHECK_NAME,
    head_sha: headSha,
    status: conclusion ? 'completed' : 'in_progress',
    ...(conclusion ? { conclusion, completed_at: new Date().toISOString() } : {}),
    output,
  };
  await ghCall(
    {
      argv: ['gh', 'api', '-X', 'POST', `repos/${repo}/check-runs`, '--input', '-'],
      stdin: JSON.stringify(payload),
    },
    null,
    { cwd },
  );
}

interface PrView {
  number: number;
  headRefOid: string;
  title: string;
  labels: { name: string }[];
  mergeable: string;
}

/** Re-read a PR until `mergeable` settles off UNKNOWN (GitHub computes it lazily). */
async function fetchPrView(repo: string, pr: number, cwd?: string): Promise<PrView | null> {
  const fields = 'number,headRefOid,title,labels,mergeable';
  for (let attempt = 0; attempt < 3; attempt++) {
    const view = await ghJson<PrView>(
      ['gh', 'pr', 'view', String(pr), '--repo', repo, '--json', fields],
      cwd,
    );
    if (!view) return null;
    if (view.mergeable !== 'UNKNOWN' || attempt === 2) return view;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return null;
}

async function reconcileLabels(
  repo: string,
  pr: number,
  add: readonly string[],
  remove: readonly string[],
  cwd?: string,
): Promise<void> {
  if (add.length) await addLabels(repo, pr, [...add], { cwd });
  for (const label of remove) await removeLabel(repo, pr, label, { cwd });
}

async function runEvaluate(repo: string, pr: number, args: Args): Promise<void> {
  const view = await fetchPrView(repo, pr, args.cwd);
  if (!view) throw new Error(`could not read PR #${pr}`);
  const meta: PrMergeMeta = {
    headSha: view.headRefOid,
    title: view.title,
    labels: view.labels.map((l) => l.name),
    mergeable: view.mergeable,
  };

  try {
    const facts = await gatherMergeSafetyFacts(meta, {
      baseRef: args.baseRef,
      git: makeGitRunner(args.cwd),
    });
    const decision = evaluateMergeSafety(facts);
    const detail = decision.reasons.length
      ? decision.reasons.map((r) => `- ${r}`).join('\n')
      : decision.summary;
    await postCheck(
      repo,
      meta.headSha,
      { title: 'Merge safety', summary: `${decision.summary}\n\n${detail}` },
      decision.conclusion,
      args.cwd,
    );
    await reconcileLabels(repo, pr, decision.labels.add, decision.labels.remove, args.cwd);
    console.log(`#${pr}: ${decision.conclusion} — ${decision.summary}`);
  } catch (err) {
    // Ungatherable → fail safe: never leave a stale green that could auto-merge.
    const msg = err instanceof Error ? err.message : String(err);
    await postCheck(
      repo,
      meta.headSha,
      { title: 'Merge safety', summary: `Could not evaluate merge safety: ${msg}` },
      'failure',
      args.cwd,
    );
    console.error(`#${pr}: failure — could not evaluate: ${msg}`);
    process.exitCode = 1;
  }
}

async function runInvalidate(repo: string, args: Args): Promise<void> {
  const prs = await ghJson<{ number: number; headRefOid: string }[]>(
    [
      'gh',
      'pr',
      'list',
      '--repo',
      repo,
      '--state',
      'open',
      '--base',
      'main',
      '--json',
      'number,headRefOid',
    ],
    args.cwd,
  );
  if (!prs) throw new Error('could not list open PRs');
  for (const pr of prs) {
    if (pr.number === args.exclude) continue;
    // 1) Flip to pending immediately — a pending required check blocks auto-merge.
    await postCheck(
      repo,
      pr.headRefOid,
      { title: 'Merge safety', summary: 'Re-evaluating against the updated base…' },
      null,
      args.cwd,
    );
    // 2) Dispatch this PR's own evaluate run; it resolves the check against the new base.
    await ghCall(
      {
        argv: [
          'gh',
          'workflow',
          'run',
          'merge-safety.yml',
          '--repo',
          repo,
          '-f',
          `pr=${pr.number}`,
        ],
      },
      null,
      { cwd: args.cwd },
    );
    console.log(`#${pr.number}: invalidated (pending) + evaluate dispatched`);
  }
}

async function main(): Promise<void> {
  const args = parse(process.argv.slice(2));
  const repo = await resolveRepoTarget({ repo: args.repo, cwd: args.cwd });
  if (!repo) {
    console.error('error: could not resolve target repo (pass --repo <owner/repo>)');
    process.exit(2);
  }
  if (args.mode === 'evaluate') await runEvaluate(repo, args.pr as number, args);
  else await runInvalidate(repo, args);
}

void main();
