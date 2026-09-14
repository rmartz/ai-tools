#!/usr/bin/env node
// Thin CLI over `renderJsonMarker` + `postPrComment`: post a machine-readable record
// as a hidden marker comment on a PR. The record is authored as plain JSON (a file or
// literal) — this bin base64-encodes it into the marker envelope so a craft skill (which
// cannot reliably hand-produce base64) just writes JSON and calls this. It posts DATA,
// never a decision (no verdict, no label, no review event).
//
// usage: ai-post-json-marker [--repo <owner/repo>] <pr> <kind> <json-file-or-literal>
import { existsSync, readFileSync } from 'node:fs';
import { renderJsonMarker } from '../json-marker.js';
import { postPrComment } from '../pr-comment.js';
import { resolveRepoTarget } from '../gh-call.js';

interface Args {
  repo?: string;
  pr: string;
  kind: string;
  jsonArg: string;
}

function parse(argv: string[]): Args {
  let repo: string | undefined;
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--repo') repo = argv[++i];
    else if (a !== undefined) positional.push(a);
  }
  const [pr, kind, jsonArg] = positional;
  if (!pr || !kind || jsonArg === undefined) {
    console.error(
      'usage: ai-post-json-marker [--repo <owner/repo>] <pr> <kind> <json-file-or-literal>',
    );
    process.exit(2);
  }
  return { repo, pr, kind, jsonArg };
}

async function main(): Promise<void> {
  const { repo: repoArg, pr, kind, jsonArg } = parse(process.argv.slice(2));
  const raw = existsSync(jsonArg) ? readFileSync(jsonArg, 'utf8') : jsonArg;
  let record: unknown;
  try {
    record = JSON.parse(raw);
  } catch {
    throw new Error('record is not valid JSON (pass a JSON file path or a JSON literal)');
  }

  const repo = await resolveRepoTarget({ repo: repoArg });
  if (!repo) throw new Error('could not resolve repository (pass --repo or set GH_REPO)');

  const note = `🤖 \`${kind}\` record (machine-readable; consumed by the review runner).`;
  const marker = renderJsonMarker(kind, record);
  const url = await postPrComment(repo, pr, `${note}\n\n${marker}`);
  if (url === null) throw new Error(`failed to post ${kind} record on PR #${pr}`);
  console.log(`PR #${pr}: ${kind} record posted. ${url}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
