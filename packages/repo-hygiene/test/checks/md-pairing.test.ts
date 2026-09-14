import { describe, it, expect } from 'vitest';
import { evaluatePairing } from '../../src/checks/md-pairing.js';

const REG = '100644';
const LINK = '120000';
const modes = (entries: Record<string, string>): Map<string, string> =>
  new Map(Object.entries(entries));

describe('evaluatePairing', () => {
  it('passes a directory with both directive files as regular files', () => {
    expect(evaluatePairing(modes({ 'CLAUDE.md': REG, 'AGENTS.md': REG, 'src/x.ts': REG }))).toEqual(
      [],
    );
  });

  it('flags a CLAUDE.md with no paired AGENTS.md', () => {
    const findings = evaluatePairing(modes({ 'CLAUDE.md': REG }));
    expect(findings).toEqual([
      {
        check: 'md-pairing',
        path: 'CLAUDE.md',
        message: 'CLAUDE.md has no paired AGENTS.md in the same directory',
        severity: 'error',
      },
    ]);
  });

  it('flags an AGENTS.md with no paired CLAUDE.md', () => {
    const findings = evaluatePairing(modes({ 'docs/AGENTS.md': REG }));
    expect(findings.map((f) => f.path)).toEqual(['docs/AGENTS.md']);
    expect(findings[0]?.message).toContain('no paired CLAUDE.md');
  });

  it('flags a symlinked directive file even when the pair is complete', () => {
    const findings = evaluatePairing(modes({ 'CLAUDE.md': REG, 'AGENTS.md': LINK }));
    expect(findings).toEqual([
      {
        check: 'md-pairing',
        path: 'AGENTS.md',
        message: 'AGENTS.md is a symlink; directive files must be regular files',
        severity: 'error',
      },
    ]);
  });

  it('evaluates each directory independently', () => {
    const findings = evaluatePairing(
      modes({
        'CLAUDE.md': REG, // root: unpaired
        'docs/CLAUDE.md': REG, // docs: complete
        'docs/AGENTS.md': REG,
      }),
    );
    expect(findings.map((f) => f.path)).toEqual(['CLAUDE.md']);
  });
});
