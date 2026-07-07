/**
 * Dependabot risk *judgment* — the high-risk-vs-safe heuristic lifted from
 * dotfiles' `dependabot.md` review fast path (Step 2 of `review.md`'s Dependabot
 * branch). Pure and side-effect-free: it classifies a single Dependabot PR into a
 * risk level with human-readable reasons, so the review skill (or any caller) can
 * decide whether to wave the bump through or flag a concern.
 *
 * It deliberately knows nothing about PR Shepherd's gate/verdict labels, posting,
 * or the outcome marker — it produces a verdict-shaped *assessment*, and the
 * caller maps that onto whatever emission channel it owns. This is review craft,
 * not coordination.
 *
 * The criteria mirror the dotfiles directive: skip code-quality/style/convention
 * checks (they don't apply to automated bumps) and flag only what tests are
 * unlikely to catch — semver-major bumps with breaking API surface, ecosystem
 * shifts that can silently break the build (e.g. CJS→ESM), and known-sensitive
 * tooling. Lockfile-only and minor/patch bumps are safe by default.
 */

export type DependabotRiskLevel = 'safe' | 'review' | 'high';

/** A parsed Dependabot bump: what changed, from which version to which. */
export interface DependabotBump {
  /** Package / dependency name, e.g. `react`, `actions/checkout`. */
  name: string;
  /** Semver (or action-tag) the bump moves away from, when known. */
  fromVersion?: string;
  /** Semver (or action-tag) the bump moves to, when known. */
  toVersion?: string;
  /**
   * Dependabot ecosystem marker (`npm_and_yarn`, `github_actions`, `pip`, …).
   * Drives ecosystem-specific judgment (workflow PRs, CJS/ESM churn).
   */
  ecosystem?: string;
  /**
   * True when the diff touches only the lockfile (`pnpm-lock.yaml`,
   * `package-lock.json`, `yarn.lock`) and no `package.json` / source — a
   * transitive resolution refresh with no first-party API surface change.
   */
  lockfileOnly?: boolean;
  /** True when this is a dev-dependency bump (`chore(deps-dev)`). */
  devDependency?: boolean;
}

export interface DependabotRiskAssessment {
  level: DependabotRiskLevel;
  /** One line per signal that informed the level — ordered most→least severe. */
  reasons: string[];
  /** The semver class of the bump, when both versions parsed. */
  semverChange?: SemverChange;
}

export type SemverChange = 'major' | 'minor' | 'patch' | 'none' | 'unknown';

/** Tooling whose version is CI-sensitive — a bump can break lint/format/type CI. */
const CI_SENSITIVE_TOOLS = new Set([
  'black',
  'ruff',
  'eslint',
  'pylint',
  'prettier',
  'typescript',
  'mypy',
  'flake8',
]);

interface Semver {
  major: number;
  minor: number;
  patch: number;
}

