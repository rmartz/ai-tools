import type { Finding } from './types.js';

/**
 * The plain-text reporter — the one output format for the MVP, serving both the
 * local husky gate and CI logs. Each finding renders as
 * `severity [check] path:line: message`; the location collapses gracefully when
 * a finding has no line (file-level) or no path (repo-level). Richer surfacing
 * (`--format=github` annotations, SARIF) is tracked as post-MVP follow-ups.
 */

function locationOf(finding: Finding): string {
  if (!finding.path) return '';
  return finding.line ? `${finding.path}:${finding.line}: ` : `${finding.path}: `;
}

/** Render one finding as a single human-readable line. */
export function formatFinding(finding: Finding): string {
  return `${finding.severity} [${finding.check}] ${locationOf(finding)}${finding.message}`;
}

/** Render findings as newline-separated report lines; empty string for none. */
export function formatFindings(findings: Finding[]): string {
  return findings.map(formatFinding).join('\n');
}
