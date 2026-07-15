#!/usr/bin/env node
// Thin CLI wrapper over the pre-push verify library. All logic lives in the
// library (so PR Shepherd and the harness share one implementation); the bin
// only parses args, runs the gate, prints, and maps the outcome to an exit code.
import { detectRepoRoot, verify, selectChecks, anyFailed } from '../index.js';
import type { CheckResult } from '../index.js';

const STATUS_LABEL: Record<CheckResult['status'], string> = {
  pass: 'PASS',
  fail: 'FAIL',
  skipped: 'SKIP',
};

function printHuman(results: CheckResult[]): void {
  if (results.length === 0) {
    console.log('pre-push verify: no locally-runnable CI checks detected — skipping.');
    return;
  }
  console.log(`pre-push verify — ${results.length} check(s):`);
  for (const r of results) {
    console.log(
      `  ${STATUS_LABEL[r.status].padEnd(4)}  ${r.check.category.padEnd(9)}  ${r.check.command}`,
    );
  }
  const failed = results.filter((r) => r.status === 'fail');
  const skipped = results.filter((r) => r.status === 'skipped');
  for (const r of failed) {
    console.log();
    console.log(`--- output: ${r.check.command} ---`);
    if (r.output) console.log(r.output);
  }
  for (const r of skipped) {
    console.log(`WARNING: skipped ${r.check.command} — ${r.output}`);
  }
  console.log();
  if (failed.length > 0) {
    console.log(`${failed.length} check(s) failed — fix before pushing.`);
  } else {
    console.log('All locally-runnable CI checks passed.');
  }
}

function payload(results: CheckResult[]): unknown {
  return {
    checks: results.map((r) => ({
      category: r.check.category,
      command: r.check.command,
      tool: r.check.tool,
      status: r.status,
      returncode: r.returncode,
    })),
    failed: results.filter((r) => r.status === 'fail').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
    ok: results.every((r) => r.status !== 'fail'),
  };
}

interface Args {
  cwd: string;
  list: boolean;
  json: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { cwd: '.', list: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-C' || arg === '--cwd') {
      const next = argv[++i];
      if (next !== undefined) args.cwd = next;
    } else if (arg === '--list') {
      args.list = true;
    } else if (arg === '--json') {
      args.json = true;
    }
  }
  return args;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = await detectRepoRoot(args.cwd);

  if (args.list) {
    const checks = selectChecks(repoRoot);
    if (args.json) {
      console.log(
        JSON.stringify(
          {
            checks: checks.map((c) => ({ category: c.category, command: c.command, tool: c.tool })),
          },
          null,
          2,
        ),
      );
    } else {
      for (const c of checks) console.log(`${c.category.padEnd(9)}  ${c.command}`);
    }
    return 0;
  }

  const results = await verify(repoRoot);
  if (args.json) {
    console.log(JSON.stringify(payload(results), null, 2));
  } else {
    printHuman(results);
  }
  return anyFailed(results) ? 1 : 0;
}

async function run(): Promise<void> {
  try {
    process.exit(await main());
  } catch (err: unknown) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

void run();
