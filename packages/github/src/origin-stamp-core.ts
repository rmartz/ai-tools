import { issueNumber } from './gh-call.js';

const PR_CREATE_TOOL = 'mcp__github__create_pull_request';
const ISSUE_WRITE_TOOL = 'mcp__github__issue_write';

/** Hidden marker that makes the stamp idempotent (a re-fired hook won't double-stamp). */
const ORIGIN_MARKER_PREFIX = '<!-- agent-origin:';

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
  const base = body.trimEnd();
  const withBanner = banner ? `${banner}\n\n${base}` : base;
  return `${withBanner}\n\n---\n\n${footer}\n`;
}
