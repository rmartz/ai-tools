#!/usr/bin/env node
// Thin CLI wrapper over `dismissThread`. Posts a reply to a review thread, then
// resolves it (reply-before-resolve). On a partial failure (reply posted, resolve
// failed) it prints the recovery hint instead of re-posting.
import { dismissThread } from '../threads.js';

async function main(): Promise<void> {
  const [threadId, ...rest] = process.argv.slice(2);
  if (!threadId || !rest.length) {
    console.error('usage: ai-dismiss-thread <thread-node-id> <reply-body>');
    process.exit(2);
  }
  const result = await dismissThread(threadId, rest.join(' '));
  if (result === 'ok') {
    console.log(`✓ dismissed ${threadId}`);
    return;
  }
  if (result === 'reply_only') {
    console.error(
      `⚠ reply posted but resolve failed for ${threadId} — run: ai-resolve-thread ${threadId}`,
    );
    process.exit(1);
  }
  console.error(`✗ failed to dismiss ${threadId}`);
  process.exit(1);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
