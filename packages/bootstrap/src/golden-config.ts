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
 * - **Whole workflow files** (`.github/workflows/*.yml`) — a whole file, not a
 *   block spliced into user content. A GitHub Actions workflow that is identical
 *   across every repo (zero project-specific logic) is a copy-distribution
 *   candidate, **seeded write-if-absent**: bootstrap writes it once to give a new
 *   repo a checklist-conformant starting point, then the repo owns it — an existing
 *   file is never overwritten. Keeping an *existing* repo conformant is the
 *   repository checklist's job (audit + self-manage), not bootstrap's — bootstrap is
 *   a new-repo initializer, not an ongoing manager. See `ensure-workflow-files.ts`.
 */

import {
  BOT_AUTOMERGE,
  MERGE_SAFETY,
  DEPENDABOT_CONFIG,
  REPO_HYGIENE,
} from './golden-workflows.js';
import { COMMIT_CONVENTION } from './golden-commit-convention.js';

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
 * `ai-ensure-project-config` run, not left to warn forever. A repo's own
 * `.eslintignore` (one without our managed block) is left untouched. (Ignore files
 * still carry a spliced managed *block* — the endorsed "lesser case" — so unlike
 * whole workflow files they retain a bootstrap-tended region.)
 */
export const retiredIgnoreFiles: readonly string[] = ['.eslintignore'];

export interface GoldenWorkflowFile {
  /** Repo-root-relative path, e.g. `.github/workflows/commit-convention.yml`. */
  filename: string;
  /** The golden file body, verbatim — written to a new repo exactly as-is. */
  content: string;
  /**
   * Required status-check contexts that GitHub-native auto-merge in this file
   * depends on. Consumed by the (separate, network-touching) auto-merge gate
   * verifier — never by the hermetic writer — but co-located here so the file and
   * the gate it needs travel together. The writer withholds *creating* a file whose
   * gate checks are not yet satisfied (see `ensure-workflow-files.ts`).
   */
  gateChecks: readonly string[];
}

/**
 * Golden whole files a **new** repo is seeded with — each written once
 * (write-if-absent), then owned by the repo. Bootstrap gives a fresh repo a
 * checklist-conformant starting point; keeping an *existing* repo conformant is the
 * repository checklist's job (audit + self-manage), not an ongoing bootstrap re-run.
 * Every entry is either a self-updating reference (a SHA-pinned reusable-workflow
 * caller or composite-action consumer that Dependabot bumps) or a starting config
 * the repo tailors — so re-seeding never has anything to overwrite.
 *
 * - `bot-automerge.yml` — a thin caller of the SHA-pinned `rmartz/bot-automerge`
 *   reusable workflow (Dependabot bumps the pin, and the CLI version it installs, in
 *   lockstep). GitHub-native auto-merge for trustworthy bot PRs: green patch/minor
 *   Dependabot bumps *and* release-please release PRs (#264). Still **gated**: keeps
 *   `gateChecks: ['merge-safety']` so the writer withholds its creation until
 *   merge-safety is a satisfied required check — an ungated `gh pr merge --auto`
 *   merges *immediately*, so it must never land without the gate.
 * - `merge-safety.yml` — a thin caller of the SHA-pinned `rmartz/merge-safety`
 *   reusable workflow (Dependabot bumps the pin, and the CLI version it installs, in
 *   lockstep). No `gateChecks` of its own: it *provides* the `merge-safety` check the
 *   auto-merge file depends on rather than consuming one.
 * - `.github/dependabot.yml` — a starting Dependabot config the repo then owns;
 *   bootstrap writes it only if absent and never overwrites local edits.
 * - `repo-hygiene.yml` — a thin consumer of the SHA-pinned
 *   `rmartz/repo-hygiene-action` **composite action** (#278; a job that
 *   `actions/checkout`s then `- uses:` the action). Dependabot bumps the pin (and the
 *   CLI version the action ships in its lockfile, in lockstep), so updates propagate
 *   with no per-repo edit. Advisory; `gateChecks: []`.
 * - `commit-convention.yml` — post-merge `push: [main]` tripwire that fails when a
 *   non-conventional subject reaches the default branch. Its logic is embedded inline
 *   (no Dependabot channel), so it is seeded once and the repo owns it thereafter;
 *   the checklist audit re-propagates a later revision. Alerts (the commit is already
 *   merged), so `gateChecks: []`.
 */
export const goldenWorkflowFiles: readonly GoldenWorkflowFile[] = [
  {
    filename: '.github/workflows/bot-automerge.yml',
    content: BOT_AUTOMERGE,
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
