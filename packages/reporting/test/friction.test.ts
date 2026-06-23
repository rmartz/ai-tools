import { describe, it, expect } from 'vitest';
import {
  extractFrictionEvents,
  extractFrictionFromText,
  formatFrictionReport,
  type FrictionEvent,
} from '../src/friction.js';

const userMsg = (content: unknown, timestamp = '2026-06-20T10:00:00Z') => ({
  type: 'user',
  timestamp,
  message: { content },
});
const assistantMsg = (content: unknown, timestamp = '2026-06-20T10:00:00Z') => ({
  type: 'assistant',
  timestamp,
  message: { content },
});

const types = (events: FrictionEvent[]) => events.map((e) => e.type);

describe('extractFrictionEvents', () => {
  it('detects a tool error from a failed tool_result', () => {
    const events = extractFrictionEvents([
      userMsg([{ type: 'tool_result', is_error: true, content: 'boom failed' }]),
    ]);
    expect(types(events)).toEqual(['tool_error']);
    expect(events[0]?.detail).toBe('boom failed');
  });

  it('detects a user correction in a short text message', () => {
    const events = extractFrictionEvents([
      userMsg([{ type: 'text', text: "No, that's not what I asked for at all." }]),
    ]);
    expect(types(events)).toEqual(['user_correction']);
  });

  it('ignores corrections that are too short or too long', () => {
    const short = extractFrictionEvents([userMsg([{ type: 'text', text: 'no.' }])]);
    const long = extractFrictionEvents([
      userMsg([{ type: 'text', text: 'wrong ' + 'x'.repeat(700) }]),
    ]);
    expect(short).toEqual([]);
    expect(long).toEqual([]);
  });

  it('detects a hook block in user-role hook feedback', () => {
    const events = extractFrictionEvents([
      userMsg([{ type: 'text', text: 'hook PreToolUse: permission denied for write' }]),
    ]);
    expect(types(events)).toContain('hook_block');
  });

  it('detects context compaction by message type', () => {
    const events = extractFrictionEvents([
      { type: 'summarized', timestamp: '2026-06-20T00:00:00Z' },
    ]);
    expect(types(events)).toEqual(['context_compacted']);
  });

  it('detects a tool retry when the same tool is re-invoked across turns', () => {
    const events = extractFrictionEvents([
      assistantMsg([{ type: 'tool_use', name: 'Bash' }]),
      assistantMsg([{ type: 'tool_use', name: 'Bash' }]),
    ]);
    expect(types(events)).toEqual(['tool_retry']);
    expect(events[0]?.detail).toBe('Re-invoked: Bash');
  });

  it('uses the AI title as the session label, else the session id', () => {
    const titled = extractFrictionEvents([
      { type: 'ai-title', aiTitle: 'My Session' },
      userMsg([{ type: 'tool_result', is_error: true, content: 'x' }]),
    ]);
    expect(titled[0]?.session).toBe('My Session');

    const ided = extractFrictionEvents([
      { type: 'user', sessionId: 'abcdef123456', message: { content: [] } },
      userMsg([{ type: 'tool_result', is_error: true, content: 'x' }]),
    ]);
    expect(ided[0]?.session).toBe('abcdef12');
  });

  it('skips malformed events without throwing', () => {
    expect(extractFrictionEvents([null, 42, 'str', undefined])).toEqual([]);
  });
});

describe('extractFrictionFromText', () => {
  it('parses JSONL text and extracts events, skipping bad lines', () => {
    const line = JSON.stringify(userMsg([{ type: 'tool_result', is_error: true, content: 'err' }]));
    const text = `${line}\nnot-json\n\n`;
    const events = extractFrictionFromText(text, 'stem1234');
    expect(types(events)).toEqual(['tool_error']);
  });
});

describe('formatFrictionReport', () => {
  it('reports the empty case', () => {
    const md = formatFrictionReport([], 3);
    expect(md).toContain('# Friction Report — Last 3 Days');
    expect(md).toContain('No friction events found');
  });

  it('groups events by type and counts sessions', () => {
    const md = formatFrictionReport([
      {
        project: 'ai-tools',
        path: '/p.jsonl',
        events: [
          { type: 'tool_error', session: 's', ts: '2026-06-20', detail: 'oops' },
          { type: 'user_correction', session: 's', ts: '2026-06-20', detail: 'no' },
        ],
      },
    ]);
    expect(md).toContain('## Tool Errors (failed tool calls) (1 events)');
    expect(md).toContain('## User Corrections (direction changes) (1 events)');
    expect(md).toContain('`ai-tools`');
    expect(md).toContain('> oops');
    expect(md).toContain('Sessions with friction: 1');
  });
});
