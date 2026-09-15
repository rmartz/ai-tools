export { ensureLabels } from './ensure-labels.js';
export type { EnsureLabelsOptions, EnsureLabelsResult, LabelOutcome } from './ensure-labels.js';

export {
  crossCuttingLabels,
  metaLabels,
  mergeSafetyLabels,
  defaultRoster,
} from './labels-roster.js';
export type { LabelSpec } from './labels-roster.js';

export { ensureProjectConfig } from './ensure-project-config.js';
export type {
  EnsureProjectConfigOptions,
  EnsureProjectConfigResult,
  ConfigOutcome,
  ConfigAction,
} from './ensure-project-config.js';

export { ensureWorkflowFiles, renderManagedWorkflow } from './ensure-workflow-files.js';
export type {
  EnsureWorkflowFilesOptions,
  WorkflowOutcome,
  WorkflowAction,
} from './ensure-workflow-files.js';

export { verifyAutomergeGate } from './verify-automerge-gate.js';
export type {
  VerifyAutomergeGateOptions,
  VerifyAutomergeGateResult,
} from './verify-automerge-gate.js';

export { verifySquashMergeSetting } from './verify-squash-merge-setting.js';
export type {
  VerifySquashMergeSettingOptions,
  VerifySquashMergeSettingResult,
} from './verify-squash-merge-setting.js';

export {
  goldenIgnoreFiles,
  goldenWorkflowFiles,
  goldenGateChecks,
  BLOCK_BEGIN,
  BLOCK_END,
  WORKFLOW_MANAGED_HEADER,
  WORKFLOW_MANAGED_MARKER,
} from './golden-config.js';
export type { GoldenIgnoreFile, GoldenWorkflowFile } from './golden-config.js';
