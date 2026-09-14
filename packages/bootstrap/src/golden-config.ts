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
 *   `node_modules`, alongside the worktree dir.
 * - **Whole workflow files** (`.github/workflows/*.yml`) — a whole managed file,
 *   not a block spliced into user content. A GitHub Actions workflow that is
 *   identical across every repo (zero project-specific logic) is a
 *   copy-distribution candidate: write it if absent, overwrite it if it has
 *   drifted from the golden template, and leave it alone if a *user-authored*
 *   file (one without our managed header) already sits at that path. See
 *   `ensure-workflow-files.ts`.
 */

/** Sentinel lines bracketing the managed region in every ignore file. */
export const BLOCK_BEGIN = '# >>> ai-tools managed (ensure-project-config) >>>';
export const BLOCK_END = '# <<< ai-tools managed (ensure-project-config) <<<';

export interface GoldenIgnoreFile {
  /** Repo-root-relative filename. */
  filename: string;
  /** Ignore entries the managed block should contain, in order. */
  entries: string[];
}

const WORKTREES = '.git-worktrees/';

/** Build artifacts and vendored deps a TS monorepo should never format/lint/commit. */
const TS_ARTIFACTS = ['node_modules/', 'dist/', '.turbo/', '*.tsbuildinfo', 'coverage/'];

/**
 * The golden ignore files for a pnpm/TS monorepo:
 *
 * - `.prettierignore` — skip build output, vendored deps, and worktrees.
 * - `.eslintignore` — same; honored by flat config via `--ignore-path` and the
 *   universal fallback when an `eslint.config.*` ignores array can't be edited safely.
 * - `.gitignore` — keep artifacts and worktrees untracked.
 */
export const goldenIgnoreFiles: readonly GoldenIgnoreFile[] = [
  { filename: '.prettierignore', entries: [...TS_ARTIFACTS, WORKTREES] },
  { filename: '.eslintignore', entries: [...TS_ARTIFACTS, WORKTREES] },
  { filename: '.gitignore', entries: [...TS_ARTIFACTS, WORKTREES, '.DS_Store'] },
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
}

// Generic Dependabot native-auto-merge workflow: on a green `semver-patch` /
// `semver-minor` Dependabot PR it enables GitHub-native auto-merge (majors stay
// manual). Zero project-specific logic, so it is distributed by idempotent copy
// rather than reimplemented per repo. `dependabot/fetch-metadata` is pinned to a
// full commit SHA with a `major.minor.patch` comment per the Actions-pinning
// convention; Dependabot's `github-actions` ecosystem keeps the SHA fresh.
const DEPENDABOT_AUTO_MERGE = `name: Dependabot Auto-merge

on: pull_request_target

permissions:
  contents: write
  pull-requests: write

jobs:
  auto-merge:
    name: Enable auto-merge
    runs-on: ubuntu-latest
    if: github.actor == 'dependabot[bot]'
    steps:
      - name: Fetch Dependabot metadata
        id: metadata
        uses: dependabot/fetch-metadata@21025c705c08248db411dc16f3619e6b5f9ea21a # v2.5.0
        with:
          github-token: \${{ secrets.GITHUB_TOKEN }}

      - name: Enable auto-merge for patch and minor updates
        if: steps.metadata.outputs.update-type == 'version-update:semver-patch' || steps.metadata.outputs.update-type == 'version-update:semver-minor'
        run: gh pr merge --auto --squash "$PR_URL"
        env:
          PR_URL: \${{ github.event.pull_request.html_url }}
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
`;

/**
 * Golden whole-file workflows distributed to every repo. Currently just the
 * Dependabot native-auto-merge workflow, which depends on the `merge-safety`
 * required check being marked required — the gate the auto-merge verifier
 * confirms before the file may be seeded (an ungated `gh pr merge --auto` merges
 * *immediately*, so the file must never land without the gate).
 */
export const goldenWorkflowFiles: readonly GoldenWorkflowFile[] = [
  {
    filename: '.github/workflows/dependabot-auto-merge.yml',
    content: DEPENDABOT_AUTO_MERGE,
    gateChecks: ['merge-safety'],
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
