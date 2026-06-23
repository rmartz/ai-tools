import { parseLogEventsText, type LogEvent } from '@rmartz/agent-runtime';

/**
 * Friction-event extraction from Claude Code JSONL transcripts. Scans parsed
 * transcript events for the five friction signals — tool errors, user
 * corrections, hook blocks, tool retries, and context compactions — and renders
 * a Markdown report. TS port of dotfiles' `extract-friction.py`.
 *
 * The JSONL reader is **not** re-implemented here: callers pass already-read
 * transcript text (or events), which is parsed via `@rmartz/agent-runtime`'s
 * `parseLogEventsText`. This keeps the package free of filesystem/`~/.claude`
 * directory-walking knowledge and keeps tests hermetic (in-memory strings).
 */

export type FrictionType =
  | 'tool_error'
  | 'user_correction'
  | 'hook_block'
  | 'tool_retry'
  | 'context_compacted';

export interface FrictionEvent {
  type: FrictionType;
  /** Human-readable session label (AI title, else short session id). */
  session: string;
  /** Date prefix (YYYY-MM-DD) of the triggering message. */
  ts: string;
  /** Short excerpt of the triggering content. */
  detail: string;
}

// Short user messages containing these patterns likely signal friction.
const CORRECTION_RE =
  /\b(no[,.]|nope|wrong|incorrect|mistake|that'?s not|not what|not right|don'?t|stop|actually|instead|try again|let me|i said|you misunderstood|you missed|please re-?read|go back|undo|revert that|that didn'?t|still broken|still wrong|didn'?t work|failed again|same (error|issue|problem))\b/i;

// Signals that the model hit a context / token limit.
const CONTEXT_LIMIT_RE =
  /(context.{0,20}(limit|window|full)|token.{0,10}limit|compacted|conversation.{0,20}summarized|too long to process)/i;

// Signals of a denied / blocked tool call in hook feedback.
const HOOK_BLOCK_RE =
  /(blocked|denied|not allowed|permission (denied|refused)|hook.{0,20}(rejected|blocked)|unauthorized)/i;

/** Records that are loosely shaped objects; everything else is opaque. */
type Record_ = { [key: string]: unknown };

function isRecord(value: unknown): value is Record_ {
  return typeof value === 'object' && value !== null;
}

/** Flatten message `content` (string or block list) into a single string. */
function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => (isRecord(item) ? String(item.text ?? '') || String(item.value ?? '') : ''))
      .join(' ');
  }
  return '';
}

function messageContent(msg: Record_): unknown {
  const message = msg.message;
  return isRecord(message) ? message.content : undefined;
}

/** Resolve the session label: AI title, else short session id, else fallback. */
function sessionLabel(events: readonly LogEvent[], fallback: string): string {
  for (const ev of events) {
    if (isRecord(ev) && ev.type === 'ai-title' && ev.aiTitle) return String(ev.aiTitle);
  }
  for (const ev of events) {
    if (isRecord(ev) && typeof ev.sessionId === 'string' && ev.sessionId) {
      return ev.sessionId.slice(0, 8);
    }
  }
  return fallback;
}

/**
 * Extract friction events from one transcript's already-parsed events.
 * `fallbackLabel` (e.g. the transcript stem) is used when neither an AI title
 * nor a session id is present.
 */
