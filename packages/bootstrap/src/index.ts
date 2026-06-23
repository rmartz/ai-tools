export { ensureLabels } from './ensure-labels.js';
export type { EnsureLabelsOptions, EnsureLabelsResult, LabelOutcome } from './ensure-labels.js';

export { crossCuttingLabels, metaLabels, defaultRoster } from './labels-roster.js';
export type { LabelSpec } from './labels-roster.js';

export { ensureProjectConfig } from './ensure-project-config.js';
export type {
  EnsureProjectConfigOptions,
  EnsureProjectConfigResult,
  ConfigOutcome,
  ConfigAction,
} from './ensure-project-config.js';

export { goldenIgnoreFiles, BLOCK_BEGIN, BLOCK_END } from './golden-config.js';
export type { GoldenIgnoreFile } from './golden-config.js';
