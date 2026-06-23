import { homedir } from 'node:os';
import { join, resolve, basename } from 'node:path';
import { boundedRun } from './bounded-subprocess.js';
import { buildArgv } from './claude-invoke.js';
import type { ClaudeInvocation, ClaudeRunResult } from './claude-invoke.js';
import {
  recoverResumePointer,
  recordResumeMarkerOnTimeout,
  type ResumeStore,
  type ResumeLocator,
} from './resume.js';

/**
 * Dispatch context for headless skill agents.
 *
 * A coordinator runs each skill (`/review`, `/fix-review`, `/merge`) as a
 * headless `claude` subprocess. This module owns the helpers that shape that
 * dispatch:
 *
 * - pinning a known `--session-id` so the agent's transcript file is locatable
 *   after the fact, and computing that file's path;
 * - building the environment overlaid onto the agent's process; and
 * - the resume-on-retry handoff: when the coordinator retries a PR after a
 *   skill timeout, the *previous* (interrupted) agent's transcript locator is
 *   handed to the retry agent so it can resume rather than restart.
 *
 * The pure argv/exec layer lives in `claude-invoke.ts`; the durable
 * cross-session marker layer lives in `resume.ts`. This module composes both.
 * Everything PR-Shepherd-specific is **injected** — the persistence backend
 * (a `ResumeStore`) and the supersession `confirmationRe` — so this layer-0
 * module knows nothing about gate/verdict labels or PR comments.
 *
 * TS port of dotfiles' `lib/skill_dispatch.py`, raised one level: the Python
 * module exposed only the pure helpers (the subprocess dispatch lived in the
 * coordinator), whereas {@link dispatchSkill} here ties the helpers to the
 * runner and the resume store in one reusable entry point.
 */

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

