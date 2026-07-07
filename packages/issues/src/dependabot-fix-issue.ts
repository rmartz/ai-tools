import { createIssue, findOpenIssue } from '@rmartz/github';
import type { GhCallOptions } from '@rmartz/github';

/**
 * Create a tracking issue for a Dependabot PR whose CI fails because the bump
 * needs an accompanying **code change** the bot cannot make itself — a new lint
 * rule to satisfy, a renamed/removed API to migrate, a type annotation the
 * stricter types now demand, a compatibility shim. This module owns only the
 * authoring *judgment* (when a fix issue is warranted, what a good one says, and
 * dedup); the Dependabot *mechanics* (sweeping PRs, spawning fix PRs, rebasing,
 * merge arbitration) belong to PR Shepherd, never here.
 *
 * Extracted from dotfiles' `dependabot.md` fix-PR craft. It is runner-agnostic:
 * in direct-harness mode it writes via `@rmartz/github`; under PR Shepherd the
 * engine decides what to do with the returned verdict. Nothing here knows about
 * PR Shepherd's gate/verdict labels or the skill-outcome marker.
 */

/** The stable marker linking a fix issue back to its Dependabot PR. */
export const FIXES_DEPENDABOT_PREFIX = 'Fixes Dependabot PR #';

/**
 * Why a Dependabot bump needs a code change. Drives the body's guidance section.
 * `unknown` is the soft default when the caller has only the raw CI failure.
 */
export type FixCategory =
  'lint-rule' | 'type-error' | 'breaking-api' | 'compatibility-shim' | 'test-failure' | 'unknown';

export interface DependabotFixIssueInput {
  /** The Dependabot PR number that is red. */
  prNumber: number;
  /** Bumped package, e.g. `eslint`. */
  dependency: string;
  /** Version being moved to, e.g. `9.0.0`. Optional when unknown. */
  toVersion?: string;
  /** Version moved from, when known — lets the body show the full bump. */
  fromVersion?: string;
  /** Best-guess category of the required change; shapes the guidance. */
  category?: FixCategory;
  /** The failing CI check's name, e.g. `Lint`. */
  failingCheck?: string;
  /**
   * A short, relevant excerpt of the failure output (already trimmed by the
   * caller). Rendered verbatim in a fenced block so the implementer has the
   * exact error without re-running CI. Keep it to the load-bearing lines.
   */
  failureExcerpt?: string;
  /** Labels to apply. The caller owns label policy; none are implied here. */
  labels?: string[];
}

export interface DependabotFixIssue {
  title: string;
  body: string;
  labels: string[];
}

const CATEGORY_GUIDANCE: Record<FixCategory, string> = {
  'lint-rule':
    'The new version adds or tightens a lint rule. Fix the offending code so the rule passes — do **not** disable the rule to make CI green unless the rule is genuinely inapplicable, in which case justify the disable inline.',
  'type-error':
    'Stricter types from the new version surface a type error. Add or correct the annotations / narrowing the new types require; avoid `any` or `@ts-expect-error` escape hatches unless unavoidable.',
  'breaking-api':
    'The new version renamed, moved, or removed an API this code uses. Migrate the call sites to the new API per the upstream changelog / migration guide.',
  'compatibility-shim':
    'The new version needs a small compatibility adjustment (config shape, peer range, import path). Apply the minimal shim so the upgrade succeeds.',
  'test-failure':
    'The new version changes behavior an existing test asserts. Confirm whether the new behavior is correct; if so, update the test, otherwise fix the regression.',
  unknown:
    'Diagnose the failing check from the excerpt below before writing any fix, and confirm the failure is actually caused by the bump (not a flaky or infrastructure failure) before opening a fix PR.',
};

function bumpLine(input: DependabotFixIssueInput): string {
  const { dependency, fromVersion, toVersion } = input;
  if (fromVersion && toVersion) return `\`${dependency}\` ${fromVersion} → ${toVersion}`;
  if (toVersion) return `\`${dependency}\` → ${toVersion}`;
  return `\`${dependency}\``;
}

/**
 * Build the title and body for a Dependabot fix issue from structured input.
 * Pure: no I/O, so it is trivially unit-testable and reusable by both the
 * library entry point and any caller that wants to render without posting.
 */
export function buildDependabotFixIssue(input: DependabotFixIssueInput): DependabotFixIssue {
  const category = input.category ?? 'unknown';
  const title = `fix: resolve CI failure for Dependabot #${input.prNumber} (${input.dependency})`;

  const lines: string[] = [];
  lines.push(`${FIXES_DEPENDABOT_PREFIX}${input.prNumber}`);
  lines.push('');
  lines.push(
    `Dependabot opened PR #${input.prNumber} bumping ${bumpLine(input)}, but CI is red: the ` +
      `upgrade needs an accompanying code change Dependabot cannot make itself.`,
  );
  lines.push('');
  lines.push('## What to do');
  lines.push('');
  lines.push(CATEGORY_GUIDANCE[category]);
  lines.push('');
  lines.push(
    'Make the fix on its own branch and open a PR whose body contains the line ' +
      `\`${FIXES_DEPENDABOT_PREFIX}${input.prNumber}\` so the change links back to the bump. ` +
      '**Do not edit `package.json` or the lockfile** — only application code; let Dependabot own the version bump.',
  );

  if (input.failingCheck) {
    lines.push('');
    lines.push(`## Failing check: \`${input.failingCheck}\``);
  }
  if (input.failureExcerpt?.trim()) {
    lines.push('');
    lines.push('```');
    lines.push(input.failureExcerpt.trim());
    lines.push('```');
  }

  lines.push('');
  lines.push('## Acceptance criteria');
  lines.push('');
  lines.push(`- [ ] Root cause of the CI failure on PR #${input.prNumber} identified`);
  lines.push('- [ ] Fix applied to application code only (no manifest/lockfile edits)');
  lines.push('- [ ] Local verification (lint / typecheck / test) passes');
  lines.push(`- [ ] Fix PR opened linking back to Dependabot PR #${input.prNumber}`);

  return { title, body: lines.join('\n'), labels: input.labels ?? [] };
}

export interface CreateDependabotFixIssueOptions {
  /** When true, skip the open-issue dedup search (caller already checked). */
  skipDedup?: boolean;
  call?: GhCallOptions;
}

export interface CreateDependabotFixIssueResult {
  /** New issue URL on creation; existing issue URL when deduped; `null` on failure. */
  url: string | null;
  /** `created` | `existing` (a matching open fix issue was found) | `failed`. */
  outcome: 'created' | 'existing' | 'failed';
}

/**
 * Create a Dependabot fix issue, deduping against an already-open one. Dedup
 * keys off the `Fixes Dependabot PR #<N>` line in the title-less body is not
 * searchable client-side, so we dedup on the title's stable `Dependabot #<N>`
 * fragment via `findOpenIssue`'s exact-substring match. Soft-fails to `null`.
 */
export async function createDependabotFixIssue(
  repo: string,
  input: DependabotFixIssueInput,
  opts: CreateDependabotFixIssueOptions = {},
): Promise<CreateDependabotFixIssueResult> {
  const issue = buildDependabotFixIssue(input);

  if (!opts.skipDedup) {
    const existing = await findOpenIssue(
      repo,
      { titleContains: `Dependabot #${input.prNumber}` },
      opts.call ?? {},
    );
    if (existing) return { url: existing, outcome: 'existing' };
  }

  const url = await createIssue(
    repo,
    { title: issue.title, body: issue.body, labels: issue.labels },
    opts.call ?? {},
  );
  return url ? { url, outcome: 'created' } : { url: null, outcome: 'failed' };
}
