#!/usr/bin/env node
// Thin CLI over `waitForDependabot`: poll until Dependabot answers a rebase/recreate
// request on the given PR(s), or the request is detected as missed.
//
// usage: ai-wait-for-dependabot [--repo <owner/repo>] [--all] [--interval <s>]
//                               [--timeout <s>] [--ack-grace <s>] <pr> [<pr> ...]
//
// Exit codes: 0 answered · 1 timed out · 2 repeated read failure (or bad usage)
//             3 missed (Dependabot never acknowledged a request)
import { resolveRepoTarget } from '../gh-call.js';
import { waitForDependabot, type WaitOutcome } from '../wait-for-dependabot.js';

const USAGE =
  'usage: ai-wait-for-dependabot [--repo <owner/repo>] [--all] [--interval <s>] ' +
  '[--timeout <s>] [--ack-grace <s>] <pr> [<pr> ...]';

const EXIT_CODES: Record<WaitOutcome, number> = { answered: 0, timeout: 1, error: 2, missed: 3 };

interface Args {
  repo?: string;
  all: boolean;
  intervalSeconds: number;
  timeoutSeconds: number;
  ackGraceSeconds?: number;
  prs: number[];
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

function parse(argv: string[]): Args {
  const args: Args = { all: false, intervalSeconds: 30, timeoutSeconds: 3600, prs: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--repo') args.repo = argv[++i];
    else if (a === '--all') args.all = true;
    else if (a === '--interval') args.intervalSeconds = seconds(a, argv[++i]);
    else if (a === '--timeout') args.timeoutSeconds = seconds(a, argv[++i]);
    else if (a === '--ack-grace') args.ackGraceSeconds = seconds(a, argv[++i]);
    else if (a !== undefined && /^\d+$/.test(a)) args.prs.push(Number(a));
    else usageError(`unexpected argument: ${a}`);
  }
  if (args.prs.length === 0) usageError('at least one PR number is required');
  return args;
}

async function main(): Promise<void> {
  const args = parse(process.argv.slice(2));
  const repo = await resolveRepoTarget({ repo: args.repo });
  if (!repo) throw new Error('could not resolve repository (pass --repo or set GH_REPO)');

  const result = await waitForDependabot(repo, args.prs, {
    all: args.all,
    intervalMs: args.intervalSeconds * 1000,
    timeoutMs: args.timeoutSeconds * 1000,
    ackGraceMs: args.ackGraceSeconds === undefined ? undefined : args.ackGraceSeconds * 1000,
    onResolved: (r) =>
      console.log(`#${r.pr}: ${r.status} — ${r.reason} (${r.elapsedSeconds}s elapsed)`),
  });

  const pending = result.pending.map((pr) => `#${pr}`).join(' ');
  if (result.outcome === 'timeout') {
    console.error(`timeout: no Dependabot response within ${args.timeoutSeconds}s on ${pending}`);
  } else if (result.outcome === 'error') {
    console.error(`error: could not read Dependabot state for ${repo} (${pending}) repeatedly`);
  } else if (result.outcome === 'missed') {
    console.error('missed: Dependabot dropped a request — re-request it or check the PR');
  }
  process.exit(EXIT_CODES[result.outcome]);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(2);
});
