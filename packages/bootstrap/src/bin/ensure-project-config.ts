#!/usr/bin/env node
// Thin CLI wrapper over `ensureProjectConfig`. Resolves the repo root (via
// `git rev-parse`) and prints a per-file outcome summary; all fs logic stays in
// the library. `-C`/`--cwd <dir>` resolves the repo root from that directory, so
// a caller that cannot pin its cwd never needs `cd <dir> && ai-ensure-project-config`.
//
// By default the gated auto-merge workflow is **withheld** (never seeded ungated).
// Pass `--with-gate` to seed it: the CLI reads the repo's real auto-merge gate
// (read-only) and seeds the gated workflow only if the gate is actually satisfied.
//   ai-ensure-project-config [-C <dir>] [--with-gate [--repo <owner/repo>] [--check <ctx>]...]
import { boundedRun } from '@rmartz/agent-runtime';
import { ensureProjectConfig } from '../ensure-project-config.js';
import { resolveSatisfiedGateChecks } from '../gate-satisfaction.js';

interface Args {
  cwd?: string;
  repo?: string;
  withGate: boolean;
  checks: string[];
}

function parseArgs(argv: string[]): Args {
  const args: Args = { withGate: false, checks: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-C' || a === '--cwd') args.cwd = argv[++i];
    else if (a === '--repo') args.repo = argv[++i];
    else if (a === '--with-gate') args.withGate = true;
    else if (a === '--check') args.checks.push(argv[++i] ?? '');
    else {
      console.error(`unknown argument: ${a}`);
      console.error(
        'usage: ai-ensure-project-config [-C <dir>] [--with-gate [--repo <owner/repo>] [--check <ctx>]...]',
      );
      process.exit(2);
    }
  }
  return args;
}

async function detectRepoRoot(cwd?: string): Promise<string> {
  const r = await boundedRun('git', ['rev-parse', '--show-toplevel'], { timeoutMs: 10_000, cwd });
  if (r.code !== 0 || !r.stdout.trim()) {
    throw new Error(`could not detect repo root: ${r.stderr.trim() || 'git rev-parse failed'}`);
  }
  return r.stdout.trim();
}

/** With `--with-gate`, read the real gate; otherwise (and on any read error) withhold. */
async function satisfiedGateChecks(args: Args): Promise<string[]> {
  if (!args.withGate) return [];
  try {
    return await resolveSatisfiedGateChecks({
      cwd: args.cwd,
      repo: args.repo,
      gateChecks: args.checks.length ? args.checks : undefined,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `Warning: could not read the auto-merge gate (${msg}); withholding gated workflows.`,
    );
    return [];
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const root = await detectRepoRoot(args.cwd);
  const result = ensureProjectConfig(root, {
    satisfiedGateChecks: await satisfiedGateChecks(args),
  });

  console.log(`Repo root: ${result.root}\n`);
  for (const o of result.outcomes) {
    console.log(`  ${o.filename}: ${o.action}`);
  }
  const changed = result.outcomes.filter(
    (o) => o.action === 'created' || o.action === 'updated' || o.action === 'removed',
  ).length;
  console.log(
    changed ? `\n${changed} file(s) changed.` : '\nAll managed files present — nothing to do.',
  );
  for (const o of result.outcomes.filter((o) => o.action === 'removed')) {
    console.log(`Note: ${o.filename} removed (retired golden file — no longer seeded).`);
  }
  for (const o of result.outcomes.filter((o) => o.action === 'withheld')) {
    console.log(
      `Note: ${o.filename} withheld — its auto-merge gate is not satisfied. Run ` +
        `\`ai-verify-automerge-gate --apply\`, then re-run with \`--with-gate\` to seed it.`,
    );
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
