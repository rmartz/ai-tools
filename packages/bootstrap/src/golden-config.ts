/**
 * Golden-state config contents for a pnpm/TypeScript monorepo. This is the data
 * half of `ensure-project-config`; the logic halves (`ensure-project-config.ts`
 * for ignore blocks, `ensure-workflow-files.ts` for whole files) stay small by
 * keeping the file *contents* here.
 *
 * Two categories, two idempotency strategies:
 *
 * - **Ignore files** (`.prettierignore` / `.eslintignore` / `.gitignore`) — a
 *   fenced marker block spliced into a possibly user-authored file. We ensure the
 *   block is present and leave lines outside it untouched: "ensure block present,
 *   don't clobber user content". Reframe of dotfiles' `ensure_project_config.py`,
 *   which appended a single `.git-worktrees` line plus an `eslint.config.js`
 *   array-splice; here the stack is pnpm + TS, so the ignores cover the TS
 *   build/test artifacts (`dist`, `.turbo`, `*.tsbuildinfo`, `coverage`) and
 *   `node_modules`. The `.git-worktrees/` dir is deliberately *not* seeded: the
 *   worktree layout is a per-developer process choice, so it belongs in the
 *   developer's global `core.excludesFile`, never in each repo's tree.
 * - **Whole workflow files** (`.github/workflows/*.yml`) — a whole managed file,
 *   not a block spliced into user content. A GitHub Actions workflow that is
 *   identical across every repo (zero project-specific logic) is a
 *   copy-distribution candidate: write it if absent, overwrite it if it has
 *   drifted from the golden template, and leave it alone if a *user-authored*
 *   file (one without our managed header) already sits at that path. See
 *   `ensure-workflow-files.ts`.
 */

import {
  DEPENDABOT_AUTO_MERGE,
  MERGE_SAFETY,
  DEPENDABOT_CONFIG,
  REPO_HYGIENE,
  COMMIT_CONVENTION,
  GOLDEN_SYNC,
} from './golden-workflows.js';

/** Sentinel lines bracketing the managed region in every ignore file. */
export const BLOCK_BEGIN = '# >>> ai-tools managed (ensure-project-config) >>>';
export const BLOCK_END = '# <<< ai-tools managed (ensure-project-config) <<<';

export interface GoldenIgnoreFile {
  /** Repo-root-relative filename. */
  filename: string;
  /** Ignore entries the managed block should contain, in order. */
  entries: string[];
}

/** Build artifacts and vendored deps a TS monorepo should never format/lint/commit. */
const TS_ARTIFACTS = ['node_modules/', 'dist/', '.turbo/', '*.tsbuildinfo', 'coverage/'];

/**
 * The golden ignore files for a pnpm/TS monorepo:
 *
 * - `.prettierignore` — skip build output and vendored deps.
 * - `.eslintignore` — same; honored by flat config via `--ignore-path` and the
 *   universal fallback when an `eslint.config.*` ignores array can't be edited safely.
 * - `.gitignore` — keep artifacts untracked.
 *
 * `.git-worktrees/` is intentionally absent — it is a per-developer global-excludes
 * concern, not a repo property (see the file header). Because the managed block is
 * regenerated from these entries on every run, dropping it here also strips the
 * stale line from any repo that a prior version seeded.
 */
export const goldenIgnoreFiles: readonly GoldenIgnoreFile[] = [
  { filename: '.prettierignore', entries: [...TS_ARTIFACTS] },
  { filename: '.eslintignore', entries: [...TS_ARTIFACTS] },
  { filename: '.gitignore', entries: [...TS_ARTIFACTS, '.DS_Store'] },
];

/**
 * Substring that marks a workflow file as bootstrap-managed. Its presence is the
 * signal `ensure-workflow-files` uses to decide it may overwrite a drifted file:
 * a file *without* this marker is user-authored and is left untouched.
 */
export const WORKFLOW_MANAGED_MARKER = 'ai-tools managed (ensure-project-config)';

/** Header prepended to every managed workflow file, carrying {@link WORKFLOW_MANAGED_MARKER}. */
export const WORKFLOW_MANAGED_HEADER = [
  `# >>> ${WORKFLOW_MANAGED_MARKER} — do not edit by hand >>>`,
  '# Source of truth: @rmartz/bootstrap golden workflow files. Re-run the',
  '# /bootstrap skill (ai-ensure-project-config) to re-sync; local edits are lost.',
].join('\n');

