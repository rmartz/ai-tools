/**
 * The fleet's conventional-commit subject grammar, as a POSIX ERE for `grep -E`.
 * Shared by the two golden workflows that enforce it — `pr-title-lint.yml`
 * (pre-merge, the PR title) and `commit-convention.yml` (post-merge, the subjects
 * that reached `main`) — so the pair can never drift apart: a squash merge makes
 * the PR title the merge-commit subject, so both must accept exactly the same set.
 *
 * `<type>[(<scope>)][!]: <non-empty subject>`, where `!` is the optional
 * breaking-change marker. Pure string data — interpolated verbatim into each
 * workflow's single-quoted shell `pattern='…'` assignment.
 */
export const CONVENTIONAL_SUBJECT_PATTERN = String.raw`^(feat|fix|docs|chore|refactor|test|style|perf|ci|build|revert)(\([^)]+\))?!?: [^[:space:]].*$`;
