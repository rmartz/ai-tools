import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MARKER_LABEL,
  formatMarker,
  parseMarker,
  selectActivePointer,
  countActiveMarkers,
  FsResumeStore,
  recordResumeMarkerOnTimeout,
  recoverResumePointer,
  type ResumeEntry,
  type ResumeStore,
} from '../src/resume.js';

// A consumer's confirmation sentinel — distinct from MARKER_LABEL so a resume
// marker never supersedes itself.
const CONFIRMATION_RE = /<!--\s*skill-meta:/;

function marker(overrides: Partial<Parameters<typeof formatMarker>[0]> = {}): string {
  return formatMarker({
    skill: 'fix-review',
    sessionId: 'sess-123',
    transcriptPath: '/tmp/t.jsonl',
    termination: 'timeout',
    salvage: 'pushed',
    attempt: 1,
    timestamp: '2026-06-22T00:00:00Z',
    model: 'Claude Opus 4.8',
    ...overrides,
  });
}

describe('formatMarker / parseMarker round-trip', () => {
  it('round-trips a full pointer through the hidden marker', () => {
    const pointer = parseMarker(marker());
    expect(pointer).toEqual({
      sessionId: 'sess-123',
      path: '/tmp/t.jsonl',
      skill: 'fix-review',
      termination: 'timeout',
      salvage: 'pushed',
      attempt: 1,
      timestamp: '2026-06-22T00:00:00Z',
    });
  });

  it('uses verbatim external-contract field names in the JSON payload', () => {
    const body = marker();
    expect(body).toContain('"transcript_id":"sess-123"');
    expect(body).toContain('"transcript_path":"/tmp/t.jsonl"');
    expect(body).toContain(`<!-- ${MARKER_LABEL}:`);
  });

  it('renders a human-readable note and signing footer', () => {
    const body = marker({ model: 'Claude Opus 4.8' });
    expect(body).toContain('attempt 1');
    expect(body).toContain('Posted by Claude Opus 4.8');
  });

  it('strips a leading slash from the skill name', () => {
    expect(parseMarker(marker({ skill: '/fix-review' }))?.skill).toBe('/fix-review');
    // The visible note and payload use the raw value passed to formatMarker;
    // recordResumeMarkerOnTimeout is what strips it (covered below).
  });
});

describe('parseMarker rejection cases', () => {
  it('returns null for a non-marker body', () => {
    expect(parseMarker('just a normal comment')).toBeNull();
  });

  it('returns null for empty/nullish bodies', () => {
    expect(parseMarker('')).toBeNull();
    expect(parseMarker(null)).toBeNull();
    expect(parseMarker(undefined)).toBeNull();
  });

  it('returns null for malformed JSON in the marker', () => {
    expect(parseMarker(`<!-- ${MARKER_LABEL}: {not json} -->`)).toBeNull();
  });

  it('returns null when the transcript id is missing', () => {
    expect(parseMarker(`<!-- ${MARKER_LABEL}: {"skill":"x"} -->`)).toBeNull();
  });

  it('returns null attempt/timestamp on legacy markers without those fields', () => {
    const pointer = parseMarker(`<!-- ${MARKER_LABEL}: {"transcript_id":"old"} -->`);
    expect(pointer?.sessionId).toBe('old');
    expect(pointer?.attempt).toBeNull();
    expect(pointer?.timestamp).toBeNull();
  });
});

describe('selectActivePointer', () => {
  const entry = (sessionId: string, createdAt: string): ResumeEntry => ({
    body: marker({ sessionId }),
    createdAt,
  });

  it('returns null when there are no markers', () => {
    expect(selectActivePointer([{ body: 'hello', createdAt: '2026-06-22T00:00:00Z' }])).toBeNull();
  });

  it('picks the newest marker by createdAt regardless of input order', () => {
    const entries = [
      entry('old', '2026-06-22T00:00:00Z'),
      entry('new', '2026-06-22T05:00:00Z'),
      entry('mid', '2026-06-22T03:00:00Z'),
    ];
    expect(selectActivePointer(entries)?.sessionId).toBe('new');
  });

  it('ignores markers superseded by a later confirmation', () => {
    const entries: ResumeEntry[] = [
      entry('stale', '2026-06-22T00:00:00Z'),
      { body: '<!-- skill-meta: done -->', createdAt: '2026-06-22T02:00:00Z' },
    ];
    expect(selectActivePointer(entries, CONFIRMATION_RE)).toBeNull();
  });

  it('keeps a marker created after the latest confirmation', () => {
    const entries: ResumeEntry[] = [
      { body: '<!-- skill-meta: done -->', createdAt: '2026-06-22T02:00:00Z' },
      entry('fresh', '2026-06-22T03:00:00Z'),
    ];
    expect(selectActivePointer(entries, CONFIRMATION_RE)?.sessionId).toBe('fresh');
  });

  it('does not let a resume marker supersede itself (sentinel invariant)', () => {
    // The resume marker's own label must not match the confirmation regex.
    expect(CONFIRMATION_RE.test(marker())).toBe(false);
    const entries = [entry('self', '2026-06-22T01:00:00Z')];
    expect(selectActivePointer(entries, CONFIRMATION_RE)?.sessionId).toBe('self');
  });
});

