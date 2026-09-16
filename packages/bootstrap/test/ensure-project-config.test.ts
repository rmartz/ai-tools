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
    const ignoreFiles = ['.prettierignore', '.eslintignore', '.gitignore'];
    for (const name of ignoreFiles) {
      expect(res.outcomes.find((o) => o.filename === name)?.action).toBe('created');
      expect(existsSync(join(dir, name))).toBe(true);
    }
  });

  it('writes a fenced managed block with the expected entries', () => {
    ensureProjectConfig(dir);
    const text = read('.gitignore');
    expect(text).toContain(BLOCK_BEGIN);
    expect(text).toContain(BLOCK_END);
    expect(text).toContain('node_modules/');
    expect(text).toContain('dist/');
  });

  it('does not seed `.git-worktrees/` — that is a per-developer global-excludes concern', () => {
    ensureProjectConfig(dir);
    expect(read('.gitignore')).not.toContain('.git-worktrees/');
    expect(read('.prettierignore')).not.toContain('.git-worktrees/');
    expect(read('.eslintignore')).not.toContain('.git-worktrees/');
  });

  it('strips a stale `.git-worktrees/` line from the managed block on the next run', () => {
    const stale = `${BLOCK_BEGIN}\nnode_modules/\n.git-worktrees/\n${BLOCK_END}\n`;
    writeFileSync(join(dir, '.gitignore'), stale);
    const res = ensureProjectConfig(dir);
    const outcome = res.outcomes.find((o) => o.filename === '.gitignore');
    expect(outcome?.action).toBe('updated');
    expect(read('.gitignore')).not.toContain('.git-worktrees/');
  });

  it('is idempotent — a second run reports unchanged and does not duplicate the block', () => {
    ensureProjectConfig(dir);
    const first = read('.prettierignore');
    const res = ensureProjectConfig(dir);
    // No new writes on a second run: everything is unchanged, and the gated
    // auto-merge workflow stays withheld (idempotent, not re-created).
    expect(res.outcomes.every((o) => o.action === 'unchanged' || o.action === 'withheld')).toBe(
      true,
    );
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

  it('honors injected file/workflow sets', () => {
    const res = ensureProjectConfig(dir, {
      files: [{ filename: '.customignore', entries: ['foo/'] }],
      workflows: [],
    });
    expect(res.outcomes).toEqual([{ filename: '.customignore', action: 'created' }]);
    expect(read('.customignore')).toContain('foo/');
    expect(existsSync(join(dir, '.gitignore'))).toBe(false);
  });

  it('seeds the ungated golden workflow files alongside the ignore blocks (still hermetic)', () => {
    // boundedRun is mocked to throw above, so a passing run proves this composed
    // path never shells out — the whole-file writer is pure fs too.
    const res = ensureProjectConfig(dir);
    const mergeSafety = res.outcomes.find(
      (o) => o.filename === '.github/workflows/merge-safety.yml',
    );
    expect(mergeSafety?.action).toBe('created');
  });

  it('withholds the gated auto-merge workflow by default — never seeds it ungated (#239)', () => {
    const res = ensureProjectConfig(dir);
    const autoMerge = res.outcomes.find(
      (o) => o.filename === '.github/workflows/dependabot-auto-merge.yml',
    );
    expect(autoMerge?.action).toBe('withheld');
    expect(existsSync(join(dir, '.github/workflows/dependabot-auto-merge.yml'))).toBe(false);
  });

  it('seeds the auto-merge workflow when its gate is passed as satisfied', () => {
    const res = ensureProjectConfig(dir, { satisfiedGateChecks: ['merge-safety'] });
    const autoMerge = res.outcomes.find(
      (o) => o.filename === '.github/workflows/dependabot-auto-merge.yml',
    );
    expect(autoMerge?.action).toBe('created');
    expect(existsSync(join(dir, '.github/workflows/dependabot-auto-merge.yml'))).toBe(true);
  });
});
