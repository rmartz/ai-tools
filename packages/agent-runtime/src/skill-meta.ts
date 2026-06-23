/**
 * Hidden skill-meta traceability marker: render + detect/count.
 *
 * A coordinator skill embeds a `<!-- skill-meta: {...} -->` HTML comment in the
 * body it posts to a PR. The comment is invisible in rendered markdown but
 * parseable from raw source, letting the coordinator count its own outputs
 * durably — immune to skill timeouts and coordinator restarts (a skill that
 * crashed before posting simply won't appear).
 *
 * TS port that merges dotfiles' `skill_meta.py` (the marker-generation script)
 * and `lib/skill_meta.py` (the regex/counting helpers) into one concept module.
 * Pure string generation + regex — no I/O. The two halves the Python derived
 * from the environment and `gh`/`git` (the PR head hash and skill-file hash) are
 * inputs here: the caller resolves them and passes them in, keeping this module
 * hermetic and the marker deterministic in tests.
 *
 * The marker's literal shape is an **external contract** — it must match what
 * GitHub hides in rendered markdown and what the detection regex below (and the
 * Python coordinator that may still read these markers) expects. The JSON is
 * serialized with a space after each `:` and no space after each `,`, mirroring
 * the Python `json.dumps(..., separators=(',', ': '))`, and `skill` is always
 * emitted first so a `"skill":"<name>"`-anchored regex keeps matching regardless
 * of which optional fields are present.
 */

/** Fields embedded in a skill-meta marker. `skill` is always rendered first. */
export interface SkillMetaFields {
  /** Skill name (e.g. `review`, `fix-review`, `merge`). */
  skill: string;
  /** HEAD commit hash of the PR the skill acted on. */
  prHead: string;
  /** Git object hash of the skill's command file. */
  skillHash: string;
  /** Full agent model name (e.g. `Claude Opus 4.8`), for attribution parsing. */
  agent?: string;
  /** Skill's self-reported result category (e.g. `conflict`, `skipped`). */
  outcome?: string;
  /** Dispatched agent's transcript/session id, for run correlation. */
  transcript?: string;
  /** ISO-8601 start time of the coordinator run that dispatched the agent. */
  coordinatorStartedAt?: string;
}

// External-contract JSON keys, in render order. The TS-native camelCase field
// names above map to the verbatim wire keys here; only these strings cross the
// boundary, so only these are frozen.
const WIRE_KEYS: ReadonlyArray<readonly [keyof SkillMetaFields, string]> = [
  ['skill', 'skill'],
  ['prHead', 'pr_head'],
  ['skillHash', 'skill_hash'],
  ['agent', 'agent'],
  ['outcome', 'outcome'],
  ['transcript', 'transcript'],
  ['coordinatorStartedAt', 'coordinator_started_at'],
];

/**
 * Render the hidden skill-meta HTML comment for `fields`. `skill`, `prHead`, and
 * `skillHash` are always present; each optional field is included only when set
 * to a non-empty string (mirroring the Python's truthiness check). The result is
 * a single line safe to append to any PR comment/review body.
 *
 * This is the function pr-comment's `--skill` flag renders to feed
 * `postPrComment`'s pre-rendered `skillMeta`.
 */
export function renderSkillMeta(fields: SkillMetaFields): string {
  const parts: string[] = [];
  for (const [field, wireKey] of WIRE_KEYS) {
    const value = fields[field];
    if (value === undefined || value === '') continue;
    parts.push(`${JSON.stringify(wireKey)}: ${JSON.stringify(value)}`);
  }
  return `<!-- skill-meta: {${parts.join(',')}} -->`;
}

/**
 * Build a regex that matches a skill-meta marker for `skill`, anchored on the
 * `"skill":"<name>"` pair appearing before the JSON's closing brace — so it
 * keeps matching no matter which optional fields follow. Whitespace around the
 * comment delimiters and the `:` is tolerated, matching the Python constants.
 *
 * Pass no argument to match a marker for *any* skill.
 */
export function skillMetaPattern(skill?: string): RegExp {
  const target = skill === undefined ? '[^"]+' : escapeRegex(skill);
  return new RegExp(`<!--\\s*skill-meta:\\s*\\{[^}]*"skill"\\s*:\\s*"${target}"`, 'i');
}

function escapeRegex(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True if `body` contains at least one skill-meta marker for `skill` (any skill if omitted). */
export function hasSkillMeta(body: string, skill?: string): boolean {
  return skillMetaPattern(skill).test(body);
}

/**
 * Count how many of `bodies` carry a skill-meta marker for `skill` (any skill if
 * omitted). Mirrors the Python `_count_skill_meta` body-counting step: this is
 * the pure, post-fetch tally — the caller owns fetching the PR's review/comment
 * bodies and deciding how to treat a read failure (the Python returned `None`;
 * here that distinction lives in the caller, which simply doesn't call this when
 * the fetch failed).
 *
 * A marker appearing twice in one body still counts that body once, matching the
 * Python `sum(1 for body in bodies if marker_re.search(body))`.
 */
export function countSkillMeta(bodies: readonly string[], skill?: string): number {
  const pattern = skillMetaPattern(skill);
  return bodies.reduce((n, body) => (pattern.test(body) ? n + 1 : n), 0);
}