/** Options the {@link SkillRunner} honors. The overlaid `env` is the dispatch's. */
export interface SkillRunOptions {
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

/**
 * Executes a prepared invocation. The injection seam for {@link dispatchSkill}:
 * tests pass a fake so no real subprocess runs. Unlike `claude-invoke`'s
 * `runInvocation`, it accepts the overlaid `env` — the dispatch's whole purpose
 * is to export resume/traceability vars into the agent's process.
 */
export type SkillRunner = (
  invocation: ClaudeInvocation,
  options: SkillRunOptions,
) => Promise<ClaudeRunResult>;

/**
 * Default {@link SkillRunner}: builds the argv via `buildArgv` and runs it
 * through `boundedRun`, forwarding `cwd` and the overlaid `env`. Mirrors
 * `runInvocation`'s soft-fail posture — a non-zero exit, timeout, or spawn error
 * all resolve to `ok: false` rather than throwing.
 */
export const defaultSkillRunner: SkillRunner = async (invocation, options) => {
  const [command, ...args] = buildArgv(invocation);
  if (command === undefined) {
    return { stdout: '', stderr: 'empty argv', code: null, timedOut: false, ok: false };
  }
  try {
    const r = await boundedRun(command, args, {
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      cwd: invocation.cwd,
      env: options.env,
    });
    return { ...r, ok: r.code === 0 && !r.timedOut };
  } catch (err) {
    const stderr = err instanceof Error ? err.message : String(err);
    return { stdout: '', stderr, code: null, timedOut: false, ok: false };
  }
};

// ── Resume-handoff env var names ─────────────────────────────────────────────
// These cross the process boundary into the dispatched agent's environment, so
// they are an external contract — verbatim, matching the dotfiles names.

/** Session id of the interrupted prior agent (its transcript is `<id>.jsonl`). */
export const ENV_PREVIOUS_TRANSCRIPT_ID = 'COORDINATOR_PREVIOUS_TRANSCRIPT_ID';
/** Best-effort path to that prior transcript file. */
export const ENV_PREVIOUS_TRANSCRIPT_PATH = 'COORDINATOR_PREVIOUS_TRANSCRIPT_PATH';
/** This dispatch's own session id, for verdict-comment correlation. */
export const ENV_AGENT_TRANSCRIPT_ID = 'COORDINATOR_AGENT_TRANSCRIPT_ID';
/** ISO-8601 start time of the coordinator run that dispatched the agent. */
export const ENV_COORDINATOR_STARTED_AT = 'COORDINATOR_STARTED_AT';

// Flags that mean the session id is already determined (or persistence is off),
// so the dispatch must not inject its own --session-id over the top.
const SESSION_CONFLICTING_FLAGS = new Set([
  '--session-id',
  '--resume',
  '-r',
  '--continue',
  '-c',
  '--no-session-persistence',
]);

/**
 * Inject `--session-id <uuid>` into a `claude` argv, **mutating it in place**.
 *
 * Lets the dispatcher know exactly which transcript file the agent will write
 * (`<session-id>.jsonl`) without parsing its output. Returns `true` when
 * injected; `false` (no change) when the command is not a `claude` invocation
 * or already carries a session/resume/persistence flag — so a custom command
 * template is never corrupted and an explicit session choice is never
 * overridden.
 */
export function injectSessionId(command: string[], sessionId: string): boolean {
  const head = command[0];
  if (head === undefined || basename(head) !== 'claude') return false;
  if (command.some((tok) => SESSION_CONFLICTING_FLAGS.has(tok))) return false;
  command.splice(1, 0, '--session-id', sessionId);
  return true;
}

/**
 * Best-effort path to a dispatched agent's transcript for `sessionId`.
 *
 * Claude Code stores each session at
 * `~/.claude/projects/<slug>/<session-id>.jsonl`, where `<slug>` is the absolute
 * working directory with `/` and `.` replaced by `-`. The session id is the
 * authoritative locator (the file is named after it); this computed path is a
 * convenience that may drift if Claude Code changes its slug scheme.
 */
export function claudeTranscriptPath(cwd: string, sessionId: string): string {
  const slug = resolve(cwd).replace(/[/.]/g, '-');
  return join(homedir(), '.claude', 'projects', slug, `${sessionId}.jsonl`);
}

export interface DispatchEnvOptions {
  /** Locator for the interrupted prior agent on a *retry* dispatch. */
  previous?: ResumeLocator | null;
  /** This dispatch's own session id (verdict correlation). */
  transcriptId?: string | null;
  /** ISO-8601 coordinator start time (verdict correlation). */
  coordinatorStartedAt?: string | null;
  /** Base environment to overlay onto; defaults to `process.env`. */
  base?: NodeJS.ProcessEnv;
}

/**
 * The coordinator environment augmented with the skill-dispatch context.
 *
 * Copies `base` (default `process.env`) and overlays each key only when known —
 * a normal dispatch leaves any unknown variable absent rather than empty. The
 * resume-handoff and traceability vars are first **stripped** from the inherited
 * environment and only re-added when explicitly supplied, so a coordinator
 * agent's own resume pointer is never accidentally forwarded to a skill it
 * dispatches.
 */
export function dispatchEnv(options: DispatchEnvOptions = {}): NodeJS.ProcessEnv {
  const { previous, transcriptId, coordinatorStartedAt, base = process.env } = options;
  const env: NodeJS.ProcessEnv = { ...base };
  delete env[ENV_PREVIOUS_TRANSCRIPT_ID];
  delete env[ENV_PREVIOUS_TRANSCRIPT_PATH];
  delete env[ENV_COORDINATOR_STARTED_AT];
  if (previous?.sessionId) env[ENV_PREVIOUS_TRANSCRIPT_ID] = previous.sessionId;
  if (previous?.path) env[ENV_PREVIOUS_TRANSCRIPT_PATH] = previous.path;
  if (transcriptId) env[ENV_AGENT_TRANSCRIPT_ID] = transcriptId;
  if (coordinatorStartedAt) env[ENV_COORDINATOR_STARTED_AT] = coordinatorStartedAt;
  return env;
}

/**
 * Tracks per-PR transcript locators so a retry inherits its predecessor's.
 *
 * Three moments: {@link record} on every session-pinned dispatch;
 * {@link flagRetry} when the coordinator decides to retry a PR (promotes the
 * last locator into a pending slot); {@link takePending} on the next dispatch
 * (consumes the slot, so a later non-retry dispatch never inherits a stale
 * pointer). Per-coordinator-run, in-memory — durability is `resume.ts`'s job.
 */
export class TranscriptResumeRegistry {
  private readonly last = new Map<number, ResumeLocator>();
  private readonly pending = new Map<number, ResumeLocator>();

  /** Record `pr`'s most recent transcript locator (overwrites any prior). */
  record(pr: number, sessionId: string, path?: string | null): void {
    this.last.set(pr, { sessionId, path: path ?? null });
  }

  /** `pr`'s most recent dispatch locator without consuming it, or `null`. */
  lastFor(pr: number): ResumeLocator | null {
    return this.last.get(pr) ?? null;
  }

