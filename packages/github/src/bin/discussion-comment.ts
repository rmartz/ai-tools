#!/usr/bin/env node
// Thin CLI: append a (signed) comment to an existing discussion by number — used
// by /discuss-curate to post a synthesized best-answer. The synthesis (judgment)
// is the agent's; this only resolves the discussion id and posts the comment.
import { readFileSync } from 'node:fs';
import { getDiscussion, addComment } from '../discussions.js';
import { resolveSignatureContext, type SignatureFlags } from '../discuss-signature.js';
import { signComment, parseDiscussionRef } from '../discuss-helpers.js';

const DEFAULT_REPO = 'rmartz/ai';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let defaultRepo = DEFAULT_REPO;
  const flags: SignatureFlags = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--repo') defaultRepo = argv[++i] ?? defaultRepo;
    else if (a === '--model') flags.model = argv[++i];
    else if (a === '--project') flags.project = argv[++i];
    else if (a === '--commit') flags.commit = argv[++i];
    else if (a !== undefined) positional.push(a);
  }
  const [refArg, bodyFile] = positional;
  const target = refArg ? parseDiscussionRef(refArg, defaultRepo) : null;
  if (!target || !bodyFile) {
    console.error(
      'usage: ai-discussion-comment <number|discussion-url> <body-file> [--repo owner/repo] [--model <model>] [--project owner/repo] [--commit <sha>]',
    );
    process.exit(2);
  }
  const discussion = await getDiscussion(target.repo, target.number);
  if (discussion === null) {
    console.error(`discussion #${target.number} not found in ${target.repo}`);
    process.exit(1);
  }
  const signature = await resolveSignatureContext(flags);
  const comment = await addComment(
    discussion.id,
    signComment(readFileSync(bodyFile, 'utf8'), signature),
  );
  console.log(comment.url);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
