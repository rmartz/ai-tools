import { boundedRun } from '@rmartz/agent-runtime';
import {
  ghCall,
  issueNumber,
  parseSlugFromRemoteUrl,
  type GhCallOptions,
  type Transport,
} from './gh-call.js';

/**
 * Stamp the agent's **origin repo** (the repository its session is anchored to)
 * onto a PR or issue the agent just created, and flag the cross-repo case where
 * the origin repo differs from the artifact's target repo.
 *
 * This runs as a Claude Code `PostToolUse` hook behind `mcp__github__*` creation
 * — not as a create-wrapper — because agents create PRs/issues through the GitHub
 * MCP tools (which the desktop app watches to relate merged PRs back to their
 * session). The hook receives the tool payload on stdin and `CLAUDE_PROJECT_DIR`
 * in its environment (pinned to the session's project root, the same key the app
 * sidebar groups sessions by), so it can resolve the origin repo independently of
 * whatever repo the create call targeted.
 *
 * The decision logic (payload parsing, stamp rendering, idempotency) is pure and
 * lives above the IO (git remote read, `gh` body edit), so it is unit-testable
 * without touching a subprocess. Every entry point soft-fails: a stamping hook
 * must never block artifact creation.
 */

const PR_CREATE_TOOL = 'mcp__github__create_pull_request';
const ISSUE_WRITE_TOOL = 'mcp__github__issue_write';

/** Hidden marker that makes the stamp idempotent (a re-fired hook won't double-stamp). */
const ORIGIN_MARKER_PREFIX = '<!-- agent-origin:';

const GIT_TIMEOUT_MS = 30_000;

export type CreatedArtifactKind = 'pr' | 'issue';

/** What a handled create resolved to: which artifact, where it landed, and its number. */
export interface StampContext {
  kind: CreatedArtifactKind;
  /** The `owner/repo` the artifact was created in (the target — repo "B"). */
  targetRepo: string;
  number: string;
}

