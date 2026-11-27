import { describe, it, expect } from 'vitest';
import {
  signComment,
  framingBody,
  parseDiscussionRef,
  resolveDiscussionsRepo,
  requireDiscussionsRepo,
  MISSING_DISCUSSIONS_REPO,
} from '../src/discuss-helpers.js';

describe('signComment', () => {
  it('signs with model + project, trimming trailing newlines', () => {
    expect(
      signComment('an approach\n\n', { model: 'Claude Opus 4.8', project: 'rmartz/trip-planner' }),
    ).toBe('an approach\n\n---\n*Posted by Claude Opus 4.8 (rmartz/trip-planner)*');
  });

  it('signs with model + project @ commit when a commit is given', () => {
    expect(
      signComment('an approach', {
        model: 'Claude Opus 4.8',
        project: 'rmartz/trip-planner',
        commit: 'a1b2c3d4e5f6',
      }),
    ).toBe('an approach\n\n---\n*Posted by Claude Opus 4.8 (rmartz/trip-planner @ a1b2c3d4e5f6)*');
  });

  it('drops the commit when no project anchors it', () => {
    expect(signComment('x', { model: 'Claude Opus 4.8', commit: 'a1b2c3d4e5f6' })).toBe(
      'x\n\n---\n*Posted by Claude Opus 4.8*',
    );
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

describe('parseDiscussionRef', () => {
  it('resolves a bare number against the default repo', () => {
    expect(parseDiscussionRef('2', 'octo/knowledge')).toEqual({
      repo: 'octo/knowledge',
      number: 2,
    });
  });

  it('takes repo + number from a discussions URL (overriding the default)', () => {
    expect(
      parseDiscussionRef('https://github.com/octo/knowledge/discussions/2', 'other/repo'),
    ).toEqual({
      repo: 'octo/knowledge',
      number: 2,
    });
  });

  it('throws the missing-repo error for a bare number with no default repo', () => {
    expect(() => parseDiscussionRef('2', undefined)).toThrow(MISSING_DISCUSSIONS_REPO);
  });

  it('takes a discussions URL without a default repo', () => {
    expect(
      parseDiscussionRef('https://github.com/octo/knowledge/discussions/3', undefined),
    ).toEqual({ repo: 'octo/knowledge', number: 3 });
  });

  it('returns null for a non-discussion arg', () => {
    expect(parseDiscussionRef('not-a-ref', 'octo/knowledge')).toBeNull();
    expect(
      parseDiscussionRef('https://github.com/octo/knowledge/issues/2', 'octo/knowledge'),
    ).toBeNull();
  });
});

describe('resolveDiscussionsRepo', () => {
  it('prefers the explicit flag over the env var', () => {
    expect(resolveDiscussionsRepo('flag/repo', { AI_DISCUSSIONS_REPO: 'env/repo' })).toBe(
      'flag/repo',
    );
  });

  it('falls back to AI_DISCUSSIONS_REPO', () => {
    expect(resolveDiscussionsRepo(undefined, { AI_DISCUSSIONS_REPO: ' env/repo ' })).toBe(
      'env/repo',
    );
  });

  it('falls back to the env var when the flag is blank', () => {
    expect(resolveDiscussionsRepo('  ', { AI_DISCUSSIONS_REPO: 'env/repo' })).toBe('env/repo');
  });

  it('treats a blank env var as unset', () => {
    expect(resolveDiscussionsRepo(undefined, { AI_DISCUSSIONS_REPO: '  ' })).toBeUndefined();
  });
});

describe('requireDiscussionsRepo', () => {
  it('returns the configured repo', () => {
    expect(requireDiscussionsRepo(undefined, { AI_DISCUSSIONS_REPO: 'env/repo' })).toBe('env/repo');
  });

  it('throws a message naming the flag and env var when neither is set', () => {
    expect(() => requireDiscussionsRepo(undefined, {})).toThrow(
      'no Discussions repo configured: pass --repo owner/repo or set AI_DISCUSSIONS_REPO',
    );
  });
});
