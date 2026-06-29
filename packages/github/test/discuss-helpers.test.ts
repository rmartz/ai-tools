import { describe, it, expect } from 'vitest';
import { signComment, framingBody } from '../src/discuss-helpers.js';

describe('signComment', () => {
  it('appends the model footer, trimming trailing newlines', () => {
    expect(signComment('an approach\n\n', 'Claude Opus 4.8')).toBe(
      'an approach\n\n---\n*Posted by Claude Opus 4.8*',
    );
  });

  it('returns the body unchanged when no model is given', () => {
    expect(signComment('an approach')).toBe('an approach');
  });
});

describe('framingBody', () => {
  it('frames the recurring problem and points approaches to comments', () => {
    const body = framingBody('Flaky vitest under parallel workers');
    expect(body).toContain('Recurring problem: Flaky vitest under parallel workers');
    expect(body).toContain('recorded as comments');
  });
});
