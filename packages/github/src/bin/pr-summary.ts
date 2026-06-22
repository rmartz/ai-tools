#!/usr/bin/env node
// Thin CLI wrapper over the library API. This is the *dual interface* in action:
// PR Shepherd imports `fetchPrSummary`; the harness invokes `ai-pr-summary`.
// All logic lives in the library — the bin only parses args and prints.
import { fetchPrSummary } from '../pr-summary.js';

async function main(): Promise<void> {
  const [repo, prNumber] = process.argv.slice(2);
  if (!repo || !prNumber) {
    console.error('usage: ai-pr-summary <owner/repo> <pr-number>');
    process.exit(2);
  }
  const summary = await fetchPrSummary(repo, Number(prNumber));
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