export interface GoldenWorkflowFile {
  /** Repo-root-relative path, e.g. `.github/workflows/dependabot-auto-merge.yml`. */
  filename: string;
  /**
   * The golden file body, verbatim, *without* the managed header — the header is
   * prepended at write time so the marker can't be forgotten.
   */
  content: string;
  /**
   * Required status-check contexts that GitHub-native auto-merge in this file
   * depends on. Consumed by the (separate, network-touching) auto-merge gate
   * verifier — never by the hermetic writer — but co-located here so the file and
   * the gate it needs travel together.
   */
  gateChecks: readonly string[];
  /**
   * Idempotency policy for the file:
   * - `manage` (default) — a fully bootstrap-owned file: write if absent,
   *   overwrite if it has drifted from the golden template, guarded by the managed
   *   header so a user-authored file at the path is never clobbered.
   * - `seed` — a *starting point* the repo then owns: write it (no managed header)
   *   only if absent, and never touch it again once present. For files repos are
   *   expected to customize (`.github/dependabot.yml`), where overwriting local
   *   edits on every bootstrap would be wrong.
   */
  policy?: 'manage' | 'seed';
}

/**
 * Golden whole files distributed to every repo. Two idempotency policies (see
 * {@link GoldenWorkflowFile.policy}): `manage` (bootstrap-owned, overwrite drift)
 * for the workflows, `seed` (write-once, repo-owned) for the Dependabot config.
 *
 * - `dependabot-auto-merge.yml` (`manage`) — GitHub-native auto-merge for green
 *   patch/minor Dependabot PRs. Depends on `merge-safety` being a *required* check
 *   — the gate the auto-merge verifier confirms before the file may be seeded (an
 *   ungated `gh pr merge --auto` merges *immediately*, so it must never land
 *   without the gate).
 * - `merge-safety.yml` (`manage`) — posts the advisory `merge-safety` check
 *   (consumer shape, installs `@rmartz/pr-review`). No `gateChecks` of its own: it
 *   *provides* the check the auto-merge file depends on rather than consuming one.
 * - `.github/dependabot.yml` (`seed`) — a starting Dependabot config the repo then
 *   owns; bootstrap writes it only if absent and never overwrites local edits.
 * - `repo-hygiene.yml` (`manage`) — runs the universally-safe `action-pins` check
 *   via the published `@rmartz/repo-hygiene` CLI. Advisory; `gateChecks: []`.
 * - `commit-convention.yml` (`manage`) — post-merge `push: [main]` tripwire that
 *   fails when a non-conventional subject reaches the default branch. Alerts (the
 *   commit is already merged), so `gateChecks: []`.
 * - `golden-sync.yml` (`manage`) — the self-update loop (#233): a scheduled job
 *   that re-runs `ai-ensure-project-config` against the latest `@rmartz/bootstrap`
 *   and opens a PR only when a managed file drifted, so golden updates reach the
 *   fleet with no manual re-bootstrap. `gateChecks: []`.
 */
export const goldenWorkflowFiles: readonly GoldenWorkflowFile[] = [
  {
    filename: '.github/workflows/dependabot-auto-merge.yml',
    content: DEPENDABOT_AUTO_MERGE,
    gateChecks: ['merge-safety'],
  },
  {
    filename: '.github/workflows/merge-safety.yml',
    content: MERGE_SAFETY,
    gateChecks: [],
  },
  {
    filename: '.github/dependabot.yml',
    content: DEPENDABOT_CONFIG,
    gateChecks: [],
    policy: 'seed',
  },
  {
    filename: '.github/workflows/repo-hygiene.yml',
    content: REPO_HYGIENE,
    gateChecks: [],
  },
  {
    filename: '.github/workflows/commit-convention.yml',
    content: COMMIT_CONVENTION,
    gateChecks: [],
  },
  {
    filename: '.github/workflows/golden-sync.yml',
    content: GOLDEN_SYNC,
    gateChecks: [],
  },
];

/**
 * The **cross-repo floor** of the auto-merge gate: the union of every golden
 * workflow's `gateChecks` (currently just `merge-safety`), the one member present
 * in any repo that runs the golden workflows.
 *
 * This is a floor, **not** a sufficient gate. GitHub-native auto-merge waits only
 * on *required* checks and ignores non-required ones, so requiring `merge-safety`
 * alone would still let a bump that breaks a *non-required* Test/Build auto-merge.
 * A safe gate additionally requires the repo's substantive CI checks (typecheck /
 * lint / format / build / test / PR-title, by whatever names that repo uses) —
 * which are repo-specific and so are supplied per repo via the verifier's
 * `--check` flags, not hardcoded here.
 */
export const goldenGateChecks: readonly string[] = [
  ...new Set(goldenWorkflowFiles.flatMap((w) => w.gateChecks)),
];
