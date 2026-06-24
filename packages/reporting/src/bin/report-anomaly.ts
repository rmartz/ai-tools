#!/usr/bin/env node
// Thin CLI over `reportAnomaly` for non-TS emitters. Parses the occurrence
// fields from flags, files it against the category's ledger, prints the URL.
// All category→title mapping and find-or-create-or-append logic stays in the
// library; PR Shepherd and the harness import it directly.
//
// Usage: ai-report-anomaly --category <slug> --summary <text> --source-repo <owner/repo>
//          --timestamp <iso> [--subject <s>] [--detail <text>] [--pr <n>]
//          [--git-hash <sha>] [--head-sha <sha>] [--run-id <id>]
//          [--step-instance-id <id>] [--skill-version <v>] [--transcript <id>]
//          [--repo <ledger owner/repo>]
import { reportAnomaly, type AnomalyCategory, type AnomalyOccurrence } from '../anomaly.js';

const USAGE =
  'usage: ai-report-anomaly --category <slug> --summary <text> ' +
  '--source-repo <owner/repo> --timestamp <iso> [--subject <s>] [--detail <text>] ' +
  '[--pr <n>] [--git-hash <sha>] [--head-sha <sha>] [--run-id <id>] ' +
  '[--step-instance-id <id>] [--skill-version <v>] [--transcript <id>] ' +
  '[--repo <ledger owner/repo>]';

function parseFlags(argv: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? '';
    if (!a.startsWith('--')) {
      console.error(`error: unexpected argument '${a}'`);
      console.error(USAGE);
      process.exit(1);
    }
    const value = argv[++i];
    if (value === undefined) {
      console.error(`error: ${a} requires a value`);
      process.exit(1);
    }
    flags[a.slice(2)] = value;
  }
  return flags;
}

async function main(): Promise<void> {
  const f = parseFlags(process.argv.slice(2));

  const category = f['category'];
  const summary = f['summary'];
  const sourceRepo = f['source-repo'];
  const timestamp = f['timestamp'];
  if (!category || !summary || !sourceRepo || !timestamp) {
    console.error(USAGE);
    process.exit(1);
  }

  const occ: AnomalyOccurrence = {
    category: category as AnomalyCategory,
    summary,
    sourceRepo,
    timestamp,
  };
  if (f['subject']) occ.subject = f['subject'];
  if (f['detail']) occ.detail = f['detail'];
  if (f['pr']) occ.pr = Number(f['pr']);
  if (f['git-hash']) occ.gitHash = f['git-hash'];
  if (f['head-sha']) occ.headSha = f['head-sha'];
  if (f['run-id']) occ.runId = f['run-id'];
  if (f['step-instance-id']) occ.stepInstanceId = f['step-instance-id'];
  if (f['skill-version']) occ.skillVersion = f['skill-version'];
  if (f['transcript']) occ.transcriptId = f['transcript'];

  const url = await reportAnomaly(occ, f['repo'] ? { repo: f['repo'] } : {});
  if (url === null) {
    console.error('error: failed to report anomaly (unknown category or filing failure)');
    process.exit(1);
  }
  console.log(url);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
