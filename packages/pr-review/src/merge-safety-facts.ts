/**
 * Fact-gathering for {@link evaluateMergeSafety}. Impure — it shells to `git` —
 * but the subprocess is injected as a {@link GitRunner}, so the assembly logic is
 * unit-testable with a fake and the bin wires the real runner. All *judgment*
 * stays in the pure `merge-safety` module; this file only turns `git` output into
 * the boolean facts that module consumes.
 */
import { boundedRun } from '@rmartz/agent-runtime';
import {
  hasFileOverlap,
  isBreakingCommitMessage,
  isBreakingTitle,
  isCiCommitMessage,
  type MergeSafetyFacts,
} from './merge-safety.js';

/** Runs a `git` argv and yields stdout, or `null` on non-zero exit / failure. */
export type GitRunner = (args: string[]) => Promise<string | null>;

const GIT_TIMEOUT_MS = 30_000;

/** The real `git` runner, bounded and rooted at `cwd`. */
export function makeGitRunner(cwd?: string): GitRunner {
  return async (args) => {
    const r = await boundedRun('git', args, { timeoutMs: GIT_TIMEOUT_MS, cwd });
    return r.code === 0 ? r.stdout : null;
  };
}

/** PR metadata the gatherer needs beyond what git derives (from `gh pr view --json`). */
export interface PrMergeMeta {
  headSha: string;
  title: string;
  labels: readonly string[];
  /** `gh`'s `mergeable`: `MERGEABLE` | `CONFLICTING` | `UNKNOWN`. */
  mergeable: string;
}

export interface GatherOptions {
  /** Base branch ref to compare against (default `origin/main`). */
  baseRef?: string;
  git: GitRunner;
}

/** The `breaking change` label forces `prIsBreaking` regardless of the title. */
const BREAKING_LABEL = 'breaking change';

function splitLines(out: string | null): string[] {
  return (out ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

/**
 * Assemble {@link MergeSafetyFacts} for one PR. Throws when the merge-base or base
 * tip can't be resolved — the caller must treat an ungatherable PR as unsafe
 * (fail the check) rather than let a stale green through.
 */
export async function gatherMergeSafetyFacts(
  meta: PrMergeMeta,
  { baseRef = 'origin/main', git }: GatherOptions,
): Promise<MergeSafetyFacts> {
  const mergeBase = (await git(['merge-base', meta.headSha, baseRef]))?.trim();
  const baseTip = (await git(['rev-parse', baseRef]))?.trim();
  if (!mergeBase || !baseTip) {
    throw new Error(`could not resolve merge-base/base tip for ${meta.headSha}..${baseRef}`);
  }

  const isCurrent = mergeBase === baseTip;

  // NUL-delimit commit bodies so multi-line messages split cleanly.
  const logOut = (await git(['log', '-z', '--format=%B', `${mergeBase}..${baseRef}`])) ?? '';
  const messages = logOut
    .split('\0')
    .map((m) => m.trim())
    .filter(Boolean);

  const baseFiles = splitLines(await git(['diff', '--name-only', mergeBase, baseRef]));
  const prFiles = splitLines(await git(['diff', '--name-only', mergeBase, meta.headSha]));

  const labels = meta.labels.map((l) => l.toLowerCase());

  return {
    isCurrent,
    baseBreakingSinceMergeBase: messages.some(isBreakingCommitMessage),
    baseCiSinceMergeBase: messages.some(isCiCommitMessage),
    prIsBreaking: isBreakingTitle(meta.title) || labels.includes(BREAKING_LABEL),
    fileOverlap: hasFileOverlap(prFiles, baseFiles),
    hasConflict: meta.mergeable.toUpperCase() === 'CONFLICTING',
  };
}
