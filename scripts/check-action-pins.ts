#!/usr/bin/env tsx
/**
 * GitHub Actions SHA-pin conformance — the CI analog of check-pins.ts. Enforces
 * that every external action referenced in `.github/` is pinned to a full
 * 40-char commit SHA with a version comment (`uses: owner/repo@<sha> # v7.0.0`),
 * never a mutable tag. A tag can be force-moved by a compromised upstream to run
 * malicious code with our token; a commit SHA is immutable. The version comment
 * is what lets Dependabot's `github-actions` ecosystem keep both the SHA and the
 * comment current. Local (`./…`) action refs are exempt — they move with the
 * repo commit and cannot be tag-attacked. Fails with the offending file/line.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHA = /^[0-9a-f]{40}$/;
// A version-ish token in the pin comment (`v7.0.0`, `v6`, `1.2.3`) so Dependabot
// has a baseline version to bump from.
const VERSION_COMMENT = /\bv?\d+(?:\.\d+)*\b/;

/** Parse the `uses:` value and any trailing `# comment` from one line. */
export function parseUsesLine(line: string): { uses: string; comment?: string } | null {
  const m = /^\s*(?:-\s*)?uses:\s*(.+?)\s*$/.exec(line);
  if (!m) return null;
  let rest = m[1] ?? '';
  let comment: string | undefined;
  const hash = rest.indexOf('#');
  if (hash !== -1) {
    comment = rest.slice(hash + 1).trim();
    rest = rest.slice(0, hash).trim();
  }
  const uses = rest.replace(/^['"]|['"]$/g, '').trim();
  return uses ? { uses, comment } : null;
}

/** The reason a `uses:` ref violates the pin policy, or null if it conforms. */
export function checkActionRef(uses: string, comment?: string): string | null {
  // Local composite/action path — moves with the commit, not tag-attackable.
  if (uses.startsWith('./') || uses.startsWith('../')) return null;
  // Docker image reference — the immutable form is a @sha256 digest pin.
  if (uses.startsWith('docker://')) {
    return uses.includes('@sha256:') ? null : `${uses} — pin the docker image by @sha256 digest`;
  }
  const at = uses.lastIndexOf('@');
  if (at === -1) {
    return `${uses} — unpinned (no @ref); pin to a full 40-char commit SHA`;
  }
  const ref = uses.slice(at + 1);
  if (!SHA.test(ref)) {
    return `${uses} — not SHA-pinned; pin to a full 40-char commit SHA (a tag is mutable)`;
  }
  if (!comment || !VERSION_COMMENT.test(comment)) {
    return `${uses} — SHA-pinned but no version comment; add "# vX.Y.Z" so Dependabot can track it`;
  }
  return null;
}

export type PinError = { file: string; line: number; reason: string };

/** Scan one YAML file's text for non-conforming `uses:` references. */
export function scanYaml(file: string, text: string): PinError[] {
  const errors: PinError[] = [];
  text.split('\n').forEach((line, i) => {
    const parsed = parseUsesLine(line);
    if (!parsed) return;
    const reason = checkActionRef(parsed.uses, parsed.comment);
    if (reason) errors.push({ file, line: i + 1, reason });
  });
  return errors;
}

function findYaml(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return findYaml(p);
    return /\.ya?ml$/.test(name) ? [p] : [];
  });
}

function main(): void {
  const errors = findYaml('.github').flatMap((file) => scanYaml(file, readFileSync(file, 'utf8')));
  if (errors.length > 0) {
    console.error('GitHub Actions SHA-pin check failed:');
    console.error(errors.map((e) => `  ${e.file}:${e.line}: ${e.reason}`).join('\n'));
    process.exit(1);
  }
  console.log('GitHub Actions SHA pins: ok');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
