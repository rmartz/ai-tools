import { describe, it, expect } from 'vitest';
import {
  assessDependabotRisk,
  classifySemverChange,
  parseBumpFromDiff,
  verifyDependabotBump,
  type DependabotBump,
} from '../src/dependabot-risk.js';

// A package.json hunk bumping `somepkg` from 3.8.4 to 3.9.4 (as envctl#27 did),
// while Dependabot's *title* misstated the from-version as 3.9.1.
const DIFF_3_8_4_TO_3_9_4 = [
  'diff --git a/package.json b/package.json',
  '@@ -12,7 +12,7 @@',
  '   "dependencies": {',
  '-    "somepkg": "^3.8.4",',
  '+    "somepkg": "^3.9.4",',
  '     "other": "^1.0.0"',
].join('\n');

describe('classifySemverChange', () => {
  it('classifies each delta class', () => {
    expect(classifySemverChange('1.2.3', '2.0.0')).toBe('major');
    expect(classifySemverChange('1.2.3', '1.3.0')).toBe('minor');
    expect(classifySemverChange('1.2.3', '1.2.4')).toBe('patch');
    expect(classifySemverChange('1.2.3', '1.2.3')).toBe('none');
  });

  it('tolerates range prefixes and leading v', () => {
    expect(classifySemverChange('^1.0.0', 'v2.0.0')).toBe('major');
    expect(classifySemverChange('~1.2.0', '1.2.5')).toBe('patch');
  });

  it('returns unknown when either version is unparseable', () => {
    expect(classifySemverChange(undefined, '2.0.0')).toBe('unknown');
    expect(classifySemverChange('latest', 'main')).toBe('unknown');
  });
});

describe('assessDependabotRisk', () => {
  it('flags a semver-major bump as high risk', () => {
    const r = assessDependabotRisk({ name: 'react', fromVersion: '17.0.2', toVersion: '18.0.0' });
    expect(r.level).toBe('high');
    expect(r.semverChange).toBe('major');
    expect(r.reasons[0]).toMatch(/Major version bump/);
  });

  it('escalates a major bump of CI-sensitive tooling with an extra reason', () => {
    const r = assessDependabotRisk({ name: 'eslint', fromVersion: '8.0.0', toVersion: '9.0.0' });
    expect(r.level).toBe('high');
    expect(r.reasons.some((x) => /CI-sensitive/.test(x))).toBe(true);
  });

  it('strips an npm scope before the CI-tool check', () => {
    const r = assessDependabotRisk({
      name: '@types/prettier',
      fromVersion: '2.0.0',
      toVersion: '2.1.0',
    });
    // @types/prettier normalizes to "prettier" (CI-sensitive) on a minor bump.
    expect(r.level).toBe('review');
  });

  it('treats a minor bump of CI-sensitive tooling as review-worthy, not high', () => {
    const r = assessDependabotRisk({ name: 'black', fromVersion: '24.1.0', toVersion: '24.2.0' });
    expect(r.level).toBe('review');
    expect(r.reasons[0]).toMatch(/CI-sensitive/);
  });

  it('flags a github_actions workflow bump as review (manual-merge surface)', () => {
    const r = assessDependabotRisk({
      name: 'actions/checkout',
      fromVersion: 'v3',
      toVersion: 'v4',
      ecosystem: 'github_actions',
    });
    expect(r.level).toBe('review');
    expect(r.reasons.some((x) => /workflows. OAuth scope|GitHub Actions/.test(x))).toBe(true);
  });

  it('treats an ordinary minor bump as safe', () => {
    const r = assessDependabotRisk({
      name: 'lodash',
      fromVersion: '4.17.20',
      toVersion: '4.17.21',
    });
    expect(r.level).toBe('safe');
    expect(r.semverChange).toBe('patch');
    expect(r.reasons[0]).toMatch(/Routine/);
  });

  it('notes a lockfile-only refresh as safe', () => {
    const bump: DependabotBump = { name: 'transitive-dep', lockfileOnly: true };
    const r = assessDependabotRisk(bump);
    expect(r.level).toBe('safe');
    expect(r.reasons[0]).toMatch(/Lockfile-only/);
  });

  it('mentions dev dependency in the routine reason', () => {
    const r = assessDependabotRisk({
      name: 'vitest',
      fromVersion: '2.0.0',
      toVersion: '2.0.1',
      devDependency: true,
    });
    expect(r.level).toBe('safe');
    expect(r.reasons[0]).toMatch(/dev dependency/);
  });
});

