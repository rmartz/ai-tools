/**
 * The golden `pr-title-lint.yml` body — the pre-merge half of the conventional-commit
 * pair whose post-merge half is `golden-commit-convention.ts`. Like that tripwire its
 * logic is **implemented inline** (a short shell script, no CLI install, no
 * Dependabot channel), so it is seeded once and the repo owns it; a later revision
 * reaches existing repos through the checklist audit. Pure string data — no logic;
 * its only import is the grammar it shares with `commit-convention.yml`. See
 * `golden-config.ts` for how it is assembled into the golden set.
 */

import { CONVENTIONAL_SUBJECT_PATTERN } from './conventional-grammar.js';

// Pre-merge PR-title linter. It needs the `pull_request` event payload (the title),
// which the tree-based `repo-hygiene` check cannot see — that is why it ships as a
// golden workflow rather than a registry check (rmartz/repo-hygiene#49). Under
// squash-merge with the PR-title default, the title *is* the subject that reaches
// `main` and drives release-please, so it is validated against the exact grammar
// the post-merge tripwire applies. `edited` re-runs it when only the title changes.
// The title reaches the shell through `env:`, never an inline `${{ }}` expansion in
// `run:`, so a crafted title cannot inject shell. A `[WIP] ` prefix fails the
// grammar (it does not start with a type), which is what keeps a work-in-progress
// PR unmergeable until the marker is removed. No checkout and no token scope are
// needed, hence `permissions: {}`. The job's Title Case `name:` — the check context
// `Validate PR title` — follows the repo's-own-job half of the check-name convention
// (see REPO_HYGIENE in `golden-workflows.ts`).
export const PR_TITLE_LINT = `name: PR Title Lint

on:
  pull_request:
    types: [opened, edited, synchronize, reopened]

permissions: {}

jobs:
  pr-title:
    name: Validate PR title
    runs-on: ubuntu-latest
    timeout-minutes: 1
    steps:
      - name: Check PR title format
        env:
          PR_TITLE: \${{ github.event.pull_request.title }}
        run: |
          # Conventional-commit subject grammar — mirrors commit-convention.yml.
          pattern='${CONVENTIONAL_SUBJECT_PATTERN}'
          if printf '%s\\n' "$PR_TITLE" | grep -qE "$pattern"; then
            echo "PR title is valid: $PR_TITLE"
          else
            echo "PR title does not follow Conventional Commits format."
            echo "Expected: <type>[!]: description  or  <type>(<scope>)[!]: description"
            echo "Valid types: feat, fix, docs, chore, refactor, test, style, perf, ci, build, revert"
            echo "(A [WIP] prefix also fails: remove it once the PR is ready to merge.)"
            echo "Got: $PR_TITLE"
            exit 1
          fi
`;
