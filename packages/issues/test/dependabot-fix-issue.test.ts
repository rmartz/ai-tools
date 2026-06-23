import { describe, it, expect, vi, beforeEach } from 'vitest';

const createIssue = vi.fn();
const findOpenIssue = vi.fn();
vi.mock('@rmartz/github', () => ({ createIssue, findOpenIssue }));

const { buildDependabotFixIssue, createDependabotFixIssue, FIXES_DEPENDABOT_PREFIX } =
  await import('../src/dependabot-fix-issue.js');

describe('buildDependabotFixIssue', () => {
  it('renders a linkable, dedup-friendly title and body', () => {
    const { title, body, labels } = buildDependabotFixIssue({
      prNumber: 42,
      dependency: 'eslint',
      fromVersion: '8.0.0',
      toVersion: '9.0.0',
      category: 'lint-rule',
      failingCheck: 'Lint',
      failureExcerpt: '  src/foo.ts: no-explicit-any  ',
    });
    expect(title).toContain('Dependabot #42');
    expect(title).toContain('eslint');
    // The back-link line PR Shepherd / the dotfiles convention parses.
    expect(body).toContain(`${FIXES_DEPENDABOT_PREFIX}42`);
    // Bump range is shown in full when both versions are known.
    expect(body).toContain('8.0.0 → 9.0.0');
    // Category guidance and the failure excerpt (trimmed) are present.
    expect(body).toContain('lint rule');
    expect(body).toContain('```\nsrc/foo.ts: no-explicit-any\n```');
    // The manifest/lockfile guardrail is always stated.
    expect(body).toContain('Do not edit `package.json`');
    expect(labels).toEqual([]);
  });

  it('defaults to the unknown-category guidance and omits the bump range', () => {
    const { body } = buildDependabotFixIssue({ prNumber: 7, dependency: 'left-pad' });
    expect(body).toContain('Diagnose the failing check');
    expect(body).not.toContain('→');
    expect(body).toContain('`left-pad`');
  });

  it('passes through caller-supplied labels', () => {
    const { labels } = buildDependabotFixIssue({
      prNumber: 1,
      dependency: 'x',
      labels: ['DevOps'],
    });
    expect(labels).toEqual(['DevOps']);
  });
});

describe('createDependabotFixIssue', () => {
  beforeEach(() => {
    createIssue.mockReset();
    findOpenIssue.mockReset();
  });

  it('creates a new issue when no open duplicate exists', async () => {
    findOpenIssue.mockResolvedValueOnce(null);
    createIssue.mockResolvedValueOnce('https://github.com/r/r/issues/9');
    const result = await createDependabotFixIssue('r/r', { prNumber: 5, dependency: 'eslint' });
    expect(result).toEqual({ url: 'https://github.com/r/r/issues/9', outcome: 'created' });
    // Dedup search keys off the stable title fragment.
    expect(findOpenIssue).toHaveBeenCalledWith('r/r', { titleContains: 'Dependabot #5' }, {});
    const [, createArgs] = createIssue.mock.calls[0];
    expect(createArgs.title).toContain('Dependabot #5');
  });

  it('returns the existing issue without creating when a duplicate is open', async () => {
    findOpenIssue.mockResolvedValueOnce('https://github.com/r/r/issues/3');
    const result = await createDependabotFixIssue('r/r', { prNumber: 5, dependency: 'eslint' });
    expect(result).toEqual({ url: 'https://github.com/r/r/issues/3', outcome: 'existing' });
    expect(createIssue).not.toHaveBeenCalled();
  });

  it('skips dedup when asked', async () => {
    createIssue.mockResolvedValueOnce('https://github.com/r/r/issues/9');
    const result = await createDependabotFixIssue(
      'r/r',
      { prNumber: 5, dependency: 'eslint' },
      { skipDedup: true },
    );
    expect(result.outcome).toBe('created');
    expect(findOpenIssue).not.toHaveBeenCalled();
  });

  it('soft-fails to failed when the create call returns null', async () => {
    findOpenIssue.mockResolvedValueOnce(null);
    createIssue.mockResolvedValueOnce(null);
    const result = await createDependabotFixIssue('r/r', { prNumber: 5, dependency: 'eslint' });
    expect(result).toEqual({ url: null, outcome: 'failed' });
  });
});
