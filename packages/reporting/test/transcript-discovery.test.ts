import { describe, it, expect } from 'vitest';
import { discoverTranscripts, type TranscriptFs } from '../src/transcript-discovery.js';

const MS_PER_DAY = 86_400_000;
const NOW = Date.UTC(2026, 6, 5, 12, 0, 0); // 2026-07-05T12:00:00Z

/**
 * A hermetic in-memory {@link TranscriptFs}. `entries` maps an absolute path to
 * its mtime (epoch-ms); `listJsonl` returns the keys for a matching root and the
 * empty list otherwise (so a "missing root" is modeled by asking for a root that
 * holds nothing).
 */
function makeFs(root: string, entries: Record<string, number>): TranscriptFs {
  return {
    listJsonl: (r) => (r === root ? Object.keys(entries) : []),
    mtimeMs: (p) => entries[p] ?? 0,
  };
}

describe('discoverTranscripts', () => {
  it('keeps files inside the window and drops files outside it', () => {
    const root = '/projects';
    const fs = makeFs(root, {
      '/projects/recent.jsonl': NOW - 2 * MS_PER_DAY,
      '/projects/stale.jsonl': NOW - 10 * MS_PER_DAY,
    });

    const found = discoverTranscripts({ root, days: 7, now: NOW, fs });

    expect(found).toEqual(['/projects/recent.jsonl']);
  });

  it('includes a file exactly on the lower boundary (inclusive)', () => {
    const root = '/projects';
    const fs = makeFs(root, {
      '/projects/edge.jsonl': NOW - 7 * MS_PER_DAY, // exactly now - days*MS_PER_DAY
      '/projects/past.jsonl': NOW - 7 * MS_PER_DAY - 1, // one ms older → excluded
    });

    const found = discoverTranscripts({ root, days: 7, now: NOW, fs });

    expect(found).toEqual(['/projects/edge.jsonl']);
  });

  it('applies the default 7-day window when days is omitted', () => {
    const root = '/projects';
    const fs = makeFs(root, {
      '/projects/within.jsonl': NOW - 6 * MS_PER_DAY,
      '/projects/beyond.jsonl': NOW - 8 * MS_PER_DAY,
    });

    const found = discoverTranscripts({ root, now: NOW, fs });

    expect(found).toEqual(['/projects/within.jsonl']);
  });

  it('returns [] when the root holds no transcripts (missing/empty root)', () => {
    const fs = makeFs('/populated', { '/populated/a.jsonl': NOW });

    const found = discoverTranscripts({ root: '/empty', days: 7, now: NOW, fs });

    expect(found).toEqual([]);
  });

  it('sorts most-recent first, breaking ties by lexical path', () => {
    const root = '/projects';
    const tie = NOW - MS_PER_DAY;
    const fs = makeFs(root, {
      '/projects/b-old.jsonl': NOW - 5 * MS_PER_DAY,
      '/projects/z-tie.jsonl': tie,
      '/projects/a-tie.jsonl': tie,
      '/projects/newest.jsonl': NOW - 1000,
    });

    const found = discoverTranscripts({ root, days: 7, now: NOW, fs });

    expect(found).toEqual([
      '/projects/newest.jsonl',
      '/projects/a-tie.jsonl',
      '/projects/z-tie.jsonl',
      '/projects/b-old.jsonl',
    ]);
  });
});
