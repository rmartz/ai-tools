#!/usr/bin/env node
// Thin CLI wrapper over `createIssue`. Parses args, resolves the repo, and reads
// a file-or-literal body; all create logic stays in the library. Label taxonomy
// and milestone assignment beyond the labels passed here are the coordinator's.
//
// Usage: ai-create-issue --title <title> [--body <body-or-file>]
//                        [--label <label> ...] [--repo <owner/repo>]
import { existsSync, readFileSync } from 'node:fs';
import { createIssue } from '../issue-ops.js';
import { currentRepo } from '../gh-call.js';

interface Args {
  title: string;
  body: string;
  labels: string[];
  repo?: string;
}

function parse(argv: string[]): Args {
  let title = '';
  let bodyArg = '';
  let repo: string | undefined;
  const labels: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--title') title = argv[++i] ?? '';
    else if (a === '--body') bodyArg = argv[++i] ?? '';
    else if (a === '--label') labels.push(argv[++i] ?? '');
    else if (a === '--repo') repo = argv[++i] ?? '';
  }
  if (!title) {
    console.error(
      'usage: ai-create-issue --title <title> [--body <body-or-file>] [--label <label> ...] [--repo <owner/repo>]',
    );
    process.exit(2);
  }
  const body = bodyArg && existsSync(bodyArg) ? readFileSync(bodyArg, 'utf8') : bodyArg;
  return { title, body, labels: labels.filter(Boolean), repo };
}

async function main(): Promise<void> {
  const { title, body, labels, repo: repoArg } = parse(process.argv.slice(2));
  const repo = repoArg || (await currentRepo());
  if (!repo) throw new Error('could not resolve repository (gh repo view failed)');

  const url = await createIssue(repo, { title, body, labels });
  if (url === null) throw new Error(`failed to create issue "${title}" on ${repo}`);
  console.log(url);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
