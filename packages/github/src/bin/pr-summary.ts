#!/usr/bin/env node
// Thin CLI wrapper over the library API. This is the *dual interface* in action:
// PR Shepherd imports `fetchPrSummary`; the harness invokes `ai-pr-summary`.
// All logic lives in the library — the bin only parses args and prints.
import { fetchPrSummary } from '../pr-summary.js';
import { resolveRepoTarget } from '../gh-call.js';

async function main(): Promise<void> {
  // Accepts `<owner/repo> <pr-number>` (back-compat) or just `<pr-number>` with
  // the repo from `--repo` / `GH_REPO` / cwd — so a caller that cannot pin its
  // cwd never needs `cd <dir> && ai-pr-summary`.
  let repoFlag: string | undefined;
  const positional: string[] = [];
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--repo') repoFlag = argv[++i];
    else if (a !== undefined) positional.push(a);
  }
  // With two positionals the first is the repo; with one it's the PR number.
  const [repoOrPr, maybePr] = positional;
  const prNumber = maybePr ?? repoOrPr;
  const positionalRepo = maybePr ? repoOrPr : undefined;
  if (!prNumber) {
    console.error('usage: ai-pr-summary [owner/repo] <pr-number> [--repo <owner/repo>]');
    process.exit(2);
  }
  const repo = await resolveRepoTarget({ repo: repoFlag ?? positionalRepo });
  if (!repo) throw new Error('could not resolve repository (pass owner/repo, --repo, or GH_REPO)');
  const summary = await fetchPrSummary(repo, Number(prNumber));
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
