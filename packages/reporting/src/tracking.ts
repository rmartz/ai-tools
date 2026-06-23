import {
  findOpenIssue,
  createIssue,
  addIssueComment,
  currentRepo,
  type GhCallOptions,
} from '@rmartz/github';
import { boundedRun } from '@rmartz/agent-runtime';

/**
 * Shared tracking-issue ledger: find-or-create-or-append for long-lived issues
 * that aggregate recurring occurrences of a pattern into one GitHub issue rather
 * than filing a new issue per event.
 *
 * Two things are standardized so every reporter behaves identically:
 *
 * - **Create-when-missing lives here.** {@link reportToTracking} appends to the
 *   open ledger with the given title, or creates it on first occurrence. Callers
 *   never pre-create or recreate the issue; the next occurrence recreates it
 *   lazily once a fix PR has closed it.
 * - **Standardized occurrence metadata.** Every appended comment (and the
 *   first-occurrence body) carries a header identifying the source repository,
 *   the coordinator git sha, the dispatching skill, the PR, the agent transcript
 *   id, and any skill comment metadata — each field only when available.
 *
 * Ledgers default to the central **`rmartz/ai-reports`** repo (overridable via
 * `repo`). TS port of dotfiles' `tracking_issues.py` + `report-to-tracking.py`,
 * composed over the layer-0 `@rmartz/github` issue ops.
 */

/** Default ledger repo. Tracking issues live in a central reports repo. */
export const DEFAULT_TRACKING_REPO = 'rmartz/ai-reports';

/** The label every tracking ledger carries (external GitHub contract string). */
export const TRACKING_LABEL = 'tracking';

/** Fields composed into the standardized occurrence metadata header. */
export interface OccurrenceMeta {
  /** The source repo the occurrence is **about** (often differs from the ledger repo). */
  sourceRepo?: string;
  /** Coordinator git sha — the commit the running scripts execute at. */
  coordinatorSha?: string;
  /** Dispatching skill (e.g. `/review`). */
  skill?: string;
  /** PR number the occurrence relates to. */
  pr?: string | number;
  /** Agent transcript / session id. */
  transcriptId?: string;
  /** Skill comment metadata marker. */
  skillMeta?: string;
}

/**
 * Prepend the standardized metadata header to a tracking occurrence body. Each
 * field renders only when provided, so a reporter that knows only the repository
 * still produces a clean header. Returns `body` unchanged when no metadata is
 * available at all. Header keys are the external-contract strings the ledger
 * readers expect, so they are spelled verbatim.
 */
export function formatOccurrence(body: string, meta: OccurrenceMeta = {}): string {
  const header: string[] = [];
  if (meta.sourceRepo) header.push(`**Repository:** \`${meta.sourceRepo}\``);
  if (meta.coordinatorSha) header.push(`**Coordinator:** \`${meta.coordinatorSha}\``);
  if (meta.skill) header.push(`**Skill:** \`${meta.skill}\``);
  if (meta.pr !== undefined && meta.pr !== '') {
    const prRef = meta.sourceRepo ? `${meta.sourceRepo}#${meta.pr}` : `#${meta.pr}`;
    header.push(`**PR:** ${prRef}`);
  }
  if (meta.transcriptId) header.push(`**Transcript:** \`${meta.transcriptId}\``);
  if (meta.skillMeta) header.push(`**Skill metadata:** \`${meta.skillMeta}\``);
  if (header.length === 0) return body;
  return `${header.join('\n')}\n\n${body}`;
}

let coordinatorShaCache: string | null | undefined;

/**
 * Short HEAD sha of the checkout these scripts run from — the "coordinator
 * version". Cached for the process lifetime (constant while a run lives).
 * Best-effort: resolves to `null` if git is unavailable or the call fails, so it
 * never blocks a report. `cwd` defaults to the current working directory.
 */
export async function coordinatorGitSha(cwd?: string): Promise<string | null> {
  if (coordinatorShaCache !== undefined) return coordinatorShaCache;
  try {
    const result = await boundedRun('git', ['rev-parse', '--short', 'HEAD'], {
      timeoutMs: 15_000,
      cwd,
    });
    coordinatorShaCache = result.code === 0 ? result.stdout.trim() || null : null;
  } catch {
    coordinatorShaCache = null;
  }
  return coordinatorShaCache;
}

/** Reset the cached coordinator sha. Test-only seam. */
export function resetCoordinatorShaCache(): void {
  coordinatorShaCache = undefined;
}

export interface ReportToTrackingOptions extends OccurrenceMeta {
  /** Ledger repo where the tracking issue lives. Defaults to {@link DEFAULT_TRACKING_REPO}. */
  repo?: string;
  /** The `tracking`-style label gating the ledger lookup/create. Defaults to {@link TRACKING_LABEL}. */
  label?: string;
  /** Additional labels applied when the ledger is first created. */
  extraLabels?: string[];
  /** Working directory used to resolve `sourceRepo` / `coordinatorSha` when omitted. */
  cwd?: string;
  /** gh-call injection seam (transport/sleep) forwarded to the underlying ops. */
  call?: GhCallOptions;
}

/**
 * Find-or-create-or-append one occurrence against a tracking ledger.
 *
 * Searches for an open issue with the exact `title` and the tracking label; if
 * found, appends the metadata-wrapped body as a comment, otherwise creates the
 * ledger with that body and label. `sourceRepo` defaults to the repo resolved
 * from `cwd`, and `coordinatorSha` to {@link coordinatorGitSha}, when omitted.
 *
 * Returns the ledger issue URL, or `null` on failure (soft-fail, mirroring the
 * underlying `@rmartz/github` ops).
 */
export async function reportToTracking(
  title: string,
  body: string,
  opts: ReportToTrackingOptions = {},
): Promise<string | null> {
  const repo = opts.repo ?? DEFAULT_TRACKING_REPO;
  const label = opts.label ?? TRACKING_LABEL;
  const call = opts.call ?? {};

  const sourceRepo = opts.sourceRepo ?? (await currentRepo(call)) ?? undefined;
  const coordinatorSha = opts.coordinatorSha ?? (await coordinatorGitSha(opts.cwd)) ?? undefined;

  const fullBody = formatOccurrence(body, {
    sourceRepo,
    coordinatorSha,
    skill: opts.skill,
    pr: opts.pr,
    transcriptId: opts.transcriptId,
    skillMeta: opts.skillMeta,
  });

  const existingUrl = await findOpenIssue(repo, { titleEquals: title, label }, call);
  if (existingUrl) {
    await addIssueComment(repo, existingUrl, fullBody, call);
    return existingUrl;
  }

  const labels = [label, ...(opts.extraLabels ?? [])];
  return createIssue(repo, { title, body: fullBody, labels }, call);
}
