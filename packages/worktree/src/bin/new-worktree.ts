#!/usr/bin/env node
// Thin CLI wrapper over `runNewWorktree`. Args are parsed here; all logic lives
// in the library so PR Shepherd and the harness share one implementation. On
// success the worktree's absolute path is the final stdout line (progress logs
// go to stderr), so callers can chain into `cd "$(ai-new-worktree …)"`.
import {
  runNewWorktree,
  VALID_BRANCH_PREFIXES,
  type BranchPrefix,
  type NewWorktreeOptions,
} from '../new-worktree.js';

function parseArgs(argv: string[]): NewWorktreeOptions {
  const opts: NewWorktreeOptions = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--name') opts.name = argv[++i];
    else if (arg === '--branch-prefix') {
      const value = argv[++i];
      if (value === undefined || !VALID_BRANCH_PREFIXES.includes(value as BranchPrefix)) {
        throw new Error(`--branch-prefix must be one of: ${VALID_BRANCH_PREFIXES.join(', ')}`);
      }
      opts.branchPrefix = value;
    } else if (arg === '--base') opts.base = argv[++i];
    else if (arg === '--skip-install') opts.skipInstall = true;
    else if (arg !== undefined && /^\d+$/.test(arg)) opts.issue = Number(arg);
    else throw new Error(`unexpected argument: ${arg}`);
  }
  return opts;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.issue === undefined && !opts.name) {
    console.error('error: either an issue number or --name is required');
    process.exit(2);
  }
  const result = await runNewWorktree(opts);
  // Final stdout line: the worktree path, parseable by callers.
  console.log(result.worktreePath);
}

main().catch((err: unknown) => {
  console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
