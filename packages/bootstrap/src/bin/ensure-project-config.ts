#!/usr/bin/env node
// Thin CLI wrapper over `ensureProjectConfig`. Resolves the repo root (via
// `git rev-parse`) and prints a per-file outcome summary; all fs logic stays in
// the library. `-C`/`--cwd <dir>` resolves the repo root from that directory, so
// a caller that cannot pin its cwd never needs `cd <dir> && ai-ensure-project-config`.
import { boundedRun } from '@rmartz/agent-runtime';
import { ensureProjectConfig } from '../ensure-project-config.js';

async function detectRepoRoot(cwd?: string): Promise<string> {
  const r = await boundedRun('git', ['rev-parse', '--show-toplevel'], { timeoutMs: 10_000, cwd });
  if (r.code !== 0 || !r.stdout.trim()) {
    throw new Error(`could not detect repo root: ${r.stderr.trim() || 'git rev-parse failed'}`);
  }
  return r.stdout.trim();
}

async function main(): Promise<void> {
  let cwd: string | undefined;
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-C' || a === '--cwd') cwd = argv[++i];
    else {
      console.error(`unknown argument: ${a}`);
      console.error('usage: ai-ensure-project-config [-C <dir>]');
      process.exit(2);
    }
  }
  const root = await detectRepoRoot(cwd);
  const result = ensureProjectConfig(root);
  console.log(`Repo root: ${result.root}\n`);
  for (const o of result.outcomes) {
    console.log(`  ${o.filename}: ${o.action}`);
  }
  const changed = result.outcomes.filter(
    (o) => o.action === 'created' || o.action === 'updated',
  ).length;
  const skipped = result.outcomes.filter((o) => o.action === 'skipped');
  console.log(changed ? `\n${changed} file(s) written.` : '\nAll managed files present — nothing to do.');
  for (const o of skipped) {
    console.log(`Note: ${o.filename} left untouched (user-authored; no managed header).`);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
