#!/usr/bin/env node
// Thin CLI wrapper over `reportToTracking`. Parses the title + body-file and the
// metadata flags, posts the occurrence, prints the ledger URL, and (on success
// only) optionally deletes the body file. All find-or-create-or-append logic
// stays in the library. TS port of dotfiles' `report-to-tracking.py`.
//
// Usage: ai-report-to-tracking <title> <body-file> [--repo <owner/repo>]
//        [--source-repo <owner/repo>] [--skill <name>] [--pr <n>]
//        [--transcript <id>] [--meta <text>] [--delete-body]
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { reportToTracking } from '../tracking.js';

interface ParsedFlags {
  repo?: string;
  sourceRepo?: string;
  skill?: string;
  pr?: string;
  transcript?: string;
  meta?: string;
}

const FLAG_KEYS: Record<string, keyof ParsedFlags> = {
  '--repo': 'repo',
  '--source-repo': 'sourceRepo',
  '--skill': 'skill',
  '--pr': 'pr',
  '--transcript': 'transcript',
  '--meta': 'meta',
};

const USAGE =
  'usage: ai-report-to-tracking <title> <body-file> [--repo <owner/repo>] ' +
  '[--source-repo <owner/repo>] [--skill <name>] [--pr <n>] [--transcript <id>] ' +
  '[--meta <text>] [--delete-body]';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let deleteBody = false;
  const flags: ParsedFlags = {};
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? '';
    if (a === '--delete-body') {
      deleteBody = true;
    } else if (a in FLAG_KEYS) {
      const value = argv[++i];
      if (value === undefined) {
        console.error(`error: ${a} requires a value`);
        process.exit(1);
      }
      flags[FLAG_KEYS[a] as keyof ParsedFlags] = value;
    } else {
      positional.push(a);
    }
  }

  const [title, bodyPath] = positional;
  if (!title || !bodyPath) {
    console.error(USAGE);
    process.exit(1);
  }
  if (!existsSync(bodyPath)) {
    console.error(`error: body file not found: ${bodyPath}`);
    process.exit(1);
  }
  const body = readFileSync(bodyPath, 'utf8');

  const url = await reportToTracking(title, body, {
    repo: flags.repo,
    sourceRepo: flags.sourceRepo,
    skill: flags.skill,
    pr: flags.pr,
    transcriptId: flags.transcript,
    skillMeta: flags.meta,
  });
  if (url === null) {
    console.error('error: failed to report to tracking issue');
    process.exit(1);
  }
  if (deleteBody) {
    try {
      unlinkSync(bodyPath);
    } catch {
      // Soft-fail: the post succeeded; a leftover body file is harmless.
    }
  }
  console.log(url);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