export type StampOutcome =
  | {
      status: 'stamped';
      kind: CreatedArtifactKind;
      number: string;
      originRepo: string;
      targetRepo: string;
      crossRepo: boolean;
    }
  | { status: 'skipped'; reason: string }
  | { status: 'error'; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Which artifact kind this tool call created, or `null` if it is not a handled create. */
function classifyTool(
  toolName: string,
  input: Record<string, unknown>,
): CreatedArtifactKind | null {
  if (toolName === PR_CREATE_TOOL) return 'pr';
  // issue_write is create-or-update; only a create mints a new artifact to stamp.
  if (toolName === ISSUE_WRITE_TOOL) return input.method === 'create' ? 'issue' : null;
  return null;
}

/** The target `owner/repo` from a create tool's input, or `null` when either half is missing. */
function extractTargetRepo(input: Record<string, unknown>): string | null {
  const owner = typeof input.owner === 'string' ? input.owner.trim() : '';
  const repo = typeof input.repo === 'string' ? input.repo.trim() : '';
  return owner && repo ? `${owner}/${repo}` : null;
}

/** Pull an issue/PR number out of a value that carries `number` or an `html_url`. */
function numberFromValue(value: unknown): string | null {
  if (!isRecord(value)) return null;
  if (typeof value.number === 'number' && Number.isInteger(value.number))
    return String(value.number);
  if (typeof value.number === 'string' && /^\d+$/.test(value.number.trim()))
    return value.number.trim();
  if (typeof value.html_url === 'string') return issueNumber(value.html_url);
  return null;
}

/** Try a value's fields, then parse it as JSON, then scan it for a `/pull|issues/N` URL. */
function numberFromText(text: string): string | null {
  const trimmed = text.trim();
  try {
    const n = numberFromValue(JSON.parse(trimmed));
    if (n) return n;
  } catch {
    /* not JSON — fall through to a raw URL scan */
  }
  return issueNumber(trimmed);
}

/**
 * Extract the created artifact's number from a `PostToolUse` `tool_response`,
 * across the shapes it can take: a structured object (`{ number, html_url }`),
 * an MCP content envelope (`{ content: [{ text }] }`), or a raw string. Returns
 * `null` when the create failed or the response carries no number.
 */
export function extractCreatedNumber(response: unknown): string | null {
  const direct = numberFromValue(response);
  if (direct) return direct;
  if (isRecord(response) && Array.isArray(response.content)) {
    for (const part of response.content) {
      if (isRecord(part) && typeof part.text === 'string') {
        const n = numberFromText(part.text);
        if (n) return n;
      }
    }
  }
  if (typeof response === 'string') return numberFromText(response);
  return null;
}

interface RawHookPayload {
  tool_name?: unknown;
  tool_input?: unknown;
  tool_response?: unknown;
}

/**
 * Parse a `PostToolUse` hook payload into a {@link StampContext}, or `null` when
 * it is not a handled create (wrong tool, an `issue_write` update, a failed
 * create with no number, or missing target repo). Soft-fails on malformed JSON.
 */
export function parseHookPayload(raw: string): StampContext | null {
  let payload: RawHookPayload;
  try {
    payload = JSON.parse(raw) as RawHookPayload;
  } catch {
    return null;
  }
  const toolName = typeof payload.tool_name === 'string' ? payload.tool_name : '';
  const input = isRecord(payload.tool_input) ? payload.tool_input : {};
  const kind = classifyTool(toolName, input);
  if (!kind) return null;
  const targetRepo = extractTargetRepo(input);
  if (!targetRepo) return null;
  const number = extractCreatedNumber(payload.tool_response);
  if (!number) return null;
  return { kind, targetRepo, number };
}

export interface StampRender {
  /** Cross-repo warning, prepended above the body; `null` when origin === target. */
  banner: string | null;
  /** Origin-provenance footer, appended to the body. Present on every stamp. */
  footer: string;
}

/** The hidden idempotency marker plus the visible origin line, for `originRepo`. */
export function renderStamp(
  kind: CreatedArtifactKind,
  originRepo: string,
  targetRepo: string,
): StampRender {
  const footer = `${ORIGIN_MARKER_PREFIX} ${originRepo} -->\n🧭 **Agent origin:** \`${originRepo}\``;
  const noun = kind === 'pr' ? 'PR' : 'issue';
  const banner =
    originRepo === targetRepo
      ? null
      : `> ⚠️ **Cross-repo ${noun}:** opened by an agent anchored in \`${originRepo}\`, but targeting \`${targetRepo}\`. Confirm this change belongs in \`${targetRepo}\`.`;
  return { banner, footer };
}

/** Whether `body` already carries an origin stamp (so we don't stamp twice). */
export function hasOriginMarker(body: string): boolean {
  return body.includes(ORIGIN_MARKER_PREFIX);
}

/**
 * Return `body` with the origin footer appended (and, on a cross-repo create, the
 * warning banner prepended), or `null` when it is already stamped — the caller
 * skips the edit in that case.
 */
export function applyStamp(
  body: string,
  kind: CreatedArtifactKind,
  originRepo: string,
  targetRepo: string,
): string | null {
  if (hasOriginMarker(body)) return null;
  const { banner, footer } = renderStamp(kind, originRepo, targetRepo);
  const base = body.replace(/\n+$/, '');
  const withBanner = banner ? `${banner}\n\n${base}` : base;
  return `${withBanner}\n\n---\n\n${footer}\n`;
}

export interface OriginStampOptions extends GhCallOptions {
  /** Environment consulted for `CLAUDE_PROJECT_DIR` (defaults to `process.env`). */
  env?: Record<string, string | undefined>;
  /** Explicit project root, overriding `CLAUDE_PROJECT_DIR` (mainly for tests). */
  projectDir?: string;
}

/**
 * Resolve the agent's origin `owner/repo` from the session's project root:
 * `CLAUDE_PROJECT_DIR` (populated inside hook execution, pinned to the session
 * origin) → `git -C <dir> remote get-url origin` → normalized slug. Returns
 * `null` when no project dir is known or the repo has no `origin` remote.
 */
export async function resolveOriginRepo(opts: OriginStampOptions = {}): Promise<string | null> {
  const env = opts.env ?? process.env;
  const dir = opts.projectDir?.trim() || env.CLAUDE_PROJECT_DIR?.trim();
  if (!dir) return null;
  const remote = await boundedRun('git', ['-C', dir, 'remote', 'get-url', 'origin'], {
    timeoutMs: GIT_TIMEOUT_MS,
  });
  return remote.code === 0 ? parseSlugFromRemoteUrl(remote.stdout) : null;
}

/** REST path for an artifact's resource (`pulls/N` for a PR, `issues/N` for an issue). */
function apiPath(ctx: StampContext): string {
  const collection = ctx.kind === 'pr' ? 'pulls' : 'issues';
  return `repos/${ctx.targetRepo}/${collection}/${ctx.number}`;
}

/** Fetch the artifact's current body (empty string is valid), or `null` on failure. */
async function fetchBody(ctx: StampContext, opts: GhCallOptions): Promise<string | null> {
  const viewCmd = ctx.kind === 'pr' ? 'pr' : 'issue';
  const rest: Transport = { argv: ['gh', 'api', apiPath(ctx), '--jq', '.body // ""'] };
  const fb: Transport = {
    argv: [
      'gh',
      viewCmd,
      'view',
      ctx.number,
      '--repo',
      ctx.targetRepo,
      '--json',
      'body',
      '--jq',
      '.body // ""',
    ],
  };
  return ghCall(rest, fb, opts);
}

/** PATCH the artifact's body. Returns whether the edit succeeded. */
async function editBody(ctx: StampContext, newBody: string, opts: GhCallOptions): Promise<boolean> {
  const editCmd = ctx.kind === 'pr' ? 'pr' : 'issue';
  const rest: Transport = {
    argv: ['gh', 'api', '-X', 'PATCH', apiPath(ctx), '--input', '-', '--jq', '.html_url'],
    stdin: JSON.stringify({ body: newBody }),
  };
  const fb: Transport = {
    argv: ['gh', editCmd, 'edit', ctx.number, '--repo', ctx.targetRepo, '--body-file', '-'],
    stdin: newBody,
  };
  return (await ghCall(rest, fb, opts)) !== null;
}

/**
 * End-to-end: parse the hook payload, resolve the origin repo, and stamp the
 * created PR/issue's body (appending the origin footer, prepending a warning on a
 * cross-repo create). Soft-fails to a `skipped`/`error` outcome — it never
 * throws, so a hook can call it and always exit 0.
 */
export async function stampOriginRepo(
  rawPayload: string,
  opts: OriginStampOptions = {},
): Promise<StampOutcome> {
  const ctx = parseHookPayload(rawPayload);
  if (!ctx) return { status: 'skipped', reason: 'not-a-handled-create' };
  const originRepo = await resolveOriginRepo(opts);
  if (!originRepo) return { status: 'skipped', reason: 'no-origin-repo' };
  const body = await fetchBody(ctx, opts);
  if (body === null) return { status: 'error', reason: 'fetch-body-failed' };
  const stamped = applyStamp(body, ctx.kind, originRepo, ctx.targetRepo);
  if (stamped === null) return { status: 'skipped', reason: 'already-stamped' };
  if (!(await editBody(ctx, stamped, opts))) return { status: 'error', reason: 'edit-failed' };
  return {
    status: 'stamped',
    kind: ctx.kind,
    number: ctx.number,
    originRepo,
    targetRepo: ctx.targetRepo,
    crossRepo: originRepo !== ctx.targetRepo,
  };
}
