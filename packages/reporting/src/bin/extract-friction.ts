#!/usr/bin/env node
// Thin CLI wrapper over the friction extractor. Reads one or more transcript
// JSONL files named on argv, extracts friction events from each, and prints the
// Markdown report. Library code (`extractFrictionFromText` / `formatFrictionReport`)
// owns all logic; the harness/PR Shepherd import the library directly.
//
// Usage: ai-extract-friction [--days N] <transcript.jsonl> [<transcript.jsonl> ...]
//
// Transcript discovery (walking ~/.claude/projects, mtime windowing) is the
// caller's responsibility — the library is deliberately free of that knowledge,
// so this CLI takes explicit paths. `--days N` only labels the report heading.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { extractFrictionFromText, formatFrictionReport } from '../friction.js';

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

  const results = paths.map((path) => {
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
