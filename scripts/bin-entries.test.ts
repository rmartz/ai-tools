import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, it, expect } from 'vitest';

// Guard: every `bin` a package publishes must be built. A `bin` pointing at
// `./dist/bin/<name>.js` with no matching `src/bin/<name>.ts` tsup entry ships a
// CLI whose target file never exists (the `ai-origin-stamp` bug).

const PACKAGES_DIR = join(import.meta.dirname, '..', 'packages');

const binTargets = (bin: unknown): string[] => {
  if (typeof bin === 'string') return [bin];
  if (typeof bin !== 'object' || bin === null) return [];
  return Object.values(bin).filter((t): t is string => typeof t === 'string');
};

const packagesWithBins = readdirSync(PACKAGES_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => ({ name: entry.name, dir: join(PACKAGES_DIR, entry.name) }))
  .filter(({ dir }) => existsSync(join(dir, 'package.json')))
  .flatMap(({ name, dir }) => {
    const manifest: unknown = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    const targets = binTargets(
      typeof manifest === 'object' && manifest !== null && 'bin' in manifest
        ? manifest.bin
        : undefined,
    );
    return targets.length > 0 ? [{ name, dir, targets }] : [];
  });

const expectedEntry = (target: string): string =>
  target.replace(/^\.\/dist\//, 'src/').replace(/\.js$/, '.ts');

const loadTsupEntries = async (dir: string): Promise<unknown[]> => {
  const mod: unknown = await import(pathToFileURL(join(dir, 'tsup.config.ts')).href);
  const config =
    typeof mod === 'object' && mod !== null && 'default' in mod ? mod.default : undefined;
  const entry =
    typeof config === 'object' && config !== null && 'entry' in config ? config.entry : undefined;
  return Array.isArray(entry) ? entry : [];
};

describe('package bin targets', () => {
  it.each(packagesWithBins)(
    '$name builds every declared bin via a tsup entry',
    async ({ dir, targets }) => {
      const entries = await loadTsupEntries(dir);
      const missing = targets.map(expectedEntry).filter((entry) => !entries.includes(entry));
      expect(missing).toEqual([]);
    },
  );
});
