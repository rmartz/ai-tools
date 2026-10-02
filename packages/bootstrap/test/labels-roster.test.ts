import { describe, it, expect } from 'vitest';
import { defaultRoster } from '../src/labels-roster.js';

/**
 * Verbatim copies of the labels bootstrap shares with the fleet workflow roster,
 * rmartz/dotfiles `claude/scripts/labels.yml` (seeded by `ensure-labels.py`).
 * That file is the source of truth: both tools reconcile these labels on the
 * same repos, so any drift makes each run revert the other's color/description.
 * When labels.yml changes one of these, update this table and the roster
 * together. Kept inline so the test stays hermetic (no network fetch).
 */
const LABELS_YML: Readonly<Record<string, { color: string; description: string }>> = {
  Auth: { color: '6B7280', description: 'Authentication, authorization, and session management.' },
  UI: { color: '7C6FA5', description: 'User interface, visual design, and frontend components.' },
  Security: {
    color: 'A05757',
    description: 'Security vulnerabilities, hardening, and access controls.',
  },
  Infrastructure: {
    color: '6E8FA8',
    description: 'Hosting, environment configuration, and build tooling.',
  },
  DevOps: {
    color: '6B8F77',
    description: 'CI/CD pipelines, deployment automation, and developer tooling.',
  },
  Observability: { color: '8D8042', description: 'Logging, monitoring, alerting, and tracing.' },
  Notifications: {
    color: '8A6BA0',
    description: 'Push notifications, emails, in-app alerts, and messaging.',
  },
  Profile: { color: '9E8568', description: 'User profile management and account settings.' },
  tracking: {
    color: '0E8A16',
    description: 'Long-lived ledger issue that aggregates occurrences of a recurring pattern.',
  },
  'update required': {
    color: 'DBAB0A',
    description: 'Merge-safety: PR must be brought current against its base before merge (stale).',
  },
  'merge conflict': {
    color: 'D93F0B',
    description: 'Merge-safety: PR has a git merge conflict to resolve before merge.',
  },
  'CI approval needed': {
    color: 'F59E0B',
    description:
      'CI-loosening change awaiting human sign-off; merge-gated until `CI change approved`.',
  },
};

/** Labels bootstrap defines that labels.yml does not — bootstrap owns these outright. */
const BOOTSTRAP_ONLY = new Set(['discussion']);

describe('labels roster vs labels.yml', () => {
  it.each(defaultRoster.filter((l) => !BOOTSTRAP_ONLY.has(l.name)))(
    '$name matches labels.yml verbatim',
    (label) => {
      expect(LABELS_YML[label.name]).toBeDefined();
      expect({ color: label.color, description: label.description }).toEqual(
        LABELS_YML[label.name],
      );
    },
  );
});
