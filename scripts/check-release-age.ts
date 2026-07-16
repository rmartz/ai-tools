#!/usr/bin/env tsx
/**
 * Dependency release-age cooldown gate — a deterministic second layer over
 * Dependabot's `cooldown`, which is advisory at PR-creation time and has
 * documented reliability gaps for npm. Fails a PR that introduces a package
 * version younger than `RELEASE_AGE_MIN_DAYS` (default 7), enforcing "let
 * releases age before we adopt them" at a layer we control.
 *
 * Diffs `pnpm-lock.yaml` (base vs head) rather than `package.json`, so it also
 * catches fresh *transitive* bumps, and queries only the handful of
 * newly-introduced versions. Registry-fetch failures fail **open** (warn + skip)
 * so a flaky registry never produces spurious red; a confirmed too-young version
 * fails the check. `pull_request`-only in CI: it blocks a hot version from
 * *landing*.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DAY_MS = 86_400_000;
const DEFAULT_MIN_DAYS = 7;
const REGISTRY = 'https://registry.npmjs.org';

/** Parse the `packages:` section of a pnpm v9 lockfile into `name@version` ids. */
export function parseLockVersions(lockText: string): Set<string> {
  const out = new Set<string>();
  let inPackages = false;
  for (const line of lockText.split('\n')) {
    if (/^\S/.test(line)) {
      inPackages = line.startsWith('packages:');
      continue;
    }
    if (!inPackages || !/^ {2}\S/.test(line)) continue;
    const trimmed = line.trim();
    if (!trimmed.endsWith(':')) continue;
    let key = trimmed.slice(0, -1);
    if (key.startsWith("'") && key.endsWith("'")) key = key.slice(1, -1);
    if (/@\d/.test(key)) out.add(key);
  }
  return out;
}

/** The `name@version` ids present in `headText` but not in `baseText`. */
export function newVersions(baseText: string, headText: string): string[] {
  const base = parseLockVersions(baseText);
  return [...parseLockVersions(headText)].filter((id) => !base.has(id));
}

/** Split a `name@version` id into its parts (the name may be scoped). */
export function splitId(id: string): { name: string; version: string } {
  const at = id.lastIndexOf('@');
  return { name: id.slice(0, at), version: id.slice(at + 1) };
}

/** Whether `publishedMs` is younger than `minDays` relative to `nowMs`. */
export function isTooYoung(publishedMs: number, nowMs: number, minDays: number): boolean {
  return nowMs - publishedMs < minDays * DAY_MS;
}

export interface TooYoung {
  name: string;
  version: string;
  ageDays: number;
}

/** A registry lookup: a package's `version → publish epoch ms`, or null on failure. */
export type PublishTimes = (name: string) => Promise<Record<string, number> | null>;

/**
 * Of the newly-introduced ids, those younger than `minDays`. Fetches each
 * package's publish times once (grouped by name); a null result (fetch failure)
 * or an unknown version is warned and skipped — fail-open.
 */
export async function findTooYoung(
  ids: string[],
  fetchTimes: PublishTimes,
  nowMs: number,
  minDays: number,
  warn: (message: string) => void,
): Promise<TooYoung[]> {
  const byName = new Map<string, string[]>();
  for (const id of ids) {
    const { name, version } = splitId(id);
    const list = byName.get(name);
    if (list) list.push(version);
    else byName.set(name, [version]);
  }

  const young: TooYoung[] = [];
  for (const [name, versions] of byName) {
    const times = await fetchTimes(name);
    if (times === null) {
      warn(`could not read publish times for ${name}; skipping (fail-open)`);
      continue;
    }
    for (const version of versions) {
      const published = times[version];
      if (published === undefined) {
        warn(`no publish time for ${name}@${version}; skipping (fail-open)`);
        continue;
      }
      if (isTooYoung(published, nowMs, minDays)) {
        young.push({ name, version, ageDays: Math.floor((nowMs - published) / DAY_MS) });
      }
    }
  }
  return young;
}

/** Fetch a package's `version → publish epoch ms` map from the npm registry. */
async function fetchPublishTimes(name: string): Promise<Record<string, number> | null> {
  try {
    const res = await fetch(`${REGISTRY}/${name}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { time?: Record<string, string> };
    if (!data.time) return null;
    const out: Record<string, number> = {};
    for (const [version, iso] of Object.entries(data.time)) {
      const ms = Date.parse(iso);
      if (Number.isFinite(ms)) out[version] = ms;
    }
    return out;
  } catch {
    return null;
  }
}

/** Read a file's contents at a git ref, or null if the ref/file is unavailable. */
function gitShow(ref: string, path: string): string | null {
  try {
    return execFileSync('git', ['show', `${ref}:${path}`], { encoding: 'utf8' });
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const minDays = Number.parseInt(process.env.RELEASE_AGE_MIN_DAYS ?? '', 10) || DEFAULT_MIN_DAYS;
  const baseRef = `origin/${process.env.GITHUB_BASE_REF || 'main'}`;

  const baseText = gitShow(baseRef, 'pnpm-lock.yaml');
  if (baseText === null) {
    console.warn(`release-age: could not read ${baseRef}:pnpm-lock.yaml; skipping (fail-open).`);
    return;
  }
  const headText = readFileSync('pnpm-lock.yaml', 'utf8');

  const ids = newVersions(baseText, headText);
  if (ids.length === 0) {
    console.log('Dependency release-age: ok (no newly-introduced versions).');
    return;
  }

  const young = await findTooYoung(ids, fetchPublishTimes, Date.now(), minDays, (m) =>
    console.warn(`release-age: ${m}`),
  );
  if (young.length > 0) {
    console.error(
      `Dependency release-age check failed — ${young.length} version(s) younger than ${minDays} days:`,
    );
    console.error(
      young.map((y) => `  ${y.name}@${y.version} — ${y.ageDays}d old (min ${minDays}d)`).join('\n'),
    );
    console.error(
      'These releases have not aged past the cooldown window; wait for them to age, then re-run.',
    );
    process.exit(1);
  }
  console.log(`Dependency release-age: ok (${ids.length} new version(s), all ≥ ${minDays}d).`);
}

async function run(): Promise<void> {
  try {
    await main();
  } catch (err: unknown) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void run();
}
