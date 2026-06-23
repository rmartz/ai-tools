import { describe, it, expect, vi, beforeEach } from 'vitest';

const boundedRun = vi.fn();
vi.mock('@rmartz/agent-runtime', () => ({ boundedRun }));

const ok = (stdout: string) => ({ stdout, stderr: '', code: 0, timedOut: false });

const { postPrComment, appendSignature } = await import('../src/pr-comment.js');

describe('appendSignature', () => {
  it('places the model footer after a --- rule, trimming trailing newlines', () => {
    expect(appendSignature('hello\n\n', 'Claude Opus 4.8')).toBe(
      'hello\n\n---\n\n_Claude Opus 4.8_\n',
    );
  });
});

describe('postPrComment', () => {
  beforeEach(() => boundedRun.mockReset());

  it('appends the signing footer and posts via the REST comment endpoint', async () => {
    boundedRun.mockResolvedValueOnce(ok('https://github.com/r/r/issues/5#c1'));
    const url = await postPrComment('r/r', 5, 'body text', { model: 'Claude Opus 4.8' });
    expect(url).toBe('https://github.com/r/r/issues/5#c1');
    const [, args, opts] = boundedRun.mock.calls[0];
    expect(args).toContain('repos/r/r/issues/5/comments');
    expect(opts.input).toContain('body text');
    expect(opts.input).toContain('_Claude Opus 4.8_');
  });

  it('appends a pre-rendered skill-meta marker after the footer', async () => {
    boundedRun.mockResolvedValueOnce(ok('url'));
    await postPrComment('r/r', 5, 'b', { model: 'M', skillMeta: '<!-- skill-meta: review -->' });
    const [, , opts] = boundedRun.mock.calls[0];
    const body = JSON.parse(opts.input).body as string;
    expect(body.indexOf('_M_')).toBeLessThan(body.indexOf('<!-- skill-meta'));
  });

  it('posts a bare body when no model is given', async () => {
    boundedRun.mockResolvedValueOnce(ok('url'));
    await postPrComment('r/r', 5, 'plain');
    const [, , opts] = boundedRun.mock.calls[0];
    expect(JSON.parse(opts.input).body).toBe('plain');
  });

  it('returns null without posting for an unparseable PR reference', async () => {
    const url = await postPrComment('r/r', 'garbage', 'b', { model: 'M' });
    expect(url).toBeNull();
    expect(boundedRun).not.toHaveBeenCalled();
  });
});
