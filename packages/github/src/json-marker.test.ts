import { describe, it, expect } from 'vitest';
import { renderJsonMarker, parseLatestJsonMarker } from './json-marker.js';

describe('renderJsonMarker / parseLatestJsonMarker', () => {
  it('round-trips a record through the marker envelope', () => {
    const marker = renderJsonMarker('review-findings', { prHead: 'abc', findings: [{ n: 1 }] });
    const parsed = parseLatestJsonMarker<{ prHead: string; findings: { n: number }[] }>(
      'review-findings',
      [marker],
    );
    expect(parsed).toEqual({ prHead: 'abc', findings: [{ n: 1 }] });
  });

  it('carries free-form text containing braces and the closing delimiter', () => {
    const body = 'a review: `x = {a: 1}` and an arrow --> in prose';
    const marker = renderJsonMarker('review-synthesis', {
      reviewBody: body,
      nested: { a: { b: 1 } },
    });
    const parsed = parseLatestJsonMarker<{ reviewBody: string; nested: { a: { b: number } } }>(
      'review-synthesis',
      [`intro text\n${marker}\ntrailing`],
    );
    expect(parsed?.reviewBody).toBe(body);
    expect(parsed?.nested.a.b).toBe(1);
  });

  it('returns the LAST matching record when several are present (latest wins)', () => {
    const bodies = [
      renderJsonMarker('review-findings', { prHead: 'h', v: 1 }),
      renderJsonMarker('review-findings', { prHead: 'h', v: 2 }),
    ];
    expect(parseLatestJsonMarker<{ v: number }>('review-findings', bodies)?.v).toBe(2);
  });

  it('filters by a match predicate, ignoring stale-head records', () => {
    const bodies = [
      renderJsonMarker('review-findings', { prHead: 'old', v: 1 }),
      renderJsonMarker('review-findings', { prHead: 'new', v: 2 }),
    ];
    const parsed = parseLatestJsonMarker<{ prHead: string; v: number }>('review-findings', bodies, {
      match: (r) => r.prHead === 'old',
    });
    expect(parsed?.v).toBe(1);
  });

  it('ignores markers of a different kind', () => {
    const bodies = [renderJsonMarker('review-synthesis', { v: 1 })];
    expect(parseLatestJsonMarker('review-findings', bodies)).toBeNull();
  });

  it('soft-fails on a malformed payload rather than throwing', () => {
    const bodies = [
      '<!-- review-findings: not-valid-base64!!! -->',
      '<!-- review-findings: ' + Buffer.from('{bad json').toString('base64') + ' -->',
    ];
    expect(parseLatestJsonMarker('review-findings', bodies)).toBeNull();
  });

  it('returns null when no marker is present', () => {
    expect(parseLatestJsonMarker('review-findings', ['just a normal comment'])).toBeNull();
  });
});
