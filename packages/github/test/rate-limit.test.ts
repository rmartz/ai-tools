import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// No `gh` here — rate-limit is pure local-fs coordination. Still deny network
// by mocking the runtime to a hard failure, proving nothing shells out.
vi.mock('@rmartz/agent-runtime', () => ({
  boundedRun: vi.fn(async () => {
    throw new Error('boundedRun must not be called by rate-limit');
  }),
}));

const { readRateLimitState, writeRateLimitState, rateLimitGuard } =
  await import('../src/rate-limit.js');

let dir: string;
let statePath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gh-rl-'));
  statePath = join(dir, 'state.json');
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('write/read round-trip', () => {
  it('persists and reads back fresh state', () => {
    writeRateLimitState({ restRemaining: 412, graphqlRemaining: 890, resetAt: 123 }, statePath);
    const state = readRateLimitState(statePath);
    expect(state?.restRemaining).toBe(412);
    expect(state?.graphqlRemaining).toBe(890);
  });

  it('returns null for absent state', () => {
    expect(readRateLimitState(join(dir, 'missing.json'))).toBeNull();
  });

  it('ignores stale state older than the 1h window', () => {
    writeFileSync(
      statePath,
      JSON.stringify({ restRemaining: 9, graphqlRemaining: 9, resetAt: 0, updatedAt: 0 }),
    );
    expect(readRateLimitState(statePath)).toBeNull();
  });
});

describe('rateLimitGuard', () => {
  it('does not sleep on a fast path (plenty remaining)', async () => {
    writeRateLimitState({ restRemaining: 5000, graphqlRemaining: 5000, resetAt: 1 }, statePath);
    const sleep = vi.fn(async () => {});
    await rateLimitGuard('rest', { path: statePath, sleep });
    expect(sleep).not.toHaveBeenCalled();
  });

  it('sleeps 1–5 s in the low band', async () => {
    writeRateLimitState({ restRemaining: 200, graphqlRemaining: 5000, resetAt: 1 }, statePath);
    const sleep = vi.fn(async () => {});
    await rateLimitGuard('rest', { path: statePath, sleep });
    expect(sleep).toHaveBeenCalledOnce();
    const ms = sleep.mock.calls[0][0] as number;
    expect(ms).toBeGreaterThanOrEqual(1_000);
    expect(ms).toBeLessThanOrEqual(5_000);
  });

  it('warns and sleeps 10–30 s when critically low, selecting the chosen pool', async () => {
    writeRateLimitState({ restRemaining: 5000, graphqlRemaining: 5, resetAt: 1 }, statePath);
    const sleep = vi.fn(async () => {});
    const log = vi.fn();
    await rateLimitGuard('graphql', { path: statePath, sleep, log });
    expect(log).toHaveBeenCalledOnce();
    const ms = sleep.mock.calls[0][0] as number;
    expect(ms).toBeGreaterThanOrEqual(10_000);
    expect(ms).toBeLessThanOrEqual(30_000);
  });

  it('no-ops when state is absent', async () => {
    const sleep = vi.fn(async () => {});
    await rateLimitGuard('rest', { path: join(dir, 'nope.json'), sleep });
    expect(sleep).not.toHaveBeenCalled();
  });
});
