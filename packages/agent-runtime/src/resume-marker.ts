/**
 * The pure, storage-agnostic resume-marker layer: shaping a marker body and
 * reading pointers back out of comment-like entries. TS port of dotfiles'
 * `lib/resume_marker.py`. The I/O around it (a durable {@link ResumeStore} plus
 * record/recover) lives in `resume.ts`, which re-exports this module so
 * `./resume.js` is the single public surface.
 */

/**
 * The marker uses its own sentinel — distinct from any fix-confirmation/skill
 * marker a consumer might also write — so a recorded pointer is never miscounted
 * as a confirmation. A later confirmation is exactly what makes a recorded
 * pointer stale, so the two must stay distinguishable.
 */
export const MARKER_LABEL = 'coordinator-resume-pointer';

const MARKER_RE = new RegExp(`<!--\\s*${MARKER_LABEL}:\\s*(\\{[\\s\\S]*?\\})\\s*-->`);

/** A locator the consumer reads from its retry registry / writes into a marker. */
export interface ResumeLocator {
  sessionId: string;
  path?: string | null;
}

/** The full payload decoded from a marker body (a superset of {@link ResumeLocator}). */
export interface ResumePointer extends ResumeLocator {
  skill?: string | null;
  termination?: string | null;
  salvage?: string | null;
  attempt?: number | null;
  timestamp?: string | null;
}

export interface FormatMarkerOptions {
  skill: string;
  sessionId: string;
  transcriptPath?: string | null;
  termination: string;
  salvage: string;
  attempt: number;
  timestamp: string;
  /** Signing identity for the human-readable footer; falls back to a generic note. */
  model?: string;
}

/**
 * Build a comment body recording an interrupted agent's transcript locator. The
 * body carries a short human-readable note, a signing footer, and a hidden
 * `<!-- coordinator-resume-pointer: {...} -->` marker that {@link parseMarker}
 * reads back. `attempt` is the 1-based position in the current unresolved
 * timeout streak; `timestamp` is an ISO-8601 UTC string stamped by the caller.
 *
 * The hidden marker's JSON uses the verbatim external-contract field names
 * (`transcript_id`, `transcript_path`) so a marker is portable across the
 * Python and TS implementations.
 */
export function formatMarker(opts: FormatMarkerOptions): string {
  const payload = {
    skill: opts.skill,
    transcript_id: opts.sessionId,
    transcript_path: opts.transcriptPath ?? null,
    termination: opts.termination,
    salvage: opts.salvage,
    attempt: opts.attempt,
    timestamp: opts.timestamp,
  };
  const marker = `<!-- ${MARKER_LABEL}: ${JSON.stringify(payload)} -->`;
  const signature = opts.model || 'the coordinator';
  const visible =
    `The coordinator's \`/${opts.skill}\` agent terminated (${opts.termination}, attempt ` +
    `${opts.attempt}) before posting its status comment. Recording the agent ` +
    'transcript pointer so a later pass — even in a new coordinator session — ' +
    'can resume it instead of restarting.\n\n' +
    `- Transcript: \`${opts.sessionId}\`\n` +
    `- Salvage: ${opts.salvage}\n` +
    `- Attempt: ${opts.attempt}\n` +
    `- Recorded: ${opts.timestamp}\n\n` +
    `---\n*Posted by ${signature}*`;
  return `${visible}\n\n${marker}\n`;
}

/**
 * Extract a resume pointer from a comment `body`, or `null`. Returns the decoded
 * pointer when the body carries a well-formed marker with a transcript id; `null`
 * for a non-marker body, malformed JSON, or a marker missing its transcript id.
 * `attempt` / `timestamp` come back as `null` on markers written before those
 * fields existed.
 */
export function parseMarker(body: string | null | undefined): ResumePointer | null {
  if (!body) return null;
  const match = MARKER_RE.exec(body);
  if (!match?.[1]) return null;
  let data: unknown;
  try {
    data = JSON.parse(match[1]);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;
  const record = data as Record<string, unknown>;
  const sessionId = record.transcript_id;
  if (typeof sessionId !== 'string' || sessionId.length === 0) return null;
  const asString = (v: unknown): string | null => (typeof v === 'string' ? v : null);
  return {
    sessionId,
    path: asString(record.transcript_path),
    skill: asString(record.skill),
    termination: asString(record.termination),
    salvage: asString(record.salvage),
    attempt: typeof record.attempt === 'number' ? record.attempt : null,
    timestamp: asString(record.timestamp),
  };
}

/** One stored entry: a comment-like body with a sortable ISO-8601 creation time. */
export interface ResumeEntry {
  body: string | null;
  createdAt: string;
}

/**
 * The newest `createdAt` among `entries` whose body matches `confirmationRe`. A
 * recorded pointer goes stale once a later confirmation lands, so this is the
 * threshold both {@link selectActivePointer} and {@link countActiveMarkers} use
 * to ignore superseded markers. Empty string (sorts before any real timestamp)
 * when there is no confirmation or no regex given.
 *
 * GitHub's ISO-8601 timestamps sort lexicographically, so cutoff comparison is
 * plain string comparison — no date parsing.
 */
function confirmationCutoff(entries: ResumeEntry[], confirmationRe?: RegExp): string {
  if (!confirmationRe) return '';
  let cutoff = '';
  for (const entry of entries) {
    const created = entry.createdAt || '';
    if (created > cutoff && confirmationRe.test(entry.body ?? '')) {
      cutoff = created;
    }
  }
  return cutoff;
}

/**
 * Pick the newest non-superseded resume locator from `entries`. When
 * `confirmationRe` is given, only markers created strictly after the most recent
 * matching entry are eligible — so a later confirmation makes a recorded pointer
 * stale. Returns the `{ sessionId, path }` locator of the newest eligible marker,
 * or `null` when there is none.
 */
export function selectActivePointer(
  entries: ResumeEntry[],
  confirmationRe?: RegExp,
): ResumeLocator | null {
  const cutoff = confirmationCutoff(entries, confirmationRe);
  let best: ResumeLocator | null = null;
  let bestAt = '';
  for (const entry of entries) {
    const created = entry.createdAt || '';
    if (created <= cutoff || created < bestAt) continue;
    const pointer = parseMarker(entry.body);
    if (pointer === null) continue;
    best = { sessionId: pointer.sessionId, path: pointer.path };
    bestAt = created;
  }
  return best;
}

/**
 * Count the resume markers in `entries` not superseded by a later confirmation
 * (same eligibility rule as {@link selectActivePointer}). This is the length of
 * the current unresolved timeout streak — the basis for the durable,
 * cross-session `attempt` number.
 */
export function countActiveMarkers(entries: ResumeEntry[], confirmationRe?: RegExp): number {
  const cutoff = confirmationCutoff(entries, confirmationRe);
  let count = 0;
  for (const entry of entries) {
    if ((entry.createdAt || '') <= cutoff) continue;
    if (parseMarker(entry.body) !== null) count += 1;
  }
  return count;
}
