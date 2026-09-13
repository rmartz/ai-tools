#!/usr/bin/env node
// Thin CLI wrapper over `ensureLabels`. Resolves the target repo (positional
// `owner/repo` → `GH_REPO` → cwd, via `resolveRepoTarget`) and prints a per-label
// outcome summary; all reconciliation logic stays in the library.
import { resolveRepoTarget } from '@rmartz/github';
import { ensureLabels } from '../ensure-labels.js';

async function main(): Promise<void> {
  const repo = await resolveRepoTarget({ repo: process.argv[2] });
  if (!repo) {
    throw new Error(
      'could not resolve repository (pass owner/repo, set GH_REPO, or run in a repo)',
    );
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
