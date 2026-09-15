import { ghCall, resolveRepoTarget, type RepoTargetOptions } from '@rmartz/github';

/**
 * Confirm (and optionally apply) the squash-merge commit-message convention that
 * carries a PR's *conventional* title onto `main`. Network-touching, so it lives
 * here alongside `verify-automerge-gate` rather than in the hermetic writers.
 *
 * The hazard this closes: a repo whose squash-merge default is not "PR title"
 * squashes using the branch **commit message** (plain, per the "no Conventional
 * Commits within a feature branch" rule) instead of the conventional PR **title**.
 * release-please only releases conventional commits, so a non-conventional subject
 * on `main` is **silently skipped** — the exact failure that dropped four releases
 * (#214–#217). Setting the repo default to `PR_TITLE` + `PR_BODY` makes the
 * conventional title the thing that lands. `pr-title-lint` validates titles
 * pre-merge; this confirms the title actually reaches `main`.
 */

/** Squash-merge commit-title source that carries the conventional PR title to `main`. */
const DESIRED_SQUASH_TITLE = 'PR_TITLE';
/** The paired commit-message body source. */
const DESIRED_SQUASH_MESSAGE = 'PR_BODY';

export interface VerifySquashMergeSettingOptions extends RepoTargetOptions {
  /** Opt-in, state-changing: PATCH the repo defaults to PR_TITLE + PR_BODY. */
  apply?: boolean;
}

export interface VerifySquashMergeSettingResult {
  repo: string;
  /** The repo's current `squash_merge_commit_title` (null if unreadable). */
  squashTitle: string | null;
  /** The repo's current `squash_merge_commit_message` (null if unreadable). */
  squashMessage: string | null;
  /** The title source this convention requires (`PR_TITLE`). */
  desiredTitle: string;
  /** The message source this convention requires (`PR_BODY`). */
  desiredMessage: string;
  /** Title is `PR_TITLE` AND message is `PR_BODY`. */
  satisfied: boolean;
  /** Whether `--apply` mutated repo state during this run. */
  applied: boolean;
}

interface RepoSquashSettings {
  title?: string | null;
  message?: string | null;
}

/** Read the repo's two squash-merge commit-source fields in one API call. */
async function readSquashSettings(
  repo: string,
  opts: RepoTargetOptions,
): Promise<RepoSquashSettings> {
  const out = await ghCall(
    {
      argv: [
        'gh',
        'api',
        `repos/${repo}`,
        '--jq',
        '{title:.squash_merge_commit_title,message:.squash_merge_commit_message}',
      ],
    },
    null,
    opts,
  );
  if (out === null) return {};
  try {
    return JSON.parse(out) as RepoSquashSettings;
  } catch {
    return {};
  }
}

/** PATCH the repo defaults to the required sources; a failed write throws. */
async function applySquashSettings(repo: string, opts: RepoTargetOptions): Promise<void> {
  const out = await ghCall(
    {
      argv: [
        'gh',
        'api',
        '--method',
        'PATCH',
        `repos/${repo}`,
        '-f',
        `squash_merge_commit_title=${DESIRED_SQUASH_TITLE}`,
        '-f',
        `squash_merge_commit_message=${DESIRED_SQUASH_MESSAGE}`,
      ],
    },
    null,
    opts,
  );
  if (out === null) throw new Error(`failed to set the squash-merge commit setting on ${repo}`);
}

function isSatisfied(s: RepoSquashSettings): boolean {
  return s.title === DESIRED_SQUASH_TITLE && s.message === DESIRED_SQUASH_MESSAGE;
}

/**
 * Confirm the squash-merge commit convention on a repo; with `apply`, bring it
 * into the required state. Returns the observed (post-apply, if applied) state.
 * `satisfied === false` is the signal the `/bootstrap` skill blocks on.
 */
export async function verifySquashMergeSetting(
  opts: VerifySquashMergeSettingOptions = {},
): Promise<VerifySquashMergeSettingResult> {
  const repo = await resolveRepoTarget(opts);
  if (!repo) throw new Error('could not determine repo (pass --repo or run in a repo checkout)');

  let settings = await readSquashSettings(repo, opts);
  let applied = false;
  if (opts.apply && !isSatisfied(settings)) {
    await applySquashSettings(repo, opts);
    applied = true;
    settings = { title: DESIRED_SQUASH_TITLE, message: DESIRED_SQUASH_MESSAGE };
  }

  return {
    repo,
    squashTitle: settings.title ?? null,
    squashMessage: settings.message ?? null,
    desiredTitle: DESIRED_SQUASH_TITLE,
    desiredMessage: DESIRED_SQUASH_MESSAGE,
    satisfied: isSatisfied(settings),
    applied,
  };
}
