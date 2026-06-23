#!/usr/bin/env node
// Thin CLI wrapper over `postPrComment`. Handles arg parsing, the file-vs-literal
// body, and body-file cleanup; all posting logic stays in the library.
//
// The `--skill` flag (hidden skill-meta marker) arrives with @rmartz/agent-runtime
// skill-meta (#4); the library already accepts a pre-rendered `skillMeta`.
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { postPrComment } from '../pr-comment.js';
import { currentRepo } from '../gh-call.js';

interface Args {
  model: string;
  keepBody: boolean;
  pr: string;
  bodyArg: string;
}

function parse(argv: string[]): Args {
  let model = '';
  let keepBody = false;
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--model') model = argv[++i] ?? '';
    else if (a === '--keep-body') keepBody = true;
    else if (a !== undefined) positional.push(a);
  }
  const [pr, bodyArg] = positional;
  if (!model || !pr || bodyArg === undefined) {
    console.error('usage: ai-pr-comment --model <model> [--keep-body] <pr> <body-or-file>');
    process.exit(2);
  }
  return { model, keepBody, pr, bodyArg };
}

async function main(): Promise<void> {
  const { model, keepBody, pr, bodyArg } = parse(process.argv.slice(2));
  const isFile = existsSync(bodyArg);
  const body = isFile ? readFileSync(bodyArg, 'utf8') : bodyArg;

  const repo = await currentRepo();
  if (!repo) throw new Error('could not resolve repository (gh repo view failed)');

  const url = await postPrComment(repo, pr, body, { model });
  if (url === null) {
    throw new Error(`failed to post comment on PR #${pr} (body file retained for retry)`);
  }
  // Remove the body file only after a confirmed post, so a failure leaves it for retry.
  if (isFile && !keepBody) {
    try {
      unlinkSync(bodyArg);
    } catch {
      /* best-effort */
    }
  }
  console.log(`PR #${pr}: comment posted. ${url}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