describe('parseBumpFromDiff', () => {
  it('reads the real from/to from the package.json change, stripping the range op', () => {
    expect(parseBumpFromDiff(DIFF_3_8_4_TO_3_9_4, 'somepkg')).toEqual({
      fromVersion: '3.8.4',
      toVersion: '3.9.4',
    });
  });

  it('escapes a scoped name and does not match a different package', () => {
    const diff = [
      'diff --git a/package.json b/package.json',
      '@@ -1,3 +1,3 @@',
      '-    "@scope/pkg": "1.0.0",',
      '+    "@scope/pkg": "2.0.0",',
    ].join('\n');
    expect(parseBumpFromDiff(diff, '@scope/pkg')).toEqual({
      fromVersion: '1.0.0',
      toVersion: '2.0.0',
    });
    expect(parseBumpFromDiff(diff, 'somepkg')).toEqual({});
  });

  it('ignores matching version lines outside package.json sections', () => {
    const diff = [
      'diff --git a/src/versions.ts b/src/versions.ts',
      '@@ -1,1 +1,1 @@',
      '-    "somepkg": "^3.8.4",',
      '+    "somepkg": "^3.9.4",',
      'diff --git a/package.json b/package.json',
      '@@ -1,1 +1,1 @@',
      '-    "somepkg": "^1.2.3",',
      '+    "somepkg": "^1.2.4",',
    ].join('\n');
    expect(parseBumpFromDiff(diff, 'somepkg')).toEqual({
      fromVersion: '1.2.3',
      toVersion: '1.2.4',
    });
  });

  it('returns {} when the diff does not pin the version (lockfile-only)', () => {
    expect(parseBumpFromDiff('-  resolved "…/somepkg-3.8.4.tgz"', 'somepkg')).toEqual({});
  });
});

describe('verifyDependabotBump', () => {
  it('flags a title whose from-version disagrees with the diff (the envctl#27 case)', () => {
    const v = verifyDependabotBump('somepkg', DIFF_3_8_4_TO_3_9_4, {
      fromVersion: '3.9.1', // what the title claimed
      toVersion: '3.9.4',
    });
    expect(v.titleMisstated).toBe(true);
    expect(v.fromVersion).toBe('3.8.4'); // diff is the source of truth
    expect(v.toVersion).toBe('3.9.4');
    expect(v.note).toMatch(/3\.9\.1.*3\.8\.4|diff shows/);
  });

  it('does not flag when the title matches the diff', () => {
    const v = verifyDependabotBump('somepkg', DIFF_3_8_4_TO_3_9_4, {
      fromVersion: '3.8.4',
      toVersion: '3.9.4',
    });
    expect(v.titleMisstated).toBe(false);
    expect(v.note).toBeUndefined();
  });

  it('does not flag when the diff cannot pin the version (nothing to verify against)', () => {
    const v = verifyDependabotBump('somepkg', 'lockfile only, no package.json line', {
      fromVersion: '3.9.1',
      toVersion: '3.9.4',
    });
    expect(v.titleMisstated).toBe(false);
    // Claimed versions should be preserved as fallback for downstream risk assessment.
    expect(v.fromVersion).toBe('3.9.1');
    expect(v.toVersion).toBe('3.9.4');
  });
});
