import { describe, it, expect, vi } from 'vitest';
import {
  parseLockVersions,
  newVersions,
  splitId,
  isTooYoung,
  findTooYoung,
} from './check-release-age.js';

const LOCK = `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      yaml:
        specifier: ^2.5.0
        version: 2.5.0

packages:

  '@esbuild/aix-ppc64@0.21.5':
    resolution: {integrity: sha512-abc}
    engines: {node: '>=12'}

  yaml@2.5.0:
    resolution: {integrity: sha512-def}

snapshots:

  yaml@2.5.0: {}
`;

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

describe('parseLockVersions', () => {
  it('extracts name@version keys from the packages section only (not importers/snapshots)', () => {
    expect(parseLockVersions(LOCK)).toEqual(new Set(['@esbuild/aix-ppc64@0.21.5', 'yaml@2.5.0']));
  });
});

describe('newVersions', () => {
  it('returns only ids present in head but not base', () => {
    const base = 'packages:\n\n  yaml@2.5.0:\n    resolution: {}\n';
    const head =
      'packages:\n\n  yaml@2.5.0:\n    resolution: {}\n\n  left-pad@1.3.0:\n    resolution: {}\n';
    expect(newVersions(base, head)).toEqual(['left-pad@1.3.0']);
  });
});

describe('splitId', () => {
  it('splits scoped and unscoped ids at the version @', () => {
    expect(splitId('yaml@2.5.0')).toEqual({ name: 'yaml', version: '2.5.0' });
    expect(splitId('@esbuild/aix-ppc64@0.21.5')).toEqual({
      name: '@esbuild/aix-ppc64',
      version: '0.21.5',
    });
  });
});

describe('isTooYoung', () => {
  it('is true within the window and false past it', () => {
    expect(isTooYoung(NOW - 2 * DAY, NOW, 7)).toBe(true);
    expect(isTooYoung(NOW - 10 * DAY, NOW, 7)).toBe(false);
  });
});

describe('findTooYoung', () => {
  it('flags only versions younger than the window, fetching once per name', async () => {
    const fetchTimes = vi.fn(async (name: string) =>
      name === 'hot' ? { '1.0.0': NOW - 2 * DAY } : { '3.0.0': NOW - 30 * DAY },
    );
    const young = await findTooYoung(['hot@1.0.0', 'stable@3.0.0'], fetchTimes, NOW, 7, () => {});
    expect(young).toEqual([{ name: 'hot', version: '1.0.0', ageDays: 2 }]);
    expect(fetchTimes).toHaveBeenCalledTimes(2);
  });

  it('fails open (skips + warns) when the registry lookup returns null', async () => {
    const warn = vi.fn();
    const young = await findTooYoung(['x@1.0.0'], async () => null, NOW, 7, warn);
    expect(young).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it('fails open when the specific version has no publish time', async () => {
    const young = await findTooYoung(
      ['x@9.9.9'],
      async () => ({ '1.0.0': NOW }),
      NOW,
      7,
      () => {},
    );
    expect(young).toEqual([]);
  });
});
