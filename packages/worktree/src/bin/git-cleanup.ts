#!/usr/bin/env node
// Thin CLI wrapper over `runCleanup`. Takes no arguments; run from within the
// repository. All progress lines print to stdout via the library logger.
import { runCleanup } from '../git-cleanup.js';

async function main(): Promise<void> {
  await runCleanup();
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
