#!/usr/bin/env tsx
/**
 * Full-pin conformance — enforces the CLAUDE.md convention that every
 * `package.json` dependency is pinned to a full `[major].[minor].[patch]` base
 * (keeping the `^`/`~` range operator). An abbreviated pin like `^3` or `^3.8`
 * lets Dependabot upgrade the dependency through a `pnpm-lock.yaml`-only change
 * with no `package.json` diff, hiding the bump from review. Walks the root and
 * every workspace manifest; fails with the offending `manifest / dep / range`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// A registry version range whose base is full semver, optionally prefixed by a
// single `^` or `~`. Rejects `^3`, `^3.8`, `*`, `latest`, `>=1.2.3`, `1.2.x`, …
const FULL_PIN = /^[\^~]?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

// Non-registry specifiers carry a protocol or path (`workspace:`, `catalog:`,
// `npm:`, `link:`, `file:`, git/url, `owner/repo` shorthand) — never pinned here.
function isRegistryRange(spec: string): boolean {
  return !/[:/]/.test(spec);
}

function findManifests(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (
      name === 'node_modules' ||
      name === 'dist' ||
      name === '.git' ||
      name === '.git-worktrees'
    ) {
      return [];
    }
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return findManifests(p);
    return name === 'package.json' ? [p] : [];
  });
}

function main(): void {
  const errors: string[] = [];
  for (const path of findManifests('.')) {
    const pkg = JSON.parse(readFileSync(path, 'utf8')) as Record<string, Record<string, string>>;
    for (const field of ['dependencies', 'devDependencies']) {
      for (const [dep, range] of Object.entries(pkg[field] ?? {})) {
        if (!isRegistryRange(range)) continue;
        if (!FULL_PIN.test(range)) {
          errors.push(`${path}: ${field}.${dep} = "${range}" — pin a full [major].[minor].[patch]`);
        }
      }
    }
  }

  if (errors.length > 0) {
    console.error('package.json pin check failed:');
    console.error(errors.map((e) => `  ${e}`).join('\n'));
    process.exit(1);
  }
  console.log('package.json pins: ok');
}

main();
