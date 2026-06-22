#!/usr/bin/env node
// Thin CLI wrapper over `computePrDiff`. Logic lives in the library; the bin
// only parses args, prints the diff, and routes notes to stderr.
import { computePrDiff } from '../pr-diff.js';

async function main(): Promise<void> {
  const [baseSha, headSha, repo] = process.argv.slice(2);
  if (!baseSha || !headSha) {
    console.error('usage: ai-pr-diff <base_sha> <head_sha> [owner/repo]');
    process.exit(2);
  }
  const diff = await computePrDiff(baseSha, headSha, repo, {
    warn: (m) => console.error(m),
  });
  process.stdout.write(diff.endsWith('\n') ? diff : `${diff}\n`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
