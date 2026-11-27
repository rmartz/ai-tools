#!/usr/bin/env node
// Thin CLI over `waitForMergeSafety`: poll until the PR's `merge-safety` check
// reaches a final state on its current head commit, then report it.
//
// usage: ai-wait-for-merge-safety [--repo <owner/repo>] [--interval <s>] [--timeout <s>]
//                                 [--no-verdict-grace <s>] [--previous-head <sha>]
//                                 [--json] <pr>
//
// Exit codes: 0 passed · 1 timed out · 2 repeated read failure (or bad usage)
//             3 failed · 4 blocked (Update required: update the branch)
//             5 no verdict on the head · 6 PR merged · 7 PR closed unmerged
import { resolveRepoTarget } from '../gh-call.js';
import {
  DEFAULT_MERGE_SAFETY_INTERVAL_MS,
  DEFAULT_MERGE_SAFETY_TIMEOUT_MS,
  DEFAULT_NO_VERDICT_GRACE_MS,
  waitForMergeSafety,
  type MergeSafetyFinalOutcome,
} from '../wait-for-merge-safety.js';

const USAGE =
  'usage: ai-wait-for-merge-safety [--repo <owner/repo>] [--interval <s>] [--timeout <s>] ' +
  '[--no-verdict-grace <s>] [--previous-head <sha>] [--json] <pr>';

const EXIT_CODES: Record<MergeSafetyFinalOutcome, number> = {
  passed: 0,
  timeout: 1,
  error: 2,
  failed: 3,
  blocked: 4,
  'no-verdict': 5,
  merged: 6,
  closed: 7,
};

interface Args {
  repo?: string;
  intervalMs: number;
  timeoutMs: number;
  noVerdictGraceMs: number;
  previousHead?: string;
  json: boolean;
  pr?: number;
}

function usageError(message: string): never {
  console.error(`${message}\n${USAGE}`);
  process.exit(2);
}

/** A flag's value in milliseconds; `--interval` must be positive so polls never spin. */
function millis(flag: string, value: string | undefined, positive = false): number {
  const n = Number(value);
  if (value === undefined || value.trim() === '' || !Number.isFinite(n) || n < 0)
    usageError(`${flag} needs a number of seconds`);
  if (positive && n === 0) usageError(`${flag} must be more than 0 seconds`);
  return n * 1000;
}

function text(flag: string, value: string | undefined): string {
  if (value === undefined || value === '' || value.startsWith('--'))
    usageError(`${flag} needs a value`);
  return value;
}

/** A commit SHA, full or abbreviated to at least 7 hex characters. */
function sha(flag: string, value: string | undefined): string {
  const v = text(flag, value).toLowerCase();
  if (!/^[0-9a-f]{7,40}$/.test(v))
    usageError(`${flag} needs a commit SHA (7 to 40 hex characters)`);
  return v;
}

function parse(argv: string[]): Args & { pr: number } {
  const args: Args = {
    intervalMs: DEFAULT_MERGE_SAFETY_INTERVAL_MS,
    timeoutMs: DEFAULT_MERGE_SAFETY_TIMEOUT_MS,
    noVerdictGraceMs: DEFAULT_NO_VERDICT_GRACE_MS,
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--repo') args.repo = text(a, argv[++i]);
    else if (a === '--interval') args.intervalMs = millis(a, argv[++i], true);
    else if (a === '--timeout') args.timeoutMs = millis(a, argv[++i]);
    else if (a === '--no-verdict-grace') args.noVerdictGraceMs = millis(a, argv[++i]);
    else if (a === '--previous-head') args.previousHead = sha(a, argv[++i]);
    else if (a === '--json') args.json = true;
    else if (a !== undefined && /^\d+$/.test(a) && args.pr === undefined) args.pr = Number(a);
    else usageError(`unexpected argument: ${a}`);
  }
  if (args.pr === undefined) usageError('a PR number is required');
  return { ...args, pr: args.pr };
}

async function main(): Promise<void> {
  const { repo: repoArg, json, pr, ...opts } = parse(process.argv.slice(2));
  const repo = await resolveRepoTarget({ repo: repoArg });
  if (!repo)
    throw new Error('could not resolve repository (pass --repo, set GH_REPO, or run in a repo)');

  const result = await waitForMergeSafety(repo, pr, {
    ...opts,
    onUpdate: json ? undefined : (reason) => console.error(`#${pr}: ${reason}`),
  });
  console.log(
    json
      ? JSON.stringify(result)
      : `PR #${pr}: ${result.outcome} — ${result.reason} (${result.elapsedSeconds}s elapsed)`,
  );
  process.exit(EXIT_CODES[result.outcome]);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(2);
});
