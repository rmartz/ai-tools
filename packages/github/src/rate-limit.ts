import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Cross-process GitHub rate-limit coordinator. Tools sharing one auth token
 * share one quota; this records the latest seen remaining-counts to a small
 * state file and lets callers back off proportionally before an API call. It is
 * best-effort courtesy backoff — never required for correctness.
 *
 * TS port of dotfiles' `gh_rate_limit.py`. The Python used `fcntl.flock`, which
 * Node lacks; writers here serialize via an atomic temp-write + `rename` (atomic
 * on POSIX), so readers never observe a torn file and concurrent writers settle
 * last-writer-wins. The state path is documented and overridable via
 * `GH_RATE_LIMIT_STATE` (default: `<tmpdir>/gh-rate-limit-state.json`).
 */

const STATE_MAX_AGE_MS = 3_600_000; // GitHub's window is 1h; older state is useless.
const THRESHOLD_LOW = 300; // < this → 1–5 s jittered sleep
const THRESHOLD_CRITICAL = 100; // < this → 10–30 s jittered sleep + warning

export type ApiType = 'rest' | 'graphql';

export interface RateLimitState {
  restRemaining: number;
  graphqlRemaining: number;
  resetAt: number;
  updatedAt: number;
}

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function defaultStatePath(): string {
  return process.env.GH_RATE_LIMIT_STATE ?? join(tmpdir(), 'gh-rate-limit-state.json');
}

/** Read the current state, or `null` if absent, unparseable, or stale. */
export function readRateLimitState(path = defaultStatePath()): RateLimitState | null {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  let state: RateLimitState;
  try {
    state = JSON.parse(raw) as RateLimitState;
  } catch {
    return null;
  }
  if (Date.now() - (state.updatedAt ?? 0) > STATE_MAX_AGE_MS) return null;
  return state;
}

/** Write state atomically. Best-effort — all I/O errors are swallowed. */
export function writeRateLimitState(
  state: Pick<RateLimitState, 'restRemaining' | 'graphqlRemaining' | 'resetAt'>,
  path = defaultStatePath(),
): void {
  const payload: RateLimitState = { ...state, updatedAt: Date.now() };
  try {
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(payload), 'utf8');
    renameSync(tmp, path);
  } catch {
    // Best-effort coordination — a failed write is never fatal.
  }
}

export interface RateLimitGuardOptions {
  path?: string;
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string) => void;
}

function jitter(minMs: number, maxMs: number): number {
  return minMs + Math.random() * (maxMs - minMs);
}

/**
 * Sleep proportionally if the shared state shows the chosen pool is low:
 * `< 100` remaining → warn + 10–30 s; `< 300` → 1–5 s; otherwise no-op. Returns
 * immediately when the state is absent or stale — callers must not depend on it
 * for correctness, only for courtesy backoff.
 */
export async function rateLimitGuard(
  apiType: ApiType = 'rest',
  opts: RateLimitGuardOptions = {},
): Promise<void> {
  const state = readRateLimitState(opts.path ?? defaultStatePath());
  if (state === null) return;
  const remaining = apiType === 'rest' ? state.restRemaining : state.graphqlRemaining;
  if (typeof remaining !== 'number') return;

  const sleep = opts.sleep ?? realSleep;
  if (remaining < THRESHOLD_CRITICAL) {
    (opts.log ?? console.error)(
      `warn: GitHub ${apiType} rate limit critically low (${remaining} remaining); ` +
        'sleeping 10–30 s before next call',
    );
    await sleep(jitter(10_000, 30_000));
  } else if (remaining < THRESHOLD_LOW) {
    await sleep(jitter(1_000, 5_000));
  }
}
