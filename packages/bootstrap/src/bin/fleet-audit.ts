#!/usr/bin/env node
// Thin CLI over `auditFleet`: a read-only sweep of each repo's auto-merge gate,
// printing a per-repo table + summary. Never writes. Exits non-zero when any
// repo's gate is unsatisfied or unreadable — the go/no-go signal for a fleet
// apply. All logic stays in the library.
//
//   ai-fleet-audit --repo <owner/repo> [--repo <owner/repo>]... [--check <ctx>]... [--json]
import { auditFleet, type FleetAuditReport, type FleetAuditRow } from '../fleet-audit.js';

interface Args {
  repos: string[];
  checks: string[];
  json: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { repos: [], checks: [], json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--repo') args.repos.push(argv[++i] ?? '');
    else if (a === '--check') args.checks.push(argv[++i] ?? '');
    else if (a === '--json') args.json = true;
    else {
      console.error(`unknown argument: ${a}`);
      console.error(
        'usage: ai-fleet-audit --repo <owner/repo> [--repo <owner/repo>]... [--check <ctx>]... [--json]',
      );
      process.exit(2);
    }
  }
  return args;
}

function formatRow(r: FleetAuditRow): string {
  if (!r.ok) return `  ✗ ${r.repo}  UNREADABLE: ${r.error ?? 'unknown error'}`;
  const mark = r.satisfied ? '✓' : '✗';
  const missing = r.missingChecks.length ? `  missing: ${r.missingChecks.join(', ')}` : '';
  const drift = r.classicProtection ? '  ⚠ classic-drift' : '';
  return (
    `  ${mark} ${r.repo}  [${r.mechanism}]  ` +
    `auto-merge=${r.allowAutoMerge ? 'on' : 'off'}  ` +
    `squash=${r.squashCommitCorrect ? 'ok' : 'bad'}${missing}${drift}`
  );
}

function printReport(report: FleetAuditReport): void {
  console.log('Auto-merge gate — fleet audit (read-only)\n');
  for (const row of report.rows) console.log(formatRow(row));
  const s = report.summary;
  console.log(
    `\nSummary: ${s.satisfied}/${s.total} satisfied  ·  ` +
      `${s.unsatisfied} unsatisfied  ·  ${s.classicDrift} classic-drift  ·  ${s.errored} unreadable`,
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.repos.length === 0) {
    console.error('error: at least one --repo <owner/repo> is required');
    process.exit(2);
  }
  const report = await auditFleet({
    repos: args.repos,
    gateChecks: args.checks.length ? args.checks : undefined,
  });
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else printReport(report);
  // Go/no-go: non-zero if any repo is unsatisfied or unreadable.
  const clean = report.summary.unsatisfied === 0 && report.summary.errored === 0;
  process.exit(clean ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
