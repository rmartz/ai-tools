import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

// Guard: every `bin` a package publishes must be built. A `bin` pointing at
// `./dist/bin/<name>.js` with no matching `src/bin/<name>.ts` tsup entry ships a
// CLI whose target file never exists (the `ai-origin-stamp` bug).

const PACKAGES_DIR = join(import.meta.dirname, '..', 'packages');

const packagesWithBins = readdirSync(PACKAGES_DIR).flatMap((name) => {
  const dir = join(PACKAGES_DIR, name);
  const manifest: unknown = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const bin =
    typeof manifest === 'object' && manifest !== null && 'bin' in manifest
      ? manifest.bin
      : undefined;
  if (typeof bin !== 'object' || bin === null) return [];
  const targets = Object.values(bin).filter((t): t is string => typeof t === 'string');
  return [{ name, dir, targets }];
});

const expectedEntry = (target: string): string =>
  target.replace(/^\.\/dist\//, 'src/').replace(/\.js$/, '.ts');

describe('package bin targets', () => {
  it.each(packagesWithBins)(
    '$name builds every declared bin via a tsup entry',
    ({ dir, targets }) => {
      const tsupConfig = readFileSync(join(dir, 'tsup.config.ts'), 'utf8');
      const missing = targets
        .map(expectedEntry)
        .filter((entry) => !tsupConfig.includes(`'${entry}'`));
      expect(missing).toEqual([]);
    },
  );
});
