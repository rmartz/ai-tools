#!/usr/bin/env node
// Thin CLI wrapper over `verifySquashMergeSetting`. Confirms (default, read-only)
// or applies (`--apply`, opt-in) the squash-merge commit convention that carries a
// PR's conventional title onto `main`. All logic stays in the library.
//
//   ai-verify-squash-setting [-C <dir>] [--repo <owner/repo>] [--apply]
//
// Repo target: `--repo` → `GH_REPO` → the checkout at `-C`/`--cwd` (default cwd),
// so a caller that cannot pin its cwd never needs `cd <dir> && ai-*`. Exits
// non-zero when the setting is unsatisfied (and not applied) — the hard block the
// /bootstrap skill relies on.
import { verifySquashMergeSetting } from '../verify-squash-merge-setting.js';

interface Args {
  cwd?: string;
  repo?: string;
  apply: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { apply: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-C' || a === '--cwd') args.cwd = argv[++i];
    else if (a === '--repo') args.repo = argv[++i];
    else if (a === '--apply') args.apply = true;
    else {
      console.error(`unknown argument: ${a}`);
      console.error('usage: ai-verify-squash-setting [-C <dir>] [--repo <owner/repo>] [--apply]');
      process.exit(2);
    }
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const result = await verifySquashMergeSetting({
    cwd: args.cwd,
    repo: args.repo,
    apply: args.apply,
  });

  console.log(`Repo:                ${result.repo}`);
  console.log(
    `squash title source:   ${result.squashTitle ?? '(unset)'} (want ${result.desiredTitle})`,
  );
  console.log(
    `squash message source: ${result.squashMessage ?? '(unset)'} (want ${result.desiredMessage})`,
  );
  if (result.applied) console.log('\nApplied: set the squash-merge commit sources.');

  if (result.satisfied) {
    console.log('\n✓ Squash-merge commit convention satisfied — PR titles reach main.');
    return;
  }
  console.error('\n✗ Squash-merge commit convention NOT satisfied.');
  console.error('  A squash merge would use the branch commit message instead of the conventional');
  console.error('  PR title, so release-please silently skips the release.');
  console.error('\nRe-run with --apply to set the convention (admin, state-changing).');
  process.exit(1);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
