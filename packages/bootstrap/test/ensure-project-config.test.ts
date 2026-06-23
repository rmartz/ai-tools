import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Pure fs — still deny network by mocking the runtime to a hard failure, proving
// ensure-project-config never shells out.
import { vi } from 'vitest';
vi.mock('@rmartz/agent-runtime', () => ({
  boundedRun: vi.fn(async () => {
    throw new Error('boundedRun must not be called by ensure-project-config');
  }),
}));

const { ensureProjectConfig, BLOCK_BEGIN, BLOCK_END } =
  await import('../src/ensure-project-config.js');

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'epc-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const read = (name: string) => readFileSync(join(dir, name), 'utf8');

describe('ensureProjectConfig', () => {
  it('creates all golden ignore files in a fresh repo', () => {
    const res = ensureProjectConfig(dir);
    expect(res.outcomes.every((o) => o.action === 'created')).toBe(true);
    expect(existsSync(join(dir, '.prettierignore'))).toBe(true);
    expect(existsSync(join(dir, '.eslintignore'))).toBe(true);
    expect(existsSync(join(dir, '.gitignore'))).toBe(true);
  });

  it('writes a fenced managed block with the expected entries', () => {
    ensureProjectConfig(dir);
    const text = read('.gitignore');
    expect(text).toContain(BLOCK_BEGIN);
    expect(text).toContain(BLOCK_END);
    expect(text).toContain('.git-worktrees/');
    expect(text).toContain('node_modules/');
    expect(text).toContain('dist/');
  });

  it('is idempotent — a second run reports unchanged and does not duplicate the block', () => {
    ensureProjectConfig(dir);
    const first = read('.prettierignore');
    const res = ensureProjectConfig(dir);
    expect(res.outcomes.every((o) => o.action === 'unchanged')).toBe(true);
    expect(read('.prettierignore')).toBe(first);
    // Exactly one managed block.
    const occurrences = first.split(BLOCK_BEGIN).length - 1;
    expect(occurrences).toBe(1);
  });

  it('preserves user-authored lines outside the managed block', () => {
    writeFileSync(join(dir, '.gitignore'), '# my custom ignore\n*.local\n');
    ensureProjectConfig(dir);
    const text = read('.gitignore');
    expect(text).toContain('# my custom ignore');
    expect(text).toContain('*.local');
    expect(text).toContain(BLOCK_BEGIN);
    // User content precedes the managed block.
    expect(text.indexOf('*.local')).toBeLessThan(text.indexOf(BLOCK_BEGIN));
  });

  it('refreshes a stale managed block without touching surrounding content', () => {
    const stale = `keep-me\n${BLOCK_BEGIN}\nOLD_ENTRY\n${BLOCK_END}\ntrailing-line\n`;
    writeFileSync(join(dir, '.eslintignore'), stale);
    const res = ensureProjectConfig(dir);
    const epc = res.outcomes.find((o) => o.filename === '.eslintignore');
    expect(epc?.action).toBe('updated');
    const text = read('.eslintignore');
    expect(text).toContain('keep-me');
    expect(text).toContain('trailing-line');
    expect(text).not.toContain('OLD_ENTRY');
    expect(text).toContain('node_modules/');
  });

  it('honors an injected file set', () => {
    const res = ensureProjectConfig(dir, {
      files: [{ filename: '.customignore', entries: ['foo/'] }],
    });
    expect(res.outcomes).toEqual([{ filename: '.customignore', action: 'created' }]);
    expect(read('.customignore')).toContain('foo/');
    expect(existsSync(join(dir, '.gitignore'))).toBe(false);
  });
});
