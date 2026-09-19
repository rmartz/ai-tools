/**
 * Golden-state config contents for a pnpm/TypeScript monorepo. This is the data
 * half of `ensure-project-config`; the logic halves (`ensure-project-config.ts`
 * for ignore blocks, `ensure-workflow-files.ts` for whole files) stay small by
 * keeping the file *contents* here.
 *
 * Two categories, two idempotency strategies:
 *
 * - **Ignore files** (`.prettierignore` / `.gitignore`) — a fenced marker block
 *   spliced into a possibly user-authored file. We ensure the block is present and
 *   leave lines outside it untouched: "ensure block present, don't clobber user
 *   content". Reframe of dotfiles' `ensure_project_config.py`, which appended a
 *   single `.git-worktrees` line plus an `eslint.config.js` array-splice; here the
 *   stack is pnpm + TS, so the ignores cover the TS build/test artifacts (`dist`,
 *   `.turbo`, `*.tsbuildinfo`, `coverage`) and `node_modules`. The `.git-worktrees/`
 *   dir is deliberately *not* seeded: the worktree layout is a per-developer
 *   process choice, so it belongs in the developer's global `core.excludesFile`,
 *   never in each repo's tree. `.eslintignore` is deliberately **retired**, not
 *   seeded (see {@link retiredIgnoreFiles}).
 * - **Whole workflow files** (`.github/workflows/*.yml`) — a whole managed file,
 *   not a block spliced into user content. A GitHub Actions workflow that is
 *   identical across every repo (zero project-specific logic) is a
 *   copy-distribution candidate: write it if absent, overwrite it if it has
 *   drifted from the golden template, and leave it alone if a *user-authored*
 *   file (one without our managed header) already sits at that path. See
 *   `ensure-workflow-files.ts`.
 */

