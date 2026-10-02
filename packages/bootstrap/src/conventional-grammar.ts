/**
 * The fleet's conventional-commit subject grammar, as a POSIX ERE for `grep -E`.
 * Enforced post-merge by the golden `commit-convention.yml` (the subjects that
 * reached `main`). Its pre-merge counterpart is the `title` check of
 * `@rmartz/pr-policy`, run by the seeded `pr-policy.yml`: a squash merge makes the
 * PR title the merge-commit subject, so a change to the fleet grammar must land in
 * both places together.
 *
 * `<type>[(<scope>)][!]: <non-empty subject>`, where `!` is the optional
 * breaking-change marker. Pure string data — interpolated verbatim into the
 * workflow's single-quoted shell `pattern='…'` assignment.
 */
export const CONVENTIONAL_SUBJECT_PATTERN = String.raw`^(feat|fix|docs|chore|refactor|test|style|perf|ci|build|revert)(\([^)]+\))?!?: [^[:space:]].*$`;
