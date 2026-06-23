#!/usr/bin/env node
// Thin CLI over `createDependabotFixIssue`. Parses args, resolves the repo from
// the git remote, and prints the resulting issue URL; all authoring/dedup logic
// stays in the library so PR Shepherd and the harness share one implementation.
import { readFileSync } from 'node:fs';
import { createDependabotFixIssue } from '../dependabot-fix-issue.js';
import type { FixCategory } from '../dependabot-fix-issue.js';
import { currentRepo } from '@rmartz/github';

interface Args {
  prNumber: number;
  dependency: string;
  toVersion?: string;
  fromVersion?: string;
  category?: FixCategory;
  failingCheck?: string;
  failureFile?: string;
  labels: string[];
  repo?: string;
  skipDedup: boolean;
}

const CATEGORIES = new Set<FixCategory>([
  'lint-rule',
  'type-error',
  'breaking-api',
  'compatibility-shim',
  'test-failure',
  'unknown',
]);

function usage(): never {
  console.error(
    'usage: ai-dependabot-fix-issue --pr <n> --dependency <name> [--to <v>] [--from <v>]\n' +
      '         [--category <lint-rule|type-error|breaking-api|compatibility-shim|test-failure|unknown>]\n' +
      '         [--check <name>] [--failure-file <path>] [--label <l>]... [--repo <owner/repo>] [--skip-dedup]',
  );
  process.exit(2);
}

function parse(argv: string[]): Args {
  let prNumber: number | undefined;
  let dependency: string | undefined;
  const args: Partial<Args> = { labels: [], skipDedup: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--pr') prNumber = Number(argv[++i]);
    else if (a === '--dependency') dependency = argv[++i];
    else if (a === '--to') args.toVersion = argv[++i];
    else if (a === '--from') args.fromVersion = argv[++i];
    else if (a === '--category') {
      const c = argv[++i] as FixCategory;
      if (!CATEGORIES.has(c)) usage();
      args.category = c;
    } else if (a === '--check') args.failingCheck = argv[++i];
    else if (a === '--failure-file') args.failureFile = argv[++i];
    else if (a === '--label') args.labels?.push(argv[++i] ?? '');
    else if (a === '--repo') args.repo = argv[++i];
    else if (a === '--skip-dedup') args.skipDedup = true;
    else usage();
  }
  if (prNumber === undefined || Number.isNaN(prNumber) || !dependency) usage();
  return { ...(args as Args), prNumber, dependency };
}

async function main(): Promise<void> {
  const args = parse(process.argv.slice(2));
  const repo = args.repo ?? (await currentRepo());
  if (!repo) throw new Error('could not resolve repository (pass --repo or run inside a git repo)');

  const failureExcerpt = args.failureFile ? readFileSync(args.failureFile, 'utf8') : undefined;
  const result = await createDependabotFixIssue(
    repo,
    {
      prNumber: args.prNumber,
      dependency: args.dependency,
      toVersion: args.toVersion,
      fromVersion: args.fromVersion,
      category: args.category,
      failingCheck: args.failingCheck,
      failureExcerpt,
      labels: args.labels,
    },
    { skipDedup: args.skipDedup },
  );

  if (result.outcome === 'failed' || !result.url) {
    throw new Error(`failed to create fix issue for Dependabot PR #${args.prNumber}`);
  }
  const verb = result.outcome === 'existing' ? 'already open' : 'created';
  console.log(`Dependabot #${args.prNumber}: fix issue ${verb}. ${result.url}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
