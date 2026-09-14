#!/usr/bin/env node
// Thin CLI wrapper over `computePrDiff`. Logic lives in the library; the bin
// only parses args, prints the diff, and routes notes to stderr.
import { computePrDiff } from '../pr-diff.js';

async function main(): Promise<void> {
  // Repo may be given as the third positional (back-compat) or via `--repo`;
  // omit both to fall back to `GH_REPO` → cwd (see `computePrDiff`), so a caller
  // that cannot pin its cwd never needs `cd <dir> && ai-pr-diff`.
  let repo: string | undefined;
  const positional: string[] = [];
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--repo') repo = argv[++i];
    else if (a !== undefined) positional.push(a);
  }
  const [baseSha, headSha, positionalRepo] = positional;
  if (!baseSha || !headSha) {
    console.error('usage: ai-pr-diff <base_sha> <head_sha> [owner/repo] [--repo <owner/repo>]');
    process.exit(2);
  }
  const diff = await computePrDiff(baseSha, headSha, repo ?? positionalRepo, {
    warn: (m) => console.error(m),
  });
  process.stdout.write(diff.endsWith('\n') ? diff : `${diff}\n`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
