import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseLogEvents, parseLogEventsText } from '../src/log-events.js';

describe('parseLogEventsText', () => {
  it('parses one object per line', () => {
    const events = parseLogEventsText('{"a":1}\n{"b":2}\n');
    expect(events).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('skips blank and whitespace-only lines', () => {
    const events = parseLogEventsText('{"a":1}\n\n   \n{"b":2}');
    expect(events).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('silently skips lines that are not valid JSON', () => {
    const events = parseLogEventsText('{"a":1}\nnot json\n{bad}\n{"b":2}');
    expect(events).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('preserves any valid JSON value verbatim (mirrors the Python json.loads)', () => {
    const events = parseLogEventsText('42\n"str"\ntrue\nnull\n[1,2]\n{"keep":true}');
    expect(events).toEqual([42, 'str', true, null, [1, 2], { keep: true }]);
  });

  it('returns an empty list for empty input', () => {
    expect(parseLogEventsText('')).toEqual([]);
  });
});

describe('parseLogEvents (injected reader)', () => {
  it('reads through the injected boundary without touching the filesystem', () => {
    const events = parseLogEvents('whatever.jsonl', () => '{"x":1}\n{"y":2}');
    expect(events).toEqual([{ x: 1 }, { y: 2 }]);
  });

  it('returns an empty list when the reader throws (missing/unreadable file)', () => {
    const events = parseLogEvents('nope.jsonl', () => {
      throw new Error('ENOENT');
    });
    expect(events).toEqual([]);
  });
});

describe('parseLogEvents (default fs reader)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'log-events-'));
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('reads and parses a real JSONL file', () => {
    const path = join(dir, 'run.jsonl');
    writeFileSync(path, '{"event":"start"}\n{"event":"end"}\n');
    expect(parseLogEvents(path)).toEqual([{ event: 'start' }, { event: 'end' }]);
  });

  it('returns an empty list for an absent file', () => {
    expect(parseLogEvents(join(dir, 'missing.jsonl'))).toEqual([]);
  });
});