  /** Promote `pr`'s last locator into the pending slot. No-op if none recorded. */
  flagRetry(pr: number): void {
    const prev = this.last.get(pr);
    if (prev) this.pending.set(pr, prev);
  }

  /** Return and clear `pr`'s pending locator, or `null`. */
  takePending(pr: number): ResumeLocator | null {
    const prev = this.pending.get(pr) ?? null;
    this.pending.delete(pr);
    return prev;
  }
}

export interface DispatchSkillOptions {
  /** The invocation to run; its `cwd` is also used to compute the transcript path. */
  invocation: ClaudeInvocation;
  /** PR number this dispatch acts on — keys the in-memory resume handoff. */
  pr: number;
  /** Newly minted session id to pin (e.g. `crypto.randomUUID()`). */
  sessionId: string;
  /** In-memory per-run handoff registry. */
  registry: TranscriptResumeRegistry;
  /** Durable cross-session marker backend (injected — PR Shepherd supplies its own). */
  store: ResumeStore;
  /** Supersession regex narrowing the durable streak (a consumer's confirmation marker). */
  confirmationRe?: RegExp;
  /** This dispatch's correlation id, exported for verdict stamping (defaults to `sessionId`). */
  transcriptId?: string;
  /** ISO-8601 coordinator start time, exported for verdict stamping. */
  coordinatorStartedAt?: string;
  /** Signing identity recorded in a timeout marker. */
  model?: string;
  /** Salvage note recorded in a timeout marker (e.g. `none` for /review). */
  salvage?: string;
  /** Hard wall-clock timeout forwarded to the runner. */
  timeoutMs?: number;
  /** Injection seam for the runner, so tests need no real subprocess. */
  run?: SkillRunner;
}

export interface DispatchSkillResult extends ClaudeRunResult {
  /** The session id pinned for this dispatch (its transcript is `<sessionId>.jsonl`). */
  sessionId: string;
  /** Best-effort path to this dispatch's transcript. */
  transcriptPath: string;
}

/**
 * Dispatch one headless skill agent end-to-end, with the resume handoff wired.
 *
 * Pins `sessionId` into the invocation's argv, computes its transcript path,
 * records the locator in `registry`, and — on a retry dispatch (a pending
 * locator exists, or a durable marker is recoverable from `store`) — exports the
 * prior transcript so the skill resumes. On a **timeout**, persists this agent's
 * locator as a durable marker via {@link recordResumeMarkerOnTimeout}.
 *
 * Soft-fail throughout: the underlying run never throws (branch on `.ok`), and
 * the marker write is best-effort. The on-retry recovery from the durable store
 * is *additive* — the in-memory pending slot wins when both are present.
 */
export async function dispatchSkill(options: DispatchSkillOptions): Promise<DispatchSkillResult> {
  const { invocation, pr, sessionId, registry, store, confirmationRe } = options;
  const run = options.run ?? defaultSkillRunner;
  const cwd = invocation.cwd ?? process.cwd();
  const transcriptPath = claudeTranscriptPath(cwd, sessionId);

  const previous = registry.takePending(pr) ?? (await recoverResumePointer(store, confirmationRe));
  registry.record(pr, sessionId, transcriptPath);

  const env = dispatchEnv({
    previous,
    transcriptId: options.transcriptId ?? sessionId,
    coordinatorStartedAt: options.coordinatorStartedAt,
  });

  const invocationWithSession = withSessionId(invocation, sessionId);
  const result = await run(invocationWithSession, { timeoutMs: options.timeoutMs, env });

  if (result.timedOut) {
    await recordResumeMarkerOnTimeout({
      store,
      skill: invocation.skill,
      salvage: options.salvage ?? 'none',
      model: options.model ?? '',
      locator: { sessionId, path: transcriptPath },
      confirmationRe,
    });
  }

  return { ...result, sessionId, transcriptPath };
}

/**
 * Return a copy of `invocation` whose `extraArgs` carry a pinned `--session-id`,
 * unless they already carry a conflicting session/resume flag (in which case the
 * invocation is returned unchanged). The argv is built downstream by
 * `buildArgv`, which always appends `claude [extraArgs] -- <skill>`; injecting
 * here keeps the flag in front of the `--` terminator.
 */
function withSessionId(invocation: ClaudeInvocation, sessionId: string): ClaudeInvocation {
  const binary = invocation.binary ?? 'claude';
  const probe = [binary, ...(invocation.extraArgs ?? [])];
  if (!injectSessionId(probe, sessionId)) return invocation;
  return { ...invocation, extraArgs: probe.slice(1) };
}
