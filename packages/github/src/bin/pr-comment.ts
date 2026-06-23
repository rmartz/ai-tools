#!/usr/bin/env node
// Thin CLI wrapper over `postPrComment`. Handles arg parsing, the file-vs-literal
// body, and body-file cleanup; all posting logic stays in the library.
//
// `--skill-meta <marker>` accepts a pre-rendered hidden skill-meta marker and
// passes it through to `postPrComment`. The marker is *rendered* with
// `renderSkillMeta` from @rmartz/agent-runtime — but resolving its fields
// (PR-head, the dispatcher's skill-file hash, the coordinator transcript/start
// time) is the dispatcher's job (PR Shepherd), since those are coordinator- and
// harness-specific. So the CLI takes the rendered string rather than auto-resolving.
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { postPrComment } from '../pr-comment.js';
import { currentRepo } from '../gh-call.js';

interface Args {
  model: string;
  keepBody: boolean;
  skillMeta?: string;
  pr: string;
  bodyArg: string;
}

function parse(argv: string[]): Args {
  let model = '';
  let keepBody = false;
  let skillMeta: string | undefined;
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--model') model = argv[++i] ?? '';
    else if (a === '--skill-meta') skillMeta = argv[++i] ?? '';
    else if (a === '--keep-body') keepBody = true;
    else if (a !== undefined) positional.push(a);
  }
  const [pr, bodyArg] = positional;
  if (!model || !pr || bodyArg === undefined) {
    console.error(
      'usage: ai-pr-comment --model <model> [--skill-meta <marker>] [--keep-body] <pr> <body-or-file>',
    );
    process.exit(2);
  }
  return { model, keepBody, skillMeta, pr, bodyArg };
}

async function main(): Promise<void> {
  const { model, keepBody, skillMeta, pr, bodyArg } = parse(process.argv.slice(2));
  const isFile = existsSync(bodyArg);
  const body = isFile ? readFileSync(bodyArg, 'utf8') : bodyArg;

  const repo = await currentRepo();
  if (!repo) throw new Error('could not resolve repository (gh repo view failed)');

  const url = await postPrComment(repo, pr, body, { model, skillMeta });
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
