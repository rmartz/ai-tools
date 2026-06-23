/**
 * Golden-state tooling-ignore contents for a pnpm/TypeScript monorepo. This is
 * the data half of `ensure-project-config`; the logic half (`ensure-project-config.ts`)
 * stays small by keeping the file *contents* here.
 *
 * Reframe from dotfiles' `ensure_project_config.py`: that script targeted a
 * loose JS-config repo and appended a single `.git-worktrees` line plus a
 * comment-aware `eslint.config.js` array-splice. Here the stack is pnpm + TS, so
 * the golden ignores cover the TS build/test artifacts (`dist`, `.turbo`,
 * `*.tsbuildinfo`, `coverage`) and `node_modules`, alongside the worktree dir.
 *
 * Idempotency strategy: each managed file gets a fenced marker block. We ensure
 * the block is present and leave any user-authored lines outside it untouched —
 * "ensure block present, don't clobber user content".
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
