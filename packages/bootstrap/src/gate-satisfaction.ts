import type { RepoTargetOptions } from '@rmartz/github';
import { goldenGateChecks } from './golden-config.js';
import { verifyAutomergeGate } from './verify-automerge-gate.js';

/**
 * The **network** bridge between the auto-merge gate verifier and the hermetic
 * workflow writer: read the repo's real gate state (read-only) and return the
 * gate checks that are actually satisfied, so seeding the gated auto-merge
 * workflow can be conditioned on the true gate rather than a caller's assertion
 * (#239). Returns `[]` when the gate is unsatisfied — the withhold-safe direction
 * the writer defaults to — so a repo whose gate is not in place never receives a
 * live, ungated auto-merge workflow.
 */

export interface ResolveSatisfiedGateChecksOptions extends RepoTargetOptions {
  /** Gate checks to confirm. Defaults to {@link goldenGateChecks}. */
  gateChecks?: readonly string[];
}

/**
 * Resolve which gate checks are satisfied on the repo. Runs `verifyAutomergeGate`
 * read-only (never `apply`) and returns the checked set when the gate is fully
 * satisfied (auto-merge on, the checks required, squash correct), else `[]`.
 */
export async function resolveSatisfiedGateChecks(
  opts: ResolveSatisfiedGateChecksOptions = {},
): Promise<string[]> {
  const gateChecks = [...(opts.gateChecks ?? goldenGateChecks)];
  const result = await verifyAutomergeGate({ ...opts, gateChecks });
  return result.satisfied ? gateChecks : [];
}
