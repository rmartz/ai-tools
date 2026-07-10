export { resolveDefaultBranch, resolveBaseRef } from './worktree-base.js';
export type { Log, ResolveOptions } from './worktree-base.js';

export {
  CLAUDE_SETTINGS_SOURCE,
  DEFAULT_BRANCH_PREFIX,
  VALID_BRANCH_PREFIXES,
  deriveSlug,
  composeBranchName,
  composeWorktreeDir,
  detectInstallCommand,
  createWorktree,
  symlinkClaudeSettings,
  installDeps,
  assignIssue,
  runNewWorktree,
} from './new-worktree.js';
export type {
  BranchPrefix,
  ComposeBranchOptions,
  NewWorktreeOptions,
  NewWorktreeResult,
} from './new-worktree.js';

export {
  parseSecondaryWorktrees,
  classifyBranches,
  decideCleanup,
  runCleanup,
} from './git-cleanup.js';
export type { PrState, CleanupOptions, CleanupResult, CleanupDecision } from './git-cleanup.js';
export { STALE_AFTER_DAYS, isStale } from './branch-staleness.js';

export {
  REQUIRED_WORKER_PERMISSIONS,
  requiredWorkerPermissions,
  effectiveAllow,
  missingWorkerPermissions,
  ensureWorkerPermissions,
} from './worker-permissions.js';
