import { readFileSync } from 'node:fs';

/**
 * Generic JSONL event-log reader. Reads a run-log file (one JSON object per
 * line) and returns the parsed events. Intentionally free of any
 * coordinator-specific knowledge so it can be shared by run-analysis,
 * self-analysis, or any future consumer of JSONL logs.
 *
 * TS port of dotfiles' `lib/log_events.py`. Soft-fail posture mirrors the
 * Python: lines that are not valid JSON are silently skipped, and a missing or
 * unreadable file yields `[]` so callers don't need to guard separately.
 */

/**
 * A single parsed JSONL record. In practice every line of a coordinator log is
 * a JSON object, but — mirroring the Python, which appends whatever
 * `json.loads` returns — any valid JSON value is preserved verbatim; the shape
 * is caller-defined and treated opaquely here.
 */
export type LogEvent = unknown;

/** Parse JSONL text into events. Non-JSON and blank lines are skipped. */
export function parseLogEventsText(text: string): LogEvent[] {
  const events: LogEvent[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      continue;
    }
  }
  return events;
}

/**
 * Read all JSONL events from `logFile`. Returns a (possibly empty) list of
 * parsed objects. Lines that are not valid JSON are silently skipped; a read
 * error (missing file, permission denied) returns `[]`.
 *
 * The `read` boundary is injectable so callers can drive parsing without real
 * filesystem I/O; it defaults to a UTF-8 `readFileSync`.
 */
export function parseLogEvents(
  logFile: string,
  read: (path: string) => string = (path) => readFileSync(path, 'utf8'),
): LogEvent[] {
  let text: string;
  try {
    text = read(logFile);
  } catch {
    return [];
  }
  return parseLogEventsText(text);
}
