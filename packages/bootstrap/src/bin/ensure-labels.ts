#!/usr/bin/env node
// Thin CLI wrapper over `ensureLabels`. Resolves the target repo (positional arg
// or the current `gh` repo) and prints a per-label outcome summary; all
// reconciliation logic stays in the library.
import { currentRepo } from '@rmartz/github';
import { ensureLabels } from '../ensure-labels.js';

async function main(): Promise<void> {
  const arg = process.argv[2];
  const repo = arg ?? (await currentRepo());
  if (!repo) {
    throw new Error('could not resolve repository (pass owner/repo or run inside a gh repo)');
  }

  const result = await ensureLabels(repo);
  for (const o of result.outcomes) {
    const detail = o.action === 'renamed' ? ` (from ${o.from})` : '';
    const err = o.action === 'failed' ? `: ${o.error}` : '';
    console.log(`  ${o.name}: ${o.action}${detail}${err}`);
  }
  console.log(`\n${result.outcomes.length} label(s) reconciled on ${result.repo}.`);
  if (result.failures.length) {
    throw new Error(
      `failed to reconcile ${result.failures.length} label(s): ${result.failures.join(', ')}`,
    );
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
