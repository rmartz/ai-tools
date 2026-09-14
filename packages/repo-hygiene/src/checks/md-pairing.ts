import { trackedFileModes } from '../discovery.js';
import type { Check, Finding } from '../types.js';

/**
 * `CLAUDE.md` / `AGENTS.md` pairing. The two agent-directive files must travel
 * together: a directory that carries one must carry the other, and each must be
 * a **regular file**, never a symlink — a symlinked directive file (git index
 * mode `120000`) is a violation, not a link to follow. Keeping both as real
 * files means every tool that reads only one of the two names sees the same
 * content regardless of which it opens.
 *
 * Pairing is a whole-tree structural invariant (seeing only a changed subset
 * can't tell whether a pair is complete), so the check reads the full tracked
 * set and its git modes directly rather than the mode-scoped file set.
 */

const NAME = 'md-pairing';
const SYMLINK_MODE = '120000';
const PAIR = { 'CLAUDE.md': 'AGENTS.md', 'AGENTS.md': 'CLAUDE.md' } as const;

type DirectiveName = keyof typeof PAIR;
const isDirective = (name: string): name is DirectiveName => name in PAIR;

const dirOf = (path: string): string => {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
};
const baseOf = (path: string): string => {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? path : path.slice(slash + 1);
};
const joinDir = (dir: string, name: string): string => (dir === '' ? name : `${dir}/${name}`);

/** Evaluate pairing over a map of tracked directive-file path → git mode. */
export function evaluatePairing(modes: Map<string, string>): Finding[] {
  // Which directive files (by name) each directory contains.
  const byDir = new Map<string, Map<DirectiveName, string>>();
  for (const [path, mode] of modes) {
    const name = baseOf(path);
    if (!isDirective(name)) continue;
    const dir = dirOf(path);
    const inDir = byDir.get(dir) ?? new Map<DirectiveName, string>();
    inDir.set(name, mode);
    byDir.set(dir, inDir);
  }

  const findings: Finding[] = [];
  const push = (path: string, message: string): void => {
    findings.push({ check: NAME, path, message, severity: 'error' });
  };
  for (const [dir, present] of byDir) {
    for (const [name, mode] of present) {
      if (mode === SYMLINK_MODE) {
        push(joinDir(dir, name), `${name} is a symlink; directive files must be regular files`);
      }
      const counterpart = PAIR[name];
      if (!present.has(counterpart)) {
        push(joinDir(dir, name), `${name} has no paired ${counterpart} in the same directory`);
      }
    }
  }
  return findings;
}

export const mdPairingCheck: Check = {
  name: NAME,
  description:
    'CLAUDE.md / AGENTS.md must be paired regular files in every directory that has one.',
  async run(ctx) {
    const modes = await trackedFileModes({ cwd: ctx.cwd });
    return evaluatePairing(modes);
  },
};
