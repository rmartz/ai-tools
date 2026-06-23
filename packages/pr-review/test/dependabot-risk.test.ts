import { describe, it, expect } from 'vitest';
import {
  assessDependabotRisk,
  classifySemverChange,
  type DependabotBump,
} from '../src/dependabot-risk.js';

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
