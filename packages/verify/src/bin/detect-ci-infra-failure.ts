#!/usr/bin/env node
// Thin CLI wrapper over `isInfraFailure`. The library is pure (only the injected
// gh runner does I/O); the bin resolves the repo + PR head SHA via `gh`, calls
// the classifier, and prints `{ infra_failure, reason }` JSON. Always exits 0 —
// callers branch on the `infra_failure` field, not the exit code.
import { boundedRun } from '@rmartz/agent-runtime';
import { resolveRepoTarget } from '@rmartz/github';
import { isInfraFailure } from '../index.js';

const GH_TIMEOUT_MS = 30_000;

interface Args {
  pr: number;
  repo: string | null;
}

function parseArgs(argv: string[]): Args | null {
  let repo: string | null = null;
  let pr: number | null = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--repo') {
      const next = argv[++i];
      if (next !== undefined) repo = next;
    } else if (arg !== undefined && /^\d+$/.test(arg)) {
      pr = Number(arg);
    }
  }
  if (pr === null) return null;
  return { pr, repo };
}

async function gh(args: string[]): Promise<string> {
  const r = await boundedRun('gh', args, { timeoutMs: GH_TIMEOUT_MS });
  if (r.code !== 0) throw new Error(r.stderr.trim() || `gh exited ${r.code ?? 'null'}`);
  return r.stdout.trim();
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) {
    console.error('usage: ai-detect-ci-infra-failure <pr> [--repo owner/name]');
    process.exit(2);
    return;
  }

  // Resolve the target via the shared precedence (explicit --repo → GH_REPO → cwd),
  // so a caller that cannot pin its cwd still targets the right repo.
  const repo = await resolveRepoTarget({ repo: args.repo });
  if (!repo) {
    console.log(
      JSON.stringify({
        infra_failure: false,
        reason: 'could not resolve repo (pass --repo or set GH_REPO)',
      }),
    );
    return;
  }

  let headSha: string;
  try {
    // Scope `gh pr view` to the resolved repo so the PR number is not looked up
    // in whatever repo the cwd happens to be.
    headSha = await gh([
      'pr',
      'view',
      String(args.pr),
      '-R',
      repo,
      '--json',
      'headRefOid',
      '--jq',
      '.headRefOid',
    ]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(
      JSON.stringify({ infra_failure: false, reason: `could not resolve head sha: ${msg}` }),
    );
    return;
  }

  const { isInfra, reason } = await isInfraFailure(repo, headSha);
  console.log(JSON.stringify({ infra_failure: isInfra, reason }));
}

main().catch((err: unknown) => {
  // Soft-fail to a fixable verdict on any unexpected error, matching the lib.
  const msg = err instanceof Error ? err.message : String(err);
  console.log(JSON.stringify({ infra_failure: false, reason: `unexpected error: ${msg}` }));
});
