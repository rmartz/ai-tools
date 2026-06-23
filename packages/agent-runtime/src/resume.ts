import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  formatMarker,
  countActiveMarkers,
  selectActivePointer,
  type ResumeEntry,
  type ResumeLocator,
} from './resume-marker.js';

/**
 * Durable cross-session resume pointers. When an agent is interrupted (a
 * timeout) before it can report completion, a pointer to its transcript is
 * recorded somewhere durable so a *later* pass — even in a fresh coordinator
 * session, after the in-memory retry registry is gone — can resume it rather
 * than restarting from scratch.
 *
 * This is the I/O layer (TS port of dotfiles' `lib/timeout_recovery.py`): a
 * pluggable {@link ResumeStore} plus the record/recover helpers. The pure marker
 * shaping/reading lives in `resume-marker.ts`; it is re-exported below so
 * `./resume.js` remains the single public surface. The dotfiles version persisted
 * the pointer specifically as a *PR comment* via `gh`; that backend is
 * PR-Shepherd-specific, so here the storage is abstracted behind `ResumeStore`.
 */

export * from './resume-marker.js';

/**
 * Durable backend for resume markers. The marker layer is storage-agnostic; this
 * is the seam a consumer plugs its persistence into. The dotfiles version stored
 * markers as PR comments — PR Shepherd supplies such an implementation (`read` →
 * `gh pr view` comments, `append` → `gh pr comment`). The default
 * {@link FsResumeStore} persists to a JSON file for the harness and tests.
 *
 * Both methods are best-effort: `read` returns `null` on any failure (so callers
 * treat "couldn't read" as "no markers"); `append` swallows write errors.
 */
export interface ResumeStore {
  /** Return all stored entries, or `null` on any failure. Never throws. */
  read(): Promise<ResumeEntry[] | null>;
  /** Append one entry. Best-effort — swallows errors. Never throws. */
  append(entry: ResumeEntry): Promise<void>;
}

function defaultStorePath(): string {
  return process.env.RESUME_STORE_PATH ?? join(tmpdir(), 'resume-markers.json');
}

/**
 * Default fs-backed {@link ResumeStore}. Reads/writes a JSON array of entries at
 * an overridable path (`RESUME_STORE_PATH`, default `<tmpdir>/resume-markers.json`),
 * appending atomically via temp-write + `rename` (mirrors `rate-limit.ts`). Suits
 * the harness and tests; PR Shepherd swaps in a PR-comment-backed store.
 */
export class FsResumeStore implements ResumeStore {
  constructor(private readonly path: string = defaultStorePath()) {}

  async read(): Promise<ResumeEntry[] | null> {
    let raw: string;
    try {
      raw = readFileSync(this.path, 'utf8');
    } catch {
      return null;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    return Array.isArray(parsed) ? (parsed as ResumeEntry[]) : null;
  }

  async append(entry: ResumeEntry): Promise<void> {
    try {
      const existing = (await this.read()) ?? [];
      existing.push(entry);
      const tmp = `${this.path}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(existing), 'utf8');
      renameSync(tmp, this.path);
    } catch {
      // Best-effort persistence — a failed write is never fatal.
    }
  }
}

export interface RecordResumeMarkerOptions {
  store: ResumeStore;
  skill: string;
  salvage: string;
  model: string;
  /** The locator read from the in-memory retry registry; no-op when absent. */
  locator: ResumeLocator | null | undefined;
  /** Supersession regex (a consumer's confirmation marker); narrows the streak. */
  confirmationRe?: RegExp;
  /** Defaults to now (UTC ISO-8601); overridable for deterministic tests. */
  timestamp?: string;
  /** Best-effort failure sink; defaults to `console.error`. */
  log?: (message: string) => void;
}

/**
 * Persist a timed-out agent's transcript locator as a durable marker. The
 * `attempt` number is derived from the markers already in the store
 * ({@link countActiveMarkers} + 1), so the count survives a session boundary; it
 * floors to 1 if the store read fails. No-op when `locator` is missing or has no
 * session id. Best-effort: never throws.
 */
export async function recordResumeMarkerOnTimeout(opts: RecordResumeMarkerOptions): Promise<void> {
  if (!opts.locator?.sessionId) return;
  const stamp = opts.timestamp ?? new Date().toISOString();
  const prior = await opts.store.read();
  const priorMarkers = prior ? countActiveMarkers(prior, opts.confirmationRe) : 0;
  const body = formatMarker({
    skill: opts.skill.replace(/^\/+/, ''),
    sessionId: opts.locator.sessionId,
    transcriptPath: opts.locator.path,
    termination: 'timeout',
    salvage: opts.salvage,
    attempt: priorMarkers + 1,
    timestamp: stamp,
    model: opts.model,
  });
  try {
    await opts.store.append({ body, createdAt: stamp });
  } catch (err) {
    (opts.log ?? console.error)(`resume marker append failed (best-effort): ${String(err)}`);
  }
}

/**
 * Recover a timed-out agent's transcript locator from the durable store: the
 * newest marker not yet superseded by a later confirmation. Returns a
 * `{ sessionId, path }` locator or `null`. Never throws.
 */
export async function recoverResumePointer(
  store: ResumeStore,
  confirmationRe?: RegExp,
): Promise<ResumeLocator | null> {
  const entries = await store.read();
  if (entries === null) return null;
  return selectActivePointer(entries, confirmationRe);
}
