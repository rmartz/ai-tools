#!/usr/bin/env node
// Thin CLI wrapper over `createPullRequest`. Parses args, resolves the repo, and
// reads a file-or-literal body; all create logic stays in the library. The PR
// lifecycle beyond the raw create (draft promotion, labels, milestone) is the
// caller's/coordinator's, not this CLI's — it opens the PR and prints its URL.
//
// Usage: ai-create-pr --base <base> --head <head> --title <title>
//                     [--body <body-or-file>] [--draft] [--repo <owner/repo>]
import { existsSync, readFileSync } from 'node:fs';
import { createPullRequest } from '../pr-ops.js';
import { currentRepo } from '../gh-call.js';

interface Args {
  base: string;
  head: string;
  title: string;
  body: string;
  draft: boolean;
  repo?: string;
}

function parse(argv: string[]): Args {
  let base = '';
  let head = '';
  let title = '';
  let bodyArg = '';
  let draft = false;
  let repo: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--base') base = argv[++i] ?? '';
    else if (a === '--head') head = argv[++i] ?? '';
    else if (a === '--title') title = argv[++i] ?? '';
    else if (a === '--body') bodyArg = argv[++i] ?? '';
    else if (a === '--repo') repo = argv[++i] ?? '';
    else if (a === '--draft') draft = true;
  }
  if (!base || !head || !title) {
    console.error(
      'usage: ai-create-pr --base <base> --head <head> --title <title> [--body <body-or-file>] [--draft] [--repo <owner/repo>]',
    );
    process.exit(2);
  }
  const body = bodyArg && existsSync(bodyArg) ? readFileSync(bodyArg, 'utf8') : bodyArg;
  return { base, head, title, body, draft, repo };
}

async function main(): Promise<void> {
  const { base, head, title, body, draft, repo: repoArg } = parse(process.argv.slice(2));
  const repo = repoArg || (await currentRepo());
  if (!repo) throw new Error('could not resolve repository (gh repo view failed)');

  const url = await createPullRequest(repo, { base, head, title, body, draft });
  if (url === null) throw new Error(`failed to open PR for ${head} → ${base} on ${repo}`);
  console.log(url);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
