#!/usr/bin/env node
// Thin CLI: append a (signed) comment to an existing discussion by number — used
// by /discuss-curate to post a synthesized best-answer. The synthesis (judgment)
// is the agent's; this only resolves the discussion id and posts the comment.
import { readFileSync } from 'node:fs';
import { getDiscussion, addComment } from '../discussions.js';
import { signComment } from '../discuss-helpers.js';

const DEFAULT_REPO = 'rmartz/ai';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let repo = DEFAULT_REPO;
  let model: string | undefined;
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--repo') repo = argv[++i] ?? repo;
    else if (a === '--model') model = argv[++i];
    else if (a !== undefined) positional.push(a);
  }
  const [numberArg, bodyFile] = positional;
  const number = Number(numberArg);
  if (!numberArg || Number.isNaN(number) || !bodyFile) {
    console.error(
      'usage: ai-discussion-comment <number> <body-file> [--repo owner/repo] [--model <model>]',
    );
    process.exit(2);
  }
  const discussion = await getDiscussion(repo, number);
  if (discussion === null) {
    console.error(`discussion #${number} not found in ${repo}`);
    process.exit(1);
  }
  const comment = await addComment(
    discussion.id,
    signComment(readFileSync(bodyFile, 'utf8'), model),
  );
  console.log(comment.url);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
