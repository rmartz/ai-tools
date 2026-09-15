#!/usr/bin/env node
// Thin CLI wrapper over `verifyAutomergeGate`. Confirms (default, read-only) or
// applies (`--apply`, opt-in) the branch-protection gate native Dependabot
// auto-merge depends on. All logic stays in the library.
//
//   ai-verify-automerge-gate [-C <dir>] [--repo <owner/repo>] [--apply] [--check <ctx>]...
//
// Repo target: `--repo` → `GH_REPO` → the checkout at `-C`/`--cwd` (default cwd),
// so a caller that cannot pin its cwd never needs `cd <dir> && ai-*`. Exits
// non-zero when the gate is unsatisfied (and not applied) — the hard block the
// /bootstrap skill relies on.
import { verifyAutomergeGate } from '../verify-automerge-gate.js';

interface Args {
  cwd?: string;
  repo?: string;
  apply: boolean;
  checks: string[];
}

function parseArgs(argv: string[]): Args {
  const args: Args = { apply: false, checks: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-C' || a === '--cwd') args.cwd = argv[++i];
    else if (a === '--repo') args.repo = argv[++i];
    else if (a === '--apply') args.apply = true;
    else if (a === '--check') args.checks.push(argv[++i] ?? '');
    else {
      console.error(`unknown argument: ${a}`);
      console.error(
        'usage: ai-verify-automerge-gate [-C <dir>] [--repo <owner/repo>] [--apply] [--check <ctx>]...',
      );
      process.exit(2);
    }
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const result = await verifyAutomergeGate({
    cwd: args.cwd,
    repo: args.repo,
    apply: args.apply,
    gateChecks: args.checks.length ? args.checks : undefined,
  });

  console.log(`Repo:            ${result.repo}`);
  console.log(`Default branch:  ${result.branch}`);
  console.log(`allow_auto_merge: ${result.allowAutoMerge ? 'on' : 'off'}`);
  console.log(`Gate checks:     ${result.gateChecks.join(', ') || '(none)'}`);
  console.log(`Required checks: ${result.requiredChecks.join(', ') || '(none)'}`);
  console.log(
    `Squash commit:   ${result.squashCommitCorrect ? 'PR title + body' : 'NOT PR title + body'}`,
  );
  if (result.applied)
    console.log(
      '\nApplied: enabled auto-merge, set the required gate checks, and fixed the squash setting.',
    );

  if (result.satisfied) {
    console.log('\n✓ Auto-merge gate satisfied.');
    return;
  }
  console.error('\n✗ Auto-merge gate NOT satisfied:');
  if (!result.allowAutoMerge) console.error('  - allow_auto_merge is off on the repo.');
  if (result.missingChecks.length) {
    console.error(`  - required checks missing: ${result.missingChecks.join(', ')}.`);
  }
  if (!result.squashCommitCorrect) {
    console.error(
      '  - squash-merge commit is not set to PR title + body (release-please needs it).',
    );
  }
  console.error('\nRe-run with --apply to configure the gate (admin, state-changing).');
  process.exit(1);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
