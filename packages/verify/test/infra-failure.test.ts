import { describe, it, expect, vi } from 'vitest';

// `gh` is a real-world boundary — mock the runtime so the test is hermetic.
vi.mock('@rmartz/agent-runtime', () => ({ boundedRun: vi.fn() }));

import { isInfraFailure } from '../src/infra-failure.js';
import type { GhRunner } from '../src/infra-failure.js';

const REPO = 'owner/name';
const SHA = 'abcdef1234567890';

/**
 * Build a runner that answers the runs-list endpoint with `runs`, and any
 * per-run jobs endpoint with the matching entry in `jobsByRun`.
 */
function makeRunner(runs: unknown[], jobsByRun: Record<string, unknown> = {}): GhRunner {
  return async (_command, args) => {
    const endpoint = args[1] ?? '';
    if (endpoint.includes('/jobs')) {
      const m = endpoint.match(/runs\/(\d+)\/jobs/);
      const id = m?.[1] ?? '';
      return { stdout: JSON.stringify(jobsByRun[id] ?? { jobs: [] }), code: 0 };
    }
    return { stdout: JSON.stringify({ workflow_runs: runs }), code: 0 };
  };
}

describe('isInfraFailure', () => {
  it('soft-fails to fixable when the gh api call errors', async () => {
    const runner: GhRunner = async () => ({ stdout: '', code: 1 });
    const r = await isInfraFailure(REPO, SHA, { runner });
    expect(r.isInfra).toBe(false);
    expect(r.reason).toContain('gh api failed');
  });

  it('soft-fails to fixable on invalid JSON', async () => {
    const runner: GhRunner = async () => ({ stdout: 'not json', code: 0 });
    const r = await isInfraFailure(REPO, SHA, { runner });
    expect(r.isInfra).toBe(false);
    expect(r.reason).toContain('gh api failed');
  });

  it('returns fixable when there are no terminal failing runs', async () => {
    const runner = makeRunner([{ conclusion: 'success', name: 'CI' }]);
    const r = await isInfraFailure(REPO, SHA, { runner });
    expect(r.isInfra).toBe(false);
    expect(r.reason).toContain('no failed/startup_failure runs');
  });

  it('classifies a startup_failure run as infrastructure', async () => {
    const runner = makeRunner([{ conclusion: 'startup_failure', name: 'CI', id: 1 }]);
    const r = await isInfraFailure(REPO, SHA, { runner });
    expect(r.isInfra).toBe(true);
    expect(r.reason).toContain('startup_failure');
  });

  it('classifies a failure run whose failed jobs ran zero steps as infra', async () => {
    const runner = makeRunner([{ conclusion: 'failure', name: 'CI', id: 7 }], {
      '7': { jobs: [{ conclusion: 'failure', steps: [] }] },
    });
    const r = await isInfraFailure(REPO, SHA, { runner });
    expect(r.isInfra).toBe(true);
    expect(r.reason).toContain('zero executed steps');
  });

  it('treats a failure run with an executed failing step as fixable', async () => {
    const runner = makeRunner([{ conclusion: 'failure', name: 'CI', id: 8 }], {
      '8': { jobs: [{ conclusion: 'failure', steps: [{ conclusion: 'failure' }] }] },
    });
    const r = await isInfraFailure(REPO, SHA, { runner });
    expect(r.isInfra).toBe(false);
    expect(r.reason).toContain('genuine code failure');
  });

  it('one genuine code failure disqualifies the whole head even alongside infra runs', async () => {
    const runner = makeRunner(
      [
        { conclusion: 'startup_failure', name: 'A', id: 1 },
        { conclusion: 'failure', name: 'B', id: 2 },
      ],
      { '2': { jobs: [{ conclusion: 'failure', steps: [{ conclusion: 'failure' }] }] } },
    );
    const r = await isInfraFailure(REPO, SHA, { runner });
    expect(r.isInfra).toBe(false);
  });

  it('treats a failure run whose jobs cannot be fetched as inconclusive', async () => {
    const runner: GhRunner = async (_command, args) => {
      const endpoint = args[1] ?? '';
      if (endpoint.includes('/jobs')) return { stdout: '', code: 1 };
      return {
        stdout: JSON.stringify({ workflow_runs: [{ conclusion: 'failure', name: 'CI', id: 3 }] }),
        code: 0,
      };
    };
    const r = await isInfraFailure(REPO, SHA, { runner });
    expect(r.isInfra).toBe(false);
    expect(r.reason).toContain('inconclusive');
  });
});
