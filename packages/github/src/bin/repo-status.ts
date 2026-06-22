#!/usr/bin/env node
// Thin CLI wrapper over `gatherRepoStatus`. Logic lives in the library; the bin
// only invokes it and prints the structured JSON.
import { gatherRepoStatus } from '../repo-status.js';

async function main(): Promise<void> {
  const status = await gatherRepoStatus();
  console.log(JSON.stringify(status, null, 2));
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
