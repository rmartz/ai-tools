#!/usr/bin/env node
// Thin CLI wrapper over `ensureProjectConfig`. Resolves the repo root (via
// `git rev-parse`) and prints a per-file outcome summary; all fs logic stays in
// the library.
import { boundedRun } from '@rmartz/agent-runtime';
import { ensureProjectConfig } from '../ensure-project-config.js';

async function detectRepoRoot(): Promise<string> {
  const r = await boundedRun('git', ['rev-parse', '--show-toplevel'], { timeoutMs: 10_000 });
  if (r.code !== 0 || !r.stdout.trim()) {
    throw new Error(`could not detect repo root: ${r.stderr.trim() || 'git rev-parse failed'}`);
  }
  return r.stdout.trim();
}

async function main(): Promise<void> {
  const root = await detectRepoRoot();
  const result = ensureProjectConfig(root);
  console.log(`Repo root: ${result.root}\n`);
  for (const o of result.outcomes) {
    console.log(`  ${o.filename}: ${o.action}`);
  }
  const changed = result.outcomes.filter((o) => o.action !== 'unchanged').length;
  console.log(
    changed ? `\n${changed} file(s) updated.` : '\nAll managed blocks present — nothing to do.',
  );
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
