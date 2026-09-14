#!/usr/bin/env node
// Thin CLI wrapper over `runCleanup`. Runs from within the repository by default;
// pass `-C`/`--cwd <dir>` to point at another local checkout and `--repo owner/repo`
// (or set `GH_REPO`) to target the PR-state lookups — e.g. from a sub-agent that
// cannot pin its cwd, without ever `cd <dir> && ai-git-cleanup`. All progress lines
// print via the library logger.
import { runCleanup, type CleanupOptions } from '../git-cleanup.js';

function parseArgs(argv: string[]): CleanupOptions {
  const opts: CleanupOptions = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--repo') opts.repo = argv[++i];
    else if (arg === '-C' || arg === '--cwd') opts.cwd = argv[++i];
    else {
      console.error(`usage: ai-git-cleanup [--repo owner/repo] [-C <dir>]`);
      process.exit(2);
    }
  }
  return opts;
}

async function main(): Promise<void> {
  await runCleanup(parseArgs(process.argv.slice(2)));
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
