import { verifyAutomergeGate } from './verify-automerge-gate.js';

/**
 * A **read-only** sweep of each repo's auto-merge gate — the pre-flight before
 * any fleet-wide `--apply`. It runs one {@link verifyAutomergeGate} confirm per
 * repo (never `apply`, so it is safe to run across the fleet) and aggregates the
 * per-repo state into a report, so a caller can make a go/no-go decision and spot
 * which repos still carry legacy classic-protection drift.
 */

/** How a repo's default branch is protected, for the audit's migration view. */
export type ProtectionMechanism = 'none' | 'classic' | 'ruleset' | 'both';

export interface FleetAuditRow {
  repo: string;
  /** False when the repo could not be read; treated as unsatisfied (fail-closed). */
  ok: boolean;
  /** Why the read failed — present only when `ok` is false. */
  error?: string;
  /** How the default branch is protected (drift lives in `classicProtection`). */
  mechanism: ProtectionMechanism;
  allowAutoMerge: boolean;
  requiredChecks: string[];
  missingChecks: string[];
  squashCommitCorrect: boolean;
  /** Legacy classic protection still present — migrate-and-remove drift. */
  classicProtection: boolean;
  satisfied: boolean;
}

export interface FleetAuditSummary {
  total: number;
  satisfied: number;
  unsatisfied: number;
  /** Repos still carrying legacy classic protection (a migration signal). */
  classicDrift: number;
  /** Repos that could not be read (counted as not-satisfied for go/no-go). */
  errored: number;
}

export interface FleetAuditReport {
  rows: FleetAuditRow[];
  summary: FleetAuditSummary;
}

export interface FleetAuditOptions {
  /** Repos to audit, as `owner/repo`. */
  repos: readonly string[];
  /** Gate-check contexts required for satisfaction (defaults to the golden set). */
  gateChecks?: readonly string[];
}

function mechanismOf(rulesetProtection: boolean, classicProtection: boolean): ProtectionMechanism {
  if (rulesetProtection && classicProtection) return 'both';
  if (rulesetProtection) return 'ruleset';
  if (classicProtection) return 'classic';
  return 'none';
}

async function auditOne(repo: string, gateChecks?: readonly string[]): Promise<FleetAuditRow> {
  try {
    // `apply` is deliberately never set — the audit only reads.
    const r = await verifyAutomergeGate({ repo, gateChecks });
    return {
      repo,
      ok: true,
      mechanism: mechanismOf(r.rulesetProtection, r.classicProtection),
      allowAutoMerge: r.allowAutoMerge,
      requiredChecks: r.requiredChecks,
      missingChecks: r.missingChecks,
      squashCommitCorrect: r.squashCommitCorrect,
      classicProtection: r.classicProtection,
      satisfied: r.satisfied,
    };
  } catch (err) {
    return {
      repo,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      mechanism: 'none',
      allowAutoMerge: false,
      requiredChecks: [],
      missingChecks: [],
      squashCommitCorrect: false,
      classicProtection: false,
      satisfied: false,
    };
  }
}

function summarize(rows: readonly FleetAuditRow[]): FleetAuditSummary {
  return {
    total: rows.length,
    satisfied: rows.filter((r) => r.ok && r.satisfied).length,
    unsatisfied: rows.filter((r) => r.ok && !r.satisfied).length,
    classicDrift: rows.filter((r) => r.ok && r.classicProtection).length,
    errored: rows.filter((r) => !r.ok).length,
  };
}

/**
 * Audit each repo's auto-merge gate read-only and aggregate the rows into a
 * fleet report. A repo that cannot be read becomes a fail-closed row
 * (`ok: false`, unsatisfied) rather than aborting the whole sweep.
 */
export async function auditFleet(opts: FleetAuditOptions): Promise<FleetAuditReport> {
  const rows = await Promise.all(opts.repos.map((repo) => auditOne(repo, opts.gateChecks)));
  return { rows, summary: summarize(rows) };
}
