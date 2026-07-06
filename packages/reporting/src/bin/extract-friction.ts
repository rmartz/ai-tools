#!/usr/bin/env node
// Thin CLI wrapper over the friction extractor. Reads transcript JSONL files —
// either the explicit paths named on argv, or, when none are given, the ones the
// discovery layer finds under ~/.claude/projects modified in the last N days —
// extracts friction events from each, and prints the Markdown report. Library
// code (`extractFrictionFromText` / `formatFrictionReport` / `discoverTranscripts`)
// owns all logic; the harness/PR Shepherd import the library directly.
//
// Usage: ai-extract-friction [--days N] [<transcript.jsonl> ...]
//
// Paths are optional. With none, `discoverTranscripts` walks ~/.claude/projects
// and keeps the last-N-days transcripts (mtime windowed by --days). With explicit
// paths, exactly those files are read and --days only labels the report heading.
// So `--days N` both windows discovery and labels the heading. The pure friction
// extractor (`friction.ts`) stays free of all directory-walking knowledge.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { extractFrictionFromText, formatFrictionReport } from '../friction.js';
import { discoverTranscripts } from '../transcript-discovery.js';

function main(): void {
  const argv = process.argv.slice(2);
  let days = 7;
  const paths: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? '';
    if (a === '--days') {
      const value = argv[++i];
      const n = Number(value);
      if (!Number.isFinite(n)) {
        console.error('error: --days requires a numeric value');
        process.exit(1);
      }
      days = n;
    } else {
      paths.push(a);
    }
  }

  const transcripts = paths.length > 0 ? paths : discoverTranscripts({ days });
  if (transcripts.length === 0) {
    console.error(
      `note: no transcripts found in the last ${days} day(s) under ~/.claude/projects; ` +
        'pass explicit <transcript.jsonl> paths to override discovery.',
    );
  }

  const results = transcripts.map((path) => {
    let text = '';
    try {
      text = readFileSync(path, 'utf8');
    } catch {
      text = '';
    }
    const stem = basename(path).replace(/\.jsonl$/, '');
    return { project: stem, path, events: extractFrictionFromText(text, stem.slice(0, 8)) };
  });

  console.log(formatFrictionReport(results, days));
}

main();
