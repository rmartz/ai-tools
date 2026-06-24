#!/usr/bin/env node
// Thin CLI over `auditPrEfficiency`. Derives the efficiency event for a PR from
// GitHub history and prints it as JSON (the EfficiencyEvent wire shape). All
// detection lives in the library; PR Shepherd imports it directly and may pass
// durationsMs enrichment in-process (not exposed on this CLI — derivation only).
//
// Usage: ai-efficiency-audit <pr> [--repo <owner/repo>] [--merged-at <iso>]
import { auditPrEfficiency } from '../efficiency-audit.js';

const USAGE = 'usage: ai-efficiency-audit <pr> [--repo <owner/repo>] [--merged-at <iso>]';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let repo: string | undefined;
  let mergedAt: string | undefined;
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? '';
    if (a === '--repo') {
      repo = argv[++i];
    } else if (a === '--merged-at') {
      mergedAt = argv[++i];
    } else {
      positional.push(a);
    }
  }

  const prArg = positional[0];
  if (!prArg) {
    console.error(USAGE);
    process.exit(1);
  }
  const pr = Number(prArg);
  if (!Number.isInteger(pr) || pr <= 0) {
    console.error(`error: '${prArg}' is not a valid PR number`);
    process.exit(1);
  }

  const event = await auditPrEfficiency(pr, { repo, mergedAt });
  console.log(JSON.stringify(event, null, 2));
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