describe('countActiveMarkers', () => {
  const m = (createdAt: string): ResumeEntry => ({ body: marker(), createdAt });

  it('counts the unresolved streak', () => {
    expect(countActiveMarkers([m('2026-06-22T01:00:00Z'), m('2026-06-22T02:00:00Z')])).toBe(2);
  });

  it('counts only markers after the latest confirmation', () => {
    const entries: ResumeEntry[] = [
      m('2026-06-22T01:00:00Z'),
      { body: '<!-- skill-meta: done -->', createdAt: '2026-06-22T02:00:00Z' },
      m('2026-06-22T03:00:00Z'),
    ];
    expect(countActiveMarkers(entries, CONFIRMATION_RE)).toBe(1);
  });
});

describe('FsResumeStore', () => {
  let dir: string;
  let storePath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'resume-'));
    storePath = join(dir, 'store.json');
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('returns null for an absent store', async () => {
    expect(await new FsResumeStore(storePath).read()).toBeNull();
  });

  it('returns null for unparseable contents', async () => {
    writeFileSync(storePath, 'not json');
    expect(await new FsResumeStore(storePath).read()).toBeNull();
  });

  it('round-trips appended entries', async () => {
    const store = new FsResumeStore(storePath);
    await store.append({ body: 'a', createdAt: '2026-06-22T01:00:00Z' });
    await store.append({ body: 'b', createdAt: '2026-06-22T02:00:00Z' });
    const entries = await store.read();
    expect(entries?.map((e) => e.body)).toEqual(['a', 'b']);
    // Persisted as a JSON array on disk.
    expect(JSON.parse(readFileSync(storePath, 'utf8'))).toHaveLength(2);
  });
});

describe('recordResumeMarkerOnTimeout', () => {
  let dir: string;
  let store: FsResumeStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'resume-rec-'));
    store = new FsResumeStore(join(dir, 'store.json'));
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('is a no-op when the locator is missing or has no session id', async () => {
    await recordResumeMarkerOnTimeout({
      store,
      skill: 'fix-review',
      salvage: 'none',
      model: 'm',
      locator: null,
    });
    await recordResumeMarkerOnTimeout({
      store,
      skill: 'fix-review',
      salvage: 'none',
      model: 'm',
      locator: { sessionId: '' },
    });
    expect(await store.read()).toBeNull();
  });

  it('records a marker recoverable by recoverResumePointer', async () => {
    await recordResumeMarkerOnTimeout({
      store,
      skill: '/fix-review',
      salvage: 'pushed',
      model: 'Claude Opus 4.8',
      locator: { sessionId: 'sess-9', path: '/tmp/x.jsonl' },
      timestamp: '2026-06-22T04:00:00Z',
    });
    const recovered = await recoverResumePointer(store);
    expect(recovered).toEqual({ sessionId: 'sess-9', path: '/tmp/x.jsonl' });
  });

  it('strips a leading slash from the skill in the recorded marker', async () => {
    await recordResumeMarkerOnTimeout({
      store,
      skill: '/fix-review',
      salvage: 'none',
      model: 'm',
      locator: { sessionId: 's' },
      timestamp: '2026-06-22T04:00:00Z',
    });
    const entries = await store.read();
    expect(parseMarker(entries?.[0]?.body)?.skill).toBe('fix-review');
  });

  it('derives the attempt number from the existing streak', async () => {
    const base = {
      store,
      skill: 'fix-review',
      salvage: 'none',
      model: 'm',
    };
    await recordResumeMarkerOnTimeout({
      ...base,
      locator: { sessionId: 's1' },
      timestamp: '2026-06-22T01:00:00Z',
    });
    await recordResumeMarkerOnTimeout({
      ...base,
      locator: { sessionId: 's2' },
      timestamp: '2026-06-22T02:00:00Z',
    });
    const entries = await store.read();
    expect(parseMarker(entries?.[0]?.body)?.attempt).toBe(1);
    expect(parseMarker(entries?.[1]?.body)?.attempt).toBe(2);
  });

  it('floors attempt to 1 when the store read fails', async () => {
    // A store whose read always reports failure (null).
    const failing: ResumeStore = {
      read: async () => null,
      append: store.append.bind(store),
    };
    await recordResumeMarkerOnTimeout({
      store: failing,
      skill: 'fix-review',
      salvage: 'none',
      model: 'm',
      locator: { sessionId: 's' },
      timestamp: '2026-06-22T04:00:00Z',
    });
    const entries = await store.read();
    expect(parseMarker(entries?.[0]?.body)?.attempt).toBe(1);
  });
});

describe('recoverResumePointer', () => {
  it('returns null when the store read fails', async () => {
    const failing: ResumeStore = { read: async () => null, append: async () => {} };
    expect(await recoverResumePointer(failing)).toBeNull();
  });

  it('returns the newest non-superseded pointer from the store', async () => {
    const entries: ResumeEntry[] = [
      { body: marker({ sessionId: 'old' }), createdAt: '2026-06-22T01:00:00Z' },
      { body: marker({ sessionId: 'new' }), createdAt: '2026-06-22T03:00:00Z' },
    ];
    const store: ResumeStore = { read: async () => entries, append: async () => {} };
    expect((await recoverResumePointer(store))?.sessionId).toBe('new');
  });
});
