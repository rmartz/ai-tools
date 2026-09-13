#!/usr/bin/env node
// Thin CLI over `listIssueComments` + `parseLatestJsonMarker`: print the latest record
// of a given kind carried as a hidden marker on a PR. The review runner (the dotfiles
// executor today, PR Shepherd later) uses this to read what a craft skill emitted.
// Prints the record JSON to stdout, or exits 1 with nothing on stdout if none is found.
//
// usage: ai-read-json-marker [--repo <owner/repo>] [--match-pr-head <sha>] <pr> <kind>
import { parseLatestJsonMarker } from '../json-marker.js';
import { listIssueComments } from '../pr-reads.js';
import { resolveRepoTarget } from '../gh-call.js';

interface Args {
  repo?: string;
  prHead?: string;
  pr: string;
  kind: string;
}

function parse(argv: string[]): Args {
  let repo: string | undefined;
  let prHead: string | undefined;
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--repo') repo = argv[++i];
    else if (a === '--match-pr-head') prHead = argv[++i];
    else if (a !== undefined) positional.push(a);
  }
  const [pr, kind] = positional;
  if (!pr || !kind) {
    console.error(
      'usage: ai-read-json-marker [--repo <owner/repo>] [--match-pr-head <sha>] <pr> <kind>',
    );
    process.exit(2);
  }
  return { repo, prHead, pr, kind };
}

async function main(): Promise<void> {
  const { repo: repoArg, prHead, pr, kind } = parse(process.argv.slice(2));
  const repo = await resolveRepoTarget({ repo: repoArg });
  if (!repo) throw new Error('could not resolve repository (pass --repo or set GH_REPO)');

  const comments = await listIssueComments(repo, Number(pr));
  const record = parseLatestJsonMarker<{ prHead?: string }>(
    kind,
    comments.map((c) => c.body),
    prHead === undefined ? {} : { match: (r) => r.prHead === prHead },
  );
  if (record === null) {
    process.exit(1);
  }
  console.log(JSON.stringify(record));
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
