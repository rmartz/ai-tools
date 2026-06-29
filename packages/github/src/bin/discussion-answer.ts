#!/usr/bin/env node
// Thin CLI: mark a discussion comment as the accepted answer (the mark step of
// the /discuss-curate skill). The judgment of *which* comment is best stays with
// the agent; this only performs the mechanical markDiscussionCommentAsAnswer.
import { markAnswer } from '../discussions.js';

async function main(): Promise<void> {
  const [commentId] = process.argv.slice(2);
  if (!commentId) {
    console.error('usage: ai-discussion-answer <comment-node-id>');
    process.exit(2);
  }
  await markAnswer(commentId);
  console.log(`✓ marked ${commentId} as the answer`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