import {
  BOT_AUTOMERGE,
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
 * - `.gitignore` — keep artifacts untracked.
 *
 * `.eslintignore` is **not** here — ESLint 10 (flat config) no longer reads it and
 * warns on its presence (`The ".eslintignore" file is no longer supported`), so
 * seeding it is pure noise; a flat config carries the equivalent `ignores` array
 * instead. It is retired via {@link retiredIgnoreFiles}. `.git-worktrees/` is
 * intentionally absent too — a per-developer global-excludes concern, not a repo
 * property (see the file header). Because the managed block is regenerated from
 * these entries on every run, dropping an entry here also strips the stale line
 * from any repo that a prior version seeded.
 */
export const goldenIgnoreFiles: readonly GoldenIgnoreFile[] = [
  { filename: '.prettierignore', entries: [...TS_ARTIFACTS] },
  { filename: '.gitignore', entries: [...TS_ARTIFACTS, '.DS_Store'] },
];

/**
 * Ignore files bootstrap used to seed but should now actively **retire** — remove
 * our managed block, and delete the file entirely if it held nothing but that
 * block. `.eslintignore` is the first: ESLint 10 dropped support for it (#253), so
 * an already-bootstrapped repo needs the inert file swept up on the next
 * `ai-ensure-project-config` / golden-sync run, not left to warn forever. A repo's
 * own `.eslintignore` (one without our managed block) is left untouched.
 */
export const retiredIgnoreFiles: readonly string[] = ['.eslintignore'];

/**
 * Whole workflow files bootstrap used to seed/manage but should now actively
 * **retire** — delete our previously-written copy so a stale duplicate is not left
 * running. Unlike a retired *ignore* file (a managed block spliced into possibly
 * user-authored content), a workflow is a whole managed file, so retirement is a
 * delete-if-ours guarded by {@link WORKFLOW_MANAGED_MARKER}: a file we wrote (carries
 * the header) is removed; a user-authored file at the same path (no header) is left
 * untouched. `.github/workflows/dependabot-auto-merge.yml` is the first: #264 renamed
 * the golden auto-merge file to `bot-automerge.yml` (a reusable-workflow caller that
 * also covers release-please PRs), so an already-bootstrapped repo must shed the old
 * inline copy on the next `ai-ensure-project-config` / golden-sync run — otherwise it
 * would run *two* auto-merge workflows. See {@link retireWorkflowFile}.
 */
export const retiredWorkflowFiles: readonly string[] = [
  '.github/workflows/dependabot-auto-merge.yml',
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
   *
   * **The per-file rule (the seed-vs-manage principle):** a file is `seed` once it
   * is a **self-updating reference** — a Dependabot-bumpable pin or a
   * reusable-workflow caller (`repo-hygiene.yml`; `bot-automerge.yml` (#264);
   * `merge-safety.yml` once #247 makes it a caller). Dependabot then owns updates,
   * so a `manage` re-sync would fight it over the pin. A file whose **logic is
   * embedded inline** (`commit-convention.yml`) stays `manage` — it has no
   * Dependabot channel, so its logic must keep propagating via golden-sync
   * (#233). golden-sync composes with `seed`: being write-if-absent, it never
   * clobbers an existing (bumped / hand-tuned) reference, yet still propagates
   * *newly-added* golden files and keeps the ignore blocks conformant.
   */
  policy?: 'manage' | 'seed';
}

/**
 * Golden whole files distributed to every repo. Two idempotency policies (see
 * {@link GoldenWorkflowFile.policy}): `manage` (bootstrap-owned, overwrite drift)
 * for the inline-logic workflows, `seed` (write-once, repo-owned) for the
 * reusable-workflow callers and the Dependabot config.
 *
 * - `bot-automerge.yml` (**`seed`**) — a thin caller of the SHA-pinned
 *   `rmartz/bot-automerge` reusable workflow (Dependabot bumps the pin, and the CLI
 *   version it installs, in lockstep). GitHub-native auto-merge for trustworthy bot
 *   PRs: green patch/minor Dependabot bumps *and* release-please release PRs (#264,
 *   expanded from the old inline Dependabot-only `dependabot-auto-merge.yml`, which
 *   is retired via {@link retiredWorkflowFiles}). `seed` for the self-updating-
 *   reference reason (see the seed-vs-manage principle). Still **gated**: keeps
 *   `gateChecks: ['merge-safety']` so the writer withholds its creation until
 *   merge-safety is a satisfied required check — an ungated `gh pr merge --auto`
 *   merges *immediately*, so it must never land without the gate.
 * - `merge-safety.yml` (**`seed`**) — a thin caller of the SHA-pinned
 *   `rmartz/merge-safety` reusable workflow (Dependabot bumps the pin, and the CLI
 *   version it installs, in lockstep). `seed` for the same self-updating-reference
 *   reason as `repo-hygiene.yml` (see the seed-vs-manage principle below). No
 *   `gateChecks` of its own: it *provides* the `merge-safety` check the auto-merge
 *   file depends on rather than consuming one.
 * - `.github/dependabot.yml` (`seed`) — a starting Dependabot config the repo then
 *   owns; bootstrap writes it only if absent and never overwrites local edits.
 * - `repo-hygiene.yml` (**`seed`**) — a thin caller of the SHA-pinned
 *   `rmartz/repo-hygiene` reusable workflow (Dependabot bumps the pin, and the CLI
 *   version it installs, in lockstep). `seed` (write-if-absent) because it is now a
 *   self-updating reference: bootstrap seeds it once and Dependabot owns the pin
 *   thereafter, so a re-seed / golden-sync run never reverts a bumped or hand-tuned
 *   caller. Advisory; `gateChecks: []`. (See the seed-vs-manage principle below.)
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
    filename: '.github/workflows/bot-automerge.yml',
    content: BOT_AUTOMERGE,
    gateChecks: ['merge-safety'],
    policy: 'seed',
  },
  {
    filename: '.github/workflows/merge-safety.yml',
    content: MERGE_SAFETY,
    gateChecks: [],
    policy: 'seed',
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
    policy: 'seed',
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