/** Parse a semver-ish string (leading `v`, `^`, `~`, `=` tolerated), or `null`. */
function parseSemver(raw: string | undefined): Semver | null {
  if (!raw) return null;
  const m = raw.trim().match(/(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  const patch = Number(m[3]);
  if ([major, minor, patch].some(Number.isNaN)) return null;
  return { major, minor, patch };
}

/** Classify the semver delta between two versions. */
export function classifySemverChange(
  fromVersion: string | undefined,
  toVersion: string | undefined,
): SemverChange {
  const from = parseSemver(fromVersion);
  const to = parseSemver(toVersion);
  if (!from || !to) return 'unknown';
  if (to.major !== from.major) return 'major';
  if (to.minor !== from.minor) return 'minor';
  if (to.patch !== from.patch) return 'patch';
  return 'none';
}

function normalizeName(name: string): string {
  // Strip an npm scope (`@org/black` → `black`) before the CI-tool check.
  const slash = name.lastIndexOf('/');
  return (slash >= 0 ? name.slice(slash + 1) : name).toLowerCase();
}

/**
 * Classify a Dependabot bump into a risk level with reasons. Pure — no I/O.
 *
 * - `high`: a semver-**major** bump (breaking API surface tests can't catch), or
 *   a major bump of CI-sensitive tooling (a stricter linter/formatter can fail
 *   CI on unrelated files). These warrant a human-readable concern, not a
 *   silent approve.
 * - `review`: signals worth a glance but not a block — a `github_actions`
 *   workflow bump (cannot be merged by an automation lacking the `workflows`
 *   OAuth scope), or any minor bump of CI-sensitive tooling.
 * - `safe`: lockfile-only refreshes and ordinary minor/patch bumps — exactly the
 *   mechanical updates the dotfiles fast path approves without manual testing.
 */
export function assessDependabotRisk(bump: DependabotBump): DependabotRiskAssessment {
  const reasons: string[] = [];
  const semverChange = classifySemverChange(bump.fromVersion, bump.toVersion);
  const tool = normalizeName(bump.name);
  const ciSensitive = CI_SENSITIVE_TOOLS.has(tool);
  const isWorkflow = bump.ecosystem === 'github_actions';

  let level: DependabotRiskLevel = 'safe';
  const escalate = (to: DependabotRiskLevel) => {
    const order: DependabotRiskLevel[] = ['safe', 'review', 'high'];
    if (order.indexOf(to) > order.indexOf(level)) level = to;
  };

  if (semverChange === 'major') {
    escalate('high');
    reasons.push(
      `Major version bump (${bump.fromVersion ?? '?'} → ${bump.toVersion ?? '?'}) of ` +
        `${bump.name} — review the changelog for breaking API changes automated tests may miss.`,
    );
    if (ciSensitive) {
      reasons.push(
        `${tool} is CI-sensitive: a major bump can introduce stricter lint/format/type ` +
          'rules that fail CI on files this PR does not touch.',
      );
    }
  } else if (ciSensitive && (semverChange === 'minor' || semverChange === 'unknown')) {
    escalate('review');
    reasons.push(
      `${tool} is CI-sensitive tooling; even a minor bump can change lint/format/type ` +
        'output — confirm CI is green on the new version before merging.',
    );
  }

  if (isWorkflow) {
    escalate('review');
    reasons.push(
      'Touches a GitHub Actions workflow (`github_actions`); an automation lacking the ' +
        '`workflows` OAuth scope cannot merge it — surface for manual merge.',
    );
  }

  if (bump.lockfileOnly && level === 'safe') {
    reasons.push('Lockfile-only transitive refresh — no first-party API surface change.');
  }

  if (level === 'safe' && reasons.length === 0) {
    const label =
      semverChange === 'unknown'
        ? 'version bump'
        : `${semverChange} bump${bump.devDependency ? ' (dev dependency)' : ''}`;
    reasons.push(`Routine ${label} — no breaking-change, ecosystem, or CI-tooling signal.`);
  }

  return { level, reasons, semverChange };
}

// ── Trust-but-verify: reconcile the claimed bump against the diff ──────────────

/** A version change read from a PR diff for a specific dependency. */
export interface DiffBump {
  fromVersion?: string;
  toVersion?: string;
}

/**
 * True when both versions parse to the same `major.minor.patch`. Conservative: an
 * unparseable side returns `true`, so an unknown never manufactures a mismatch.
 */
function sameSemver(a: string | undefined, b: string | undefined): boolean {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return true;
  return pa.major === pb.major && pa.minor === pb.minor && pa.patch === pb.patch;
}

/**
 * Read the actual from/to version of `name` from a unified diff — the source of
 * truth for a Dependabot bump. Scans removed (`-`) / added (`+`) `package.json`
 * dependency lines (`"name": "^x.y.z"`), tolerating a leading range operator or
 * `v`. Returns whichever ends it finds; `{}` when the diff doesn't pin the version
 * (e.g. a lockfile-only refresh), which the caller reads as "cannot verify".
 */
export function parseBumpFromDiff(diff: string, name: string): DiffBump {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`"${esc}"\\s*:\\s*"[~^>=v\\s]*(\\d+\\.\\d+\\.\\d+)`);
  const result: DiffBump = {};
  for (const line of diff.split('\n')) {
    if (line.startsWith('-') && !line.startsWith('---')) {
      const m = re.exec(line.slice(1));
      if (m && result.fromVersion === undefined) result.fromVersion = m[1];
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      const m = re.exec(line.slice(1));
      if (m && result.toVersion === undefined) result.toVersion = m[1];
    }
  }
  return result;
}

export interface BumpVerification extends DiffBump {
  /** True when the title/description's claimed bump disagrees with the diff. */
  titleMisstated: boolean;
  /** A one-line explanation when misstated, for the reviewer to surface and act on. */
  note?: string;
}

/**
 * Trust-but-verify a Dependabot PR: reconcile the bump **claimed** by its
 * title/description against the **actual** version change in the diff. Dependabot
 * has been observed to misstate the from-version (envctl#27: the title said
 * `3.9.1 → 3.9.4`, the diff was `3.8.4 → 3.9.4`), which understates the semver
 * delta — and so the risk `assessDependabotRisk` would compute. Returns the
 * diff-derived versions (the ones to assess and to re-title the PR from) plus a
 * flag and note when the claim disagrees. When the diff doesn't pin the version
 * (so nothing can be verified), nothing is flagged.
 */
export function verifyDependabotBump(
  name: string,
  diff: string,
  claimed: DiffBump,
): BumpVerification {
  const actual = parseBumpFromDiff(diff, name);
  const misstated =
    !sameSemver(claimed.fromVersion, actual.fromVersion) ||
    !sameSemver(claimed.toVersion, actual.toVersion);
  if (!misstated) return { ...actual, titleMisstated: false };
  const claim = `${claimed.fromVersion ?? '?'} → ${claimed.toVersion ?? '?'}`;
  const real = `${actual.fromVersion ?? '?'} → ${actual.toVersion ?? '?'}`;
  return {
    ...actual,
    titleMisstated: true,
    note:
      `Dependabot's title/description claims ${name} ${claim}, but the diff shows ` +
      `${real}. Assess risk and re-title the PR from the diff — the true delta is ` +
      `larger, so the bump carries more risk than the title implies.`,
  };
}
