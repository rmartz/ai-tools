/**
 * The canonical label roster, ported from dotfiles' `labels.yml`. This is a
 * typed TS const (no YAML dependency) — colors are kept verbatim as 6-hex
 * strings without a leading `#` (external-contract: GitHub's REST label API).
 *
 * Per the ai-tools migration plan, only the cross-cutting roster carries over
 * here, plus the `discussion` and `tracking` meta labels. The dotfiles
 * `workflow`/`projects` sets — PR-Shepherd gate/verdict labels and per-app
 * domain families — are deliberately NOT included: nothing in ai-tools may know
 * about PR Shepherd's labels, and project-specific families live with their
 * projects.
 */

export interface LabelSpec {
  /** External-contract label name — kept verbatim. */
  name: string;
  /** 6-hex color, no leading `#` (REST requirement). */
  color: string;
  description: string;
  /** Prior name(s) this label was renamed from; rename-in-place preserves associations. */
  renamedFrom?: string[];
}

/**
 * Cross-cutting domain labels — applied to every repository (mirrors
 * `cross_cutting` in dotfiles' labels.yml).
 */
export const crossCuttingLabels: readonly LabelSpec[] = [
  {
    name: 'Auth',
    color: '6B7280',
    description: 'Authentication, authorization, and session management.',
  },
  {
    name: 'UI',
    color: '7C6FA5',
    description: 'User interface, visual design, and frontend components.',
  },
  {
    name: 'Security',
    color: 'A05757',
    description: 'Security vulnerabilities, hardening, and access controls.',
  },
  {
    name: 'Infrastructure',
    color: '6E8FA8',
    description: 'Hosting, environment configuration, and build tooling.',
  },
  {
    name: 'DevOps',
    color: '6B8F77',
    description: 'CI/CD pipelines, deployment automation, and developer tooling.',
  },
  {
    name: 'Observability',
    color: '8D8042',
    description: 'Logging, monitoring, alerting, and tracing.',
  },
  {
    name: 'Notifications',
    color: '8A6BA0',
    description: 'Push notifications, emails, in-app alerts, and messaging.',
  },
  {
    name: 'Profile',
    color: '9E8568',
    description: 'User profile management and account settings.',
  },
];

/**
 * Meta labels for the ai-tools ecosystem: `tracking` ledger issues (carried from
 * dotfiles' workflow set) and `discussion` issues (the `rmartz/ai` Discussions
 * hub) called out by the migration plan.
 */
export const metaLabels: readonly LabelSpec[] = [
  {
    name: 'tracking',
    color: '0E8A16',
    description: 'Long-lived ledger issue that aggregates occurrences of a recurring pattern.',
  },
  {
    name: 'discussion',
    color: 'A371F7',
    description: 'Cross-cutting agent knowledge and design discussion.',
  },
];

/** The full default roster `ensureLabels` reconciles when no extras are passed. */
export const defaultRoster: readonly LabelSpec[] = [...crossCuttingLabels, ...metaLabels];
