import { describe, it, expect } from 'vitest';
import { gatherMergeSafetyFacts, type GitRunner, type PrMergeMeta } from './merge-safety-facts.js';

/** A fake `git` keyed by argv joined with spaces; missing keys return `null`. */
function fakeGit(responses: Record<string, string>): GitRunner {
  return async (args) => responses[args.join(' ')] ?? null;
}

const meta: PrMergeMeta = {
  headSha: 'HEAD1',
  title: 'feat: add a thing',
  labels: [],
  mergeable: 'MERGEABLE',
};

describe('gatherMergeSafetyFacts', () => {
  it('assembles stale facts from git output — breaking base commit + file overlap', async () => {
    const git = fakeGit({
      'merge-base HEAD1 origin/main': 'BASE',
      'rev-parse origin/main': 'TIP', // != BASE → stale
      'log -z --format=%B BASE..origin/main': 'feat(api)!: rename field\0ci: add job',
      'diff --name-only BASE origin/main': 'src/a.ts\nsrc/shared.ts',
      'diff --name-only BASE HEAD1': 'src/shared.ts\nsrc/b.ts',
    });

    const facts = await gatherMergeSafetyFacts(meta, { git });

    expect(facts.isCurrent).toBe(false);
    expect(facts.baseBreakingSinceMergeBase).toBe(true);
    expect(facts.baseCiSinceMergeBase).toBe(true);
    expect(facts.fileOverlap).toBe(true); // src/shared.ts on both sides
    expect(facts.prIsBreaking).toBe(false);
    expect(facts.hasConflict).toBe(false);
  });

  it('reports current + no triggers when merge-base equals the base tip', async () => {
    const git = fakeGit({
      'merge-base HEAD1 origin/main': 'TIP',
      'rev-parse origin/main': 'TIP',
      'log -z --format=%B TIP..origin/main': '',
      'diff --name-only TIP origin/main': '',
      'diff --name-only TIP HEAD1': 'src/b.ts',
    });

    const facts = await gatherMergeSafetyFacts(meta, { git });

    expect(facts.isCurrent).toBe(true);
    expect(facts.baseBreakingSinceMergeBase).toBe(false);
    expect(facts.fileOverlap).toBe(false);
  });

  it('honors the breaking-change label and a CONFLICTING mergeable state', async () => {
    const git = fakeGit({
      'merge-base HEAD1 origin/main': 'BASE',
      'rev-parse origin/main': 'TIP',
      'log -z --format=%B BASE..origin/main': 'fix: small',
      'diff --name-only BASE origin/main': 'src/a.ts',
      'diff --name-only BASE HEAD1': 'src/b.ts',
    });

    const facts = await gatherMergeSafetyFacts(
      { ...meta, labels: ['Breaking Change'], mergeable: 'conflicting' },
      { git },
    );

    expect(facts.prIsBreaking).toBe(true);
    expect(facts.hasConflict).toBe(true);
  });

  it('throws when the merge-base cannot be resolved (caller must fail the check)', async () => {
    const git = fakeGit({ 'rev-parse origin/main': 'TIP' });
    await expect(gatherMergeSafetyFacts(meta, { git })).rejects.toThrow(/merge-base/);
  });

  it('throws when git log returns null — never silently produces false success', async () => {
    const git = fakeGit({
      'merge-base HEAD1 origin/main': 'BASE',
      'rev-parse origin/main': 'TIP',
      // log key absent → null
      'diff --name-only BASE origin/main': 'src/a.ts',
      'diff --name-only BASE HEAD1': 'src/b.ts',
    });
    await expect(gatherMergeSafetyFacts(meta, { git })).rejects.toThrow(/git log failed/);
  });

  it('throws when git diff returns null — never silently produces false success', async () => {
    const git = fakeGit({
      'merge-base HEAD1 origin/main': 'BASE',
      'rev-parse origin/main': 'TIP',
      'log -z --format=%B BASE..origin/main': 'feat!: breaking',
      // diff keys absent → null
    });
    await expect(gatherMergeSafetyFacts(meta, { git })).rejects.toThrow(/git diff failed/);
  });
});
