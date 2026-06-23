import { describe, it, expect } from 'vitest';

import {
  renderSkillMeta,
  skillMetaPattern,
  hasSkillMeta,
  countSkillMeta,
} from '../src/skill-meta.js';

const base = { skill: 'review', prHead: 'abc1234', skillHash: 'def5678' };

describe('renderSkillMeta', () => {
  it('renders the three required fields in contract order with the exact spacing', () => {
    // External contract: space after each ":", no space after each ",",
    // mirroring the Python json.dumps(separators=(",", ": ")).
    expect(renderSkillMeta(base)).toBe(
      '<!-- skill-meta: {"skill": "review","pr_head": "abc1234","skill_hash": "def5678"} -->',
    );
  });

  it('appends agent and outcome after the required fields, in order', () => {
    expect(
      renderSkillMeta({ ...base, skill: 'merge', agent: 'Claude Opus 4.8', outcome: 'conflict' }),
    ).toBe(
      '<!-- skill-meta: {"skill": "merge","pr_head": "abc1234","skill_hash": "def5678",' +
        '"agent": "Claude Opus 4.8","outcome": "conflict"} -->',
    );
  });

  it('renders correlation fields last when supplied', () => {
    const out = renderSkillMeta({
      ...base,
      agent: 'Claude Opus 4.8',
      outcome: 'approved',
      transcript: 'sess-abc',
      coordinatorStartedAt: '2026-06-18T12:34:56+00:00',
    });
    expect(out).toBe(
      '<!-- skill-meta: {"skill": "review","pr_head": "abc1234","skill_hash": "def5678",' +
        '"agent": "Claude Opus 4.8","outcome": "approved",' +
        '"transcript": "sess-abc","coordinator_started_at": "2026-06-18T12:34:56+00:00"} -->',
    );
  });

  it('always emits skill first so a "skill"-anchored regex keeps matching', () => {
    const out = renderSkillMeta({ ...base, transcript: 'sess-1', agent: 'm' });
    expect(out.indexOf('"skill"')).toBeLessThan(out.indexOf('"transcript"'));
    expect(skillMetaPattern('review').test(out)).toBe(true);
  });

  it('omits optional fields that are undefined or empty (mirrors Python truthiness)', () => {
    expect(renderSkillMeta({ ...base, agent: '', outcome: undefined })).toBe(
      '<!-- skill-meta: {"skill": "review","pr_head": "abc1234","skill_hash": "def5678"} -->',
    );
  });

  it('JSON-escapes values so the marker stays valid', () => {
    const out = renderSkillMeta({ ...base, agent: 'a "quoted" name' });
    expect(out).toContain('"agent": "a \\"quoted\\" name"');
  });

  it('is deterministic — no clock or randomness in the output', () => {
    expect(renderSkillMeta(base)).toBe(renderSkillMeta(base));
  });
});

describe('skillMetaPattern / hasSkillMeta', () => {
  it('matches the marker it just rendered for the named skill', () => {
    expect(hasSkillMeta(renderSkillMeta(base), 'review')).toBe(true);
  });

  it('does not match a marker for a different skill', () => {
    expect(hasSkillMeta(renderSkillMeta(base), 'merge')).toBe(false);
  });

  it('matches any skill when no name is given', () => {
    expect(hasSkillMeta(renderSkillMeta({ ...base, skill: 'fix-review' }))).toBe(true);
  });

  it('tolerates whitespace around the delimiters and the colon (case-insensitive)', () => {
    const body = '<!--   Skill-Meta:  { "skill" : "review", "pr_head": "x" } -->';
    expect(hasSkillMeta(body, 'review')).toBe(true);
  });

  it('finds a marker embedded in a larger body', () => {
    const body = `Some verdict text.\n\n${renderSkillMeta(base)}\n`;
    expect(hasSkillMeta(body, 'review')).toBe(true);
  });

  it('escapes regex-special characters in the skill name', () => {
    const out = renderSkillMeta({ ...base, skill: 'fix.review' });
    expect(hasSkillMeta(out, 'fix.review')).toBe(true);
    // The "." must be literal, not a wildcard.
    expect(hasSkillMeta(renderSkillMeta({ ...base, skill: 'fixXreview' }), 'fix.review')).toBe(
      false,
    );
  });
});

describe('countSkillMeta', () => {
  const reviewMarker = renderSkillMeta(base);
  const mergeMarker = renderSkillMeta({ ...base, skill: 'merge' });

  it('counts only bodies carrying the named skill marker', () => {
    const bodies = [reviewMarker, 'no marker here', mergeMarker, `prefix ${reviewMarker}`];
    expect(countSkillMeta(bodies, 'review')).toBe(2);
    expect(countSkillMeta(bodies, 'merge')).toBe(1);
  });

  it('counts any-skill markers when no name is given', () => {
    expect(countSkillMeta([reviewMarker, mergeMarker, 'plain'])).toBe(2);
  });

  it('returns 0 for an empty list', () => {
    expect(countSkillMeta([], 'review')).toBe(0);
  });

  it('counts a body with two markers once (mirrors the Python per-body sum)', () => {
    expect(countSkillMeta([`${reviewMarker}\n${reviewMarker}`], 'review')).toBe(1);
  });
});
