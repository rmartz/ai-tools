#!/usr/bin/env node
// Thin CLI over `waitForMergeSafety`: poll until the PR's `merge-safety` check
// reaches a final state on its current head commit, then report it.
//
// usage: ai-wait-for-merge-safety [--repo <owner/repo>] [--interval <s>] [--timeout <s>]
//                                 [--no-verdict-grace <s>] [--json] <pr>
//
// Exit codes: 0 passed · 1 timed out · 2 repeated read failure (or bad usage)
//             3 failed · 4 blocked (Update required: update the branch)
//             5 no verdict on the head · 6 PR closed or merged
import { resolveRepoTarget } from '../gh-call.js';
import { waitForMergeSafety, type MergeSafetyOutcome } from '../wait-for-merge-safety.js';

const USAGE =
  'usage: ai-wait-for-merge-safety [--repo <owner/repo>] [--interval <s>] [--timeout <s>] ' +
  '[--no-verdict-grace <s>] [--json] <pr>';

const EXIT_CODES: Record<MergeSafetyOutcome, number> = {
  passed: 0,
  timeout: 1,
  error: 2,
  failed: 3,
  blocked: 4,
  'no-verdict': 5,
  closed: 6,
};

interface Args {
  repo?: string;
  intervalSeconds: number;
  timeoutSeconds: number;
  noVerdictGraceSeconds: number;
  json: boolean;
  pr?: number;
}

function usageError(message: string): never {
  console.error(`${message}\n${USAGE}`);
  process.exit(2);
}

function seconds(flag: string, value: string | undefined): number {
  const n = Number(value);
  if (value === undefined || !Number.isFinite(n) || n < 0)
    usageError(`${flag} needs a number of seconds`);
  return n;
}

function parse(argv: string[]): Args & { pr: number } {
  const args: Args = {
    intervalSeconds: 20,
    timeoutSeconds: 1800,
    noVerdictGraceSeconds: 600,
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--repo') args.repo = argv[++i];
    else if (a === '--interval') args.intervalSeconds = seconds(a, argv[++i]);
    else if (a === '--timeout') args.timeoutSeconds = seconds(a, argv[++i]);
    else if (a === '--no-verdict-grace') args.noVerdictGraceSeconds = seconds(a, argv[++i]);
    else if (a === '--json') args.json = true;
    else if (a !== undefined && /^\d+$/.test(a) && args.pr === undefined) args.pr = Number(a);
    else usageError(`unexpected argument: ${a}`);
  }
  if (args.pr === undefined) usageError('a PR number is required');
  return { ...args, pr: args.pr };
}

async function main(): Promise<void> {
  const args = parse(process.argv.slice(2));
  const repo = await resolveRepoTarget({ repo: args.repo });
  if (!repo)
    throw new Error('could not resolve repository (pass --repo, set GH_REPO, or run in a repo)');

  const result = await waitForMergeSafety(repo, args.pr, {
    intervalMs: args.intervalSeconds * 1000,
    timeoutMs: args.timeoutSeconds * 1000,
    noVerdictGraceMs: args.noVerdictGraceSeconds * 1000,
    onUpdate: args.json ? undefined : (reason) => console.error(`#${args.pr}: ${reason}`),
  });
  console.log(
    args.json
      ? JSON.stringify(result)
      : `PR #${args.pr}: ${result.outcome} — ${result.reason} (${result.elapsedSeconds}s elapsed)`,
  );
  process.exit(EXIT_CODES[result.outcome]);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(2);
});
