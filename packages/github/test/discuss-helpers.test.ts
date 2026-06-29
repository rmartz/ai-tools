import { describe, it, expect } from 'vitest';
import { signComment, framingBody } from '../src/discuss-helpers.js';

describe('signComment', () => {
  it('signs with model + project, trimming trailing newlines', () => {
    expect(
      signComment('an approach\n\n', { model: 'Claude Opus 4.8', project: 'rmartz/trip-planner' }),
    ).toBe('an approach\n\n---\n*Posted by Claude Opus 4.8 (rmartz/trip-planner)*');
  });

  it('accepts a bare model string (back-compat)', () => {
    expect(signComment('x', 'Claude Sonnet 4.6')).toBe('x\n\n---\n*Posted by Claude Sonnet 4.6*');
  });

  it('signs with project alone when no model is given', () => {
    expect(signComment('x', { project: 'rmartz/ai-tools' })).toBe(
      'x\n\n---\n*Posted by (rmartz/ai-tools)*',
    );
  });

  it('returns the body unchanged when neither model nor project is given', () => {
    expect(signComment('an approach')).toBe('an approach');
    expect(signComment('an approach', {})).toBe('an approach');
  });
});

describe('framingBody', () => {
  it('frames the recurring problem and points approaches to comments', () => {
    const body = framingBody('Flaky vitest under parallel workers');
    expect(body).toContain('Recurring problem: Flaky vitest under parallel workers');
    expect(body).toContain('recorded as comments');
  });
});
