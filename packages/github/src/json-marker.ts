/**
 * Hidden-JSON marker plumbing: carry a machine-readable record as an HTML-comment
 * marker on a PR (`<!-- <kind>: <base64-json> -->`). This is the generic transport
 * the review-cycle craft skills use to emit their records for a runner to consume;
 * the review-specific record shapes live in `@rmartz/pr-review`, this layer only
 * renders/parses the envelope.
 *
 * The payload is base64-encoded JSON, not raw JSON, so a record may carry arbitrary
 * free-form text (markdown review bodies, code snippets, `-->`, newlines) without a
 * closing-delimiter collision. A malformed marker (bad base64 or bad JSON) is
 * skipped, never thrown — a runner reading a PR's history must tolerate junk.
 */

/** Render `value` as a hidden marker comment of the given `kind`. */
export function renderJsonMarker(kind: string, value: unknown): string {
  const b64 = Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
  return `<!-- ${kind}: ${b64} -->`;
}

export interface ParseJsonMarkerOptions<T> {
  /** Keep only records for which this returns true (e.g. `r => r.prHead === head`). */
  match?: (value: T) => boolean;
}

/**
 * Return the LAST marker of `kind` across `commentBodies` that parses and (when a
 * `match` predicate is given) satisfies it, or `null`. Bodies are assumed in
 * chronological order — GitHub returns issue comments oldest-first — so the last
 * match is the most recent record. Multiple markers in one body are all considered.
 *
 * A malformed marker (bad base64, bad JSON, or a valid-JSON non-object payload such
 * as `null`, a number, or a string) is skipped, never thrown.
 *
 * **Trust**: no comment-author verification is performed — any PR commenter can post
 * a marker this function returns. Callers in a trust-sensitive context must filter
 * the comment list by expected authors before calling, or rely on an authenticated
 * store (e.g. PR Shepherd's engine) to supply the bodies.
 */
export function parseLatestJsonMarker<T = Record<string, unknown>>(
  kind: string,
  commentBodies: readonly string[],
  opts: ParseJsonMarkerOptions<T> = {},
): T | null {
  const re = new RegExp(`<!--\\s*${escapeRe(kind)}:\\s*([A-Za-z0-9+/=]+)\\s*-->`, 'g');
  let latest: T | null = null;
  for (const body of commentBodies) {
    for (const m of body.matchAll(re)) {
      const b64 = m[1];
      if (b64 === undefined) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
      } catch {
        continue;
      }
      if (parsed === null || typeof parsed !== 'object') continue;
      const value = parsed as T;
      if (opts.match && !opts.match(value)) continue;
      latest = value;
    }
  }
  return latest;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
