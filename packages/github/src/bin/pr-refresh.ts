#!/usr/bin/env node
// Thin CLI wrapper over `refreshPr`: parse args, print the outcome. Exit codes let
// a script branch without parsing: 0 for any settled outcome, 1 for `failed`, 3 for
// `escalate` (a human has to look).
import { refreshPr } from '../pr-refresh.js';
import { resolveRepoTarget } from '../gh-call.js';

interface Args {
  repo?: string;
  force: boolean;
  json: boolean;
  pr: string;
}

const USAGE = 'usage: ai-pr-refresh [--repo <owner/repo>] [--force] [--json] <pr>';

function parse(argv: string[]): Args {
  let repo: string | undefined;
  let force = false;
  let json = false;
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--repo') repo = argv[++i];
    else if (a === '--force') force = true;
    else if (a === '--json') json = true;
    else if (a !== undefined) positional.push(a);
  }
  const [pr] = positional;
  if (!pr || positional.length > 1) {
    console.error(USAGE);
    process.exit(2);
  }
  return { repo, force, json, pr };
}

async function main(): Promise<void> {
  const { repo: repoArg, force, json, pr } = parse(process.argv.slice(2));
  const repo = await resolveRepoTarget({ repo: repoArg });
  if (!repo)
    throw new Error('could not resolve repository (pass --repo, set GH_REPO, or run in a repo)');

  const result = await refreshPr(repo, pr, { force });
  console.log(json ? JSON.stringify(result) : `PR #${pr}: ${result.outcome} — ${result.reason}`);
  if (result.outcome === 'failed') process.exit(1);
  if (result.outcome === 'escalate') process.exit(3);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