export function extractFrictionEvents(
  events: readonly LogEvent[],
  fallbackLabel = '',
): FrictionEvent[] {
  const out: FrictionEvent[] = [];
  const label = sessionLabel(events, fallbackLabel);
  let prevToolNames = new Set<string>();

  for (const ev of events) {
    if (!isRecord(ev)) continue;
    const mtype = typeof ev.type === 'string' ? ev.type : '';
    const ts = (typeof ev.timestamp === 'string' ? ev.timestamp : '').slice(0, 10);

    if (mtype === 'user') {
      const content = messageContent(ev);
      if (Array.isArray(content)) {
        for (const item of content) {
          if (!isRecord(item)) continue;
          if (item.type === 'tool_result' && item.is_error) {
            out.push({
              type: 'tool_error',
              session: label,
              ts,
              detail: textOf(item.content).slice(0, 300),
            });
          } else if (item.type === 'text') {
            const text = String(item.text ?? '').trim();
            if (text.length > 10 && text.length < 600 && CORRECTION_RE.test(text)) {
              out.push({ type: 'user_correction', session: label, ts, detail: text.slice(0, 300) });
            }
          }
        }
      }

      // Hook blocks appear as user-role records carrying hook feedback.
      const raw = JSON.stringify(ev);
      if (raw.toLowerCase().includes('hook') && HOOK_BLOCK_RE.test(raw)) {
        const start = Math.max(0, raw.toLowerCase().indexOf('hook') - 20);
        out.push({ type: 'hook_block', session: label, ts, detail: raw.slice(start, start + 200) });
      }
    }

    // Context compaction — explicit type, or a system/assistant context-limit mention.
    if (
      mtype === 'summarized' ||
      mtype === 'compact' ||
      (mtype === 'system' && CONTEXT_LIMIT_RE.test(JSON.stringify(ev)))
    ) {
      out.push({
        type: 'context_compacted',
        session: label,
        ts,
        detail: 'Context window compaction triggered',
      });
    }
    if (mtype === 'assistant') {
      const content = messageContent(ev);
      const items = Array.isArray(content) ? content : [];
      for (const item of items) {
        if (
          isRecord(item) &&
          item.type === 'text' &&
          CONTEXT_LIMIT_RE.test(String(item.text ?? ''))
        ) {
          out.push({
            type: 'context_compacted',
            session: label,
            ts,
            detail: 'Context limit referenced in assistant response',
          });
        }
      }
    }

    // Tool retries — same tool re-invoked in a later assistant turn.
    if (mtype === 'assistant') {
      const content = messageContent(ev);
      const items = Array.isArray(content) ? content : [];
      const curTools = new Set<string>();
      for (const item of items) {
        if (isRecord(item) && item.type === 'tool_use' && typeof item.name === 'string') {
          curTools.add(item.name);
        }
      }
      const overlap = [...curTools].filter((name) => prevToolNames.has(name)).sort();
      if (overlap.length) {
        out.push({
          type: 'tool_retry',
          session: label,
          ts,
          detail: `Re-invoked: ${overlap.join(', ')}`,
        });
      }
      prevToolNames = curTools;
    }
  }

  return out;
}

/** Extract friction events directly from a transcript's JSONL text. */
export function extractFrictionFromText(text: string, fallbackLabel = ''): FrictionEvent[] {
  return extractFrictionEvents(parseLogEventsText(text), fallbackLabel);
}

/** A single scanned transcript and the friction events found in it. */
export interface TranscriptFriction {
  project: string;
  path: string;
  events: FrictionEvent[];
}

const TYPE_LABELS: [FrictionType, string][] = [
  ['tool_error', 'Tool Errors (failed tool calls)'],
  ['user_correction', 'User Corrections (direction changes)'],
  ['hook_block', 'Hook Blocks (denied actions)'],
  ['tool_retry', 'Tool Retries (repeated invocations)'],
  ['context_compacted', 'Context Compactions (token limit hits)'],
];

/**
 * Render a Markdown friction report grouped by event type. `days` only labels
 * the report heading — windowing/transcript discovery is the caller's job.
 */
export function formatFrictionReport(results: readonly TranscriptFriction[], days = 7): string {
  const lines = [`# Friction Report — Last ${days} Days\n`];
  if (results.length === 0) {
    lines.push('No friction events found in recent transcripts.\n');
    return lines.join('\n');
  }

  const byType = new Map<FrictionType, (FrictionEvent & { project: string })[]>();
  for (const r of results) {
    for (const ev of r.events) {
      const bucket = byType.get(ev.type) ?? [];
      bucket.push({ ...ev, project: r.project });
      byType.set(ev.type, bucket);
    }
  }

  for (const [key, label] of TYPE_LABELS) {
    const events = byType.get(key) ?? [];
    if (!events.length) continue;
    lines.push(`\n## ${label} (${events.length} events)\n`);
    for (const ev of events.slice(0, 25)) {
      lines.push(`- **[${ev.ts}]** \`${ev.project}\` — _${ev.session || '?'}_`);
      const detail = ev.detail.replace(/\n/g, ' ').trim();
      if (detail) lines.push(`  > ${detail.slice(0, 250)}`);
    }
  }

  lines.push(`\n---\nSessions with friction: ${results.length}\n`);
  return lines.join('\n');
}
