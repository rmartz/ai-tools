#!/usr/bin/env node
// Thin CLI wrapper over `gatherRepoStatus`. Logic lives in the library; the bin
// only invokes it and prints the structured JSON.
import { gatherRepoStatus } from '../repo-status.js';

async function main(): Promise<void> {
  // Repo from `--repo` / `GH_REPO` / cwd (see `gatherRepoStatus`), so a caller
  // that cannot pin its cwd never needs `cd <dir> && ai-repo-status`.
  let repo: string | undefined;
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--repo') repo = argv[++i];
  }
  const status = await gatherRepoStatus({ repo });
  console.log(JSON.stringify(status, null, 2));
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
