/**
 * The golden `commit-convention.yml` body — the one golden file whose behaviour is
 * **implemented inline** rather than delegated. Its siblings in `golden-workflows.ts`
 * are all thin, self-updating references to a shared CI product (a SHA-pinned
 * reusable-workflow caller or composite-action consumer that Dependabot bumps), so a
 * body there is a dozen lines of `uses:`/`with:`. This one carries a ~50-line shell
 * script, and that single payload was most of `golden-workflows.ts`'s length — so it
 * lives here, along the inline-implementation-vs-thin-reference seam, rather than
 * padding the reference table. Pure string data — no imports, no logic. See
 * `golden-config.ts` for how it is assembled into the golden set.
 */

// Post-merge conventional-commit tripwire. A `push: [main]` alert (it can't gate
// — the commit is already merged) that fails loudly when a subject reaches the
// default branch without a valid conventional-commit prefix. It catches the exact
// silent-skip that pre-merge `pr-title-lint` cannot see: a squash-merge setting
// that used the branch commit message instead of the PR title, a direct push, or
// a squash that dropped the prefix — any of which makes release-please silently
// skip the release. Validates the first-parent chain of the pushed range (so a
// squash merge is its single new commit, a stray merge commit is flagged, and a
// merged branch's internal plain commits are not re-litigated). Two pushes have no
// usable range: a branch's first push (`before` is all-zeros) and a force-push that
// rewrote the branch (`before` names a commit the rewrite orphaned, so the range
// would exit 128 — #303). Both narrow to validating the pushed tip, and say so in
// the log; neither skips the check. `actions/checkout`
// is pinned by full SHA + `major.minor.patch` comment per the Actions-pinning
// convention; `push` fires on `main` (a non-`main` repo adjusts that one literal).
// Its job carries an explicit Title Case `name:` — this is a job the repo defines
// itself, the other half of the check-name convention written out at REPO_HYGIENE in
// `golden-workflows.ts`.
export const COMMIT_CONVENTION = `name: Conventional Commits (main)

on:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  commit-convention:
    name: Validate commit subjects on main
    runs-on: ubuntu-latest
    timeout-minutes: 2
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          fetch-depth: 0 # the pushed range's history must be present to read subjects
      - name: Validate new commit subjects
        env:
          BEFORE: \${{ github.event.before }}
          AFTER: \${{ github.event.after }}
        run: |
          set -euo pipefail
          # Conventional-commit subject grammar — mirrors pr-title-lint.yml.
          pattern='^(feat|fix|docs|chore|refactor|test|style|perf|ci|build|revert)(\\([^)]+\\))?!?: [^[:space:]].*$'
          # BEFORE is an unusable range endpoint in two cases: a branch's first
          # push (all-zeros), and a force-push that rewrote the branch, where the
          # old tip is no longer reachable and the range would exit 128. Both cases
          # fall back to validating just the pushed tip — announced in the log, so
          # the tripwire narrows its scope rather than silently skipping.
          if printf '%s' "$BEFORE" | grep -qE '^0+$'; then
            echo "note: BEFORE is all-zeros (first push); validating the pushed tip only."
            revs="$AFTER"
          elif ! git cat-file -e "\${BEFORE}^{commit}" 2>/dev/null; then
            echo "note: BEFORE ($BEFORE) is unreachable, so \${GITHUB_REF_NAME:-main} was"
            echo "      rewritten (force-push); validating the pushed tip only."
            revs="$AFTER"
          else
            revs="$(git rev-list --first-parent "\${BEFORE}..\${AFTER}")"
          fi
          status=0
          for sha in $revs; do
            subject="$(git show -s --format=%s "$sha")"
            if printf '%s\\n' "$subject" | grep -qE "$pattern"; then
              echo "ok:   $sha $subject"
            else
              echo "FAIL: $sha $subject"
              status=1
            fi
          done
          if [ "$status" -ne 0 ]; then
            echo
            echo "A commit reached \${GITHUB_REF_NAME:-main} with a non-conventional subject."
            echo "release-please only releases conventional commits, so it silently skips a"
            echo "non-conventional one. Likely cause: a squash merge used the branch commit"
            echo "message instead of the PR title. Set the repo squash-merge default to"
            echo "'PR_TITLE' (ai-verify-squash-setting --apply) so PR titles reach main."
            exit 1
          fi
          echo "All new commit subjects are valid conventional commits."
`;
