#!/usr/bin/env node
// Thin CLI wrapper over `resolveThread`. Resolves one or more review threads by
// their `PRRT_` node IDs; exits non-zero if any fails.
import { resolveThread } from '../threads.js';

async function main(): Promise<void> {
  const ids = process.argv.slice(2);
  if (!ids.length) {
    console.error('usage: ai-resolve-thread <thread-node-id> [<thread-node-id> ...]');
    process.exit(2);
  }
  let anyFailed = false;
  for (const id of ids) {
    if (await resolveThread(id)) {
      console.log(`✓ resolved ${id}`);
    } else {
      console.error(`✗ failed to resolve ${id}`);
      anyFailed = true;
    }
  }
  process.exit(anyFailed ? 1 : 0);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
