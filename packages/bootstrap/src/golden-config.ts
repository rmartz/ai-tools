/**
 * Golden-state config contents for a pnpm/TypeScript monorepo. This is the data
 * half of `ensure-project-config`; the logic halves (`ensure-project-config.ts`
 * for ignore blocks, `ensure-workflow-files.ts` for whole files) stay small by
 * keeping the file *contents* here.
 *
 * Two categories, two idempotency strategies:
 *
 * - **Ignore files** (`.prettierignore` / `.eslintignore` / `.gitignore`) — a
 *   fenced marker block spliced into a possibly user-authored file. We ensure the
 *   block is present and leave lines outside it untouched: "ensure block present,
 *   don't clobber user content". Reframe of dotfiles' `ensure_project_config.py`,
 *   which appended a single `.git-worktrees` line plus an `eslint.config.js`
 *   array-splice; here the stack is pnpm + TS, so the ignores cover the TS
 *   build/test artifacts (`dist`, `.turbo`, `*.tsbuildinfo`, `coverage`) and
 *   `node_modules`, alongside the worktree dir.
 * - **Whole workflow files** (`.github/workflows/*.yml`) — a whole managed file,
 *   not a block spliced into user content. A GitHub Actions workflow that is
 *   identical across every repo (zero project-specific logic) is a
 *   copy-distribution candidate: write it if absent, overwrite it if it has
 *   drifted from the golden template, and leave it alone if a *user-authored*
 *   file (one without our managed header) already sits at that path. See
 *   `ensure-workflow-files.ts`.
 */

/** Sentinel lines bracketing the managed region in every ignore file. */
export const BLOCK_BEGIN = '# >>> ai-tools managed (ensure-project-config) >>>';
export const BLOCK_END = '# <<< ai-tools managed (ensure-project-config) <<<';

export interface GoldenIgnoreFile {
  /** Repo-root-relative filename. */
  filename: string;
  /** Ignore entries the managed block should contain, in order. */
  entries: string[];
}

const WORKTREES = '.git-worktrees/';

/** Build artifacts and vendored deps a TS monorepo should never format/lint/commit. */
const TS_ARTIFACTS = ['node_modules/', 'dist/', '.turbo/', '*.tsbuildinfo', 'coverage/'];

/**
 * The golden ignore files for a pnpm/TS monorepo:
 *
 * - `.prettierignore` — skip build output, vendored deps, and worktrees.
 * - `.eslintignore` — same; honored by flat config via `--ignore-path` and the
 *   universal fallback when an `eslint.config.*` ignores array can't be edited safely.
 * - `.gitignore` — keep artifacts and worktrees untracked.
 */
export const goldenIgnoreFiles: readonly GoldenIgnoreFile[] = [
  { filename: '.prettierignore', entries: [...TS_ARTIFACTS, WORKTREES] },
  { filename: '.eslintignore', entries: [...TS_ARTIFACTS, WORKTREES] },
  { filename: '.gitignore', entries: [...TS_ARTIFACTS, WORKTREES, '.DS_Store'] },
];

/**
 * Substring that marks a workflow file as bootstrap-managed. Its presence is the
 * signal `ensure-workflow-files` uses to decide it may overwrite a drifted file:
 * a file *without* this marker is user-authored and is left untouched.
 */
export const WORKFLOW_MANAGED_MARKER = 'ai-tools managed (ensure-project-config)';

/** Header prepended to every managed workflow file, carrying {@link WORKFLOW_MANAGED_MARKER}. */
export const WORKFLOW_MANAGED_HEADER = [
  `# >>> ${WORKFLOW_MANAGED_MARKER} — do not edit by hand >>>`,
  '# Source of truth: @rmartz/bootstrap golden workflow files. Re-run the',
  '# /bootstrap skill (ai-ensure-project-config) to re-sync; local edits are lost.',
].join('\n');

export interface GoldenWorkflowFile {
  /** Repo-root-relative path, e.g. `.github/workflows/dependabot-auto-merge.yml`. */
  filename: string;
  /**
   * The golden file body, verbatim, *without* the managed header — the header is
   * prepended at write time so the marker can't be forgotten.
   */
  content: string;
  /**
   * Required status-check contexts that GitHub-native auto-merge in this file
   * depends on. Consumed by the (separate, network-touching) auto-merge gate
   * verifier — never by the hermetic writer — but co-located here so the file and
   * the gate it needs travel together.
   */
  gateChecks: readonly string[];
  /**
   * Idempotency policy for the file:
   * - `manage` (default) — a fully bootstrap-owned file: write if absent,
   *   overwrite if it has drifted from the golden template, guarded by the managed
   *   header so a user-authored file at the path is never clobbered.
   * - `seed` — a *starting point* the repo then owns: write it (no managed header)
   *   only if absent, and never touch it again once present. For files repos are
   *   expected to customize (`.github/dependabot.yml`), where overwriting local
   *   edits on every bootstrap would be wrong.
   */
  policy?: 'manage' | 'seed';
}

// Generic Dependabot native-auto-merge workflow: on a green `semver-patch` /
// `semver-minor` Dependabot PR it enables GitHub-native auto-merge (majors stay
// manual). Zero project-specific logic, so it is distributed by idempotent copy
// rather than reimplemented per repo. `dependabot/fetch-metadata` is pinned to a
// full commit SHA with a `major.minor.patch` comment per the Actions-pinning
// convention; Dependabot's `github-actions` ecosystem keeps the SHA fresh.
const DEPENDABOT_AUTO_MERGE = `name: Dependabot Auto-merge

on: pull_request_target

permissions:
  contents: write
  pull-requests: write

jobs:
  auto-merge:
    name: Enable auto-merge
    runs-on: ubuntu-latest
    if: github.actor == 'dependabot[bot]'
    steps:
      - name: Fetch Dependabot metadata
        id: metadata
        uses: dependabot/fetch-metadata@21025c705c08248db411dc16f3619e6b5f9ea21a # v2.5.0
        with:
          github-token: \${{ secrets.GITHUB_TOKEN }}

      - name: Enable auto-merge for patch and minor updates
        if: steps.metadata.outputs.update-type == 'version-update:semver-patch' || steps.metadata.outputs.update-type == 'version-update:semver-minor'
        run: gh pr merge --auto --squash "$PR_URL"
        env:
          PR_URL: \${{ github.event.pull_request.html_url }}
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
`;

// Consumer-shape `merge-safety` workflow: it INSTALLS the published
// `@rmartz/pr-review` CLI (a public GitHub Packages package) and posts the
// `merge-safety` check-run — it does not build from source the way ai-tools' own
// in-repo workflow does, because a consumer repo has no monorepo checkout. It is
// generic across repos: the base branch is taken from the PR (falling back to the
// repo's default branch) on the evaluate path, and `push` fires on `main` (the
// default-branch case — a non-`main` repo adjusts that one literal). Advisory by
// default: seeding it makes the check *run*; making it a required gate is a
// separate per-repo curation step. `actions/checkout` is pinned by full SHA +
// `major.minor.patch` comment per the Actions-pinning convention; the CLI version
// is pinned here and re-synced by re-seeding (Dependabot does not bump workflow
// env), never `@latest`.
const MERGE_SAFETY = `name: merge-safety

on:
  pull_request:
    types: [opened, synchronize, reopened, edited, labeled, unlabeled]
  push:
    branches: [main]
  workflow_dispatch:
    inputs:
      pr:
        description: PR number to evaluate
        required: true

permissions:
  checks: write
  pull-requests: write
  contents: read
  actions: write
  packages: read

concurrency:
  group: merge-safety-\${{ github.event_name == 'push' && 'invalidate' || github.event.pull_request.number || inputs.pr }}
  cancel-in-progress: false

env:
  MERGE_SAFETY_VERSION: 0.4.0

jobs:
  evaluate:
    name: Evaluate one PR
    if: github.event_name != 'push'
    runs-on: ubuntu-latest
    timeout-minutes: 5
    env:
      GH_TOKEN: \${{ github.token }}
      PR_NUMBER: \${{ github.event.pull_request.number || inputs.pr }}
      BASE_REF: \${{ github.event.pull_request.base.ref || github.event.repository.default_branch }}
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          ref: \${{ github.event.pull_request.base.ref || github.event.repository.default_branch }}
          fetch-depth: 0 # merge-base + diffs need full history
      - name: Install ai-merge-safety
        env:
          NODE_AUTH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
        run: |
          printf '@rmartz:registry=https://npm.pkg.github.com\\n//npm.pkg.github.com/:_authToken=%s\\n' "\${NODE_AUTH_TOKEN}" > ~/.npmrc
          npm install -g "@rmartz/pr-review@\${MERGE_SAFETY_VERSION}"
      # Fetch the PR head as git data so merge-base/diffs resolve — the dispatched
      # (workflow_dispatch) path checks out the base and would otherwise lack it.
      - run: git fetch --quiet origin "\${BASE_REF}" "pull/\${PR_NUMBER}/head"
      - run: ai-merge-safety evaluate --pr "\${PR_NUMBER}" --repo "\${GITHUB_REPOSITORY}" --base "origin/\${BASE_REF}"

  invalidate:
    name: Invalidate open PRs (base moved)
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
    timeout-minutes: 5
    env:
      GH_TOKEN: \${{ github.token }}
    steps:
      - name: Install ai-merge-safety
        env:
          NODE_AUTH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
        run: |
          printf '@rmartz:registry=https://npm.pkg.github.com\\n//npm.pkg.github.com/:_authToken=%s\\n' "\${NODE_AUTH_TOKEN}" > ~/.npmrc
          npm install -g "@rmartz/pr-review@\${MERGE_SAFETY_VERSION}"
      - run: ai-merge-safety invalidate --repo "\${GITHUB_REPOSITORY}"
`;

// Generic Dependabot config, seeded (write-if-absent) as a starting point repos
// then own. github-actions is the minimum every repo wants (it keeps pinned
// action SHAs — including the auto-merge workflow's fetch-metadata — fresh); the
// npm ecosystem is the ideal for the JS repos this toolkit targets (it also feeds
// the native auto-merge path). Both are grouped so related bumps land as one PR.
// A repo without an npm manifest, or wanting other ecosystems, edits its copy —
// which the `seed` policy then leaves untouched.
const DEPENDABOT_CONFIG = `version: 2
updates:
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
    groups:
      github-actions:
        patterns:
          - "*"
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
    groups:
      dev-dependencies:
        dependency-type: development
      production-dependencies:
        dependency-type: production
`;

// Generic repo-hygiene CI, consumer shape (installs the published
// @rmartz/repo-hygiene CLI rather than building from source). It runs only the
// universally-safe `action-pins` check — every repo with workflows benefits from
// SHA-pinned actions. The other registered checks (okf / md-pairing / file-caps)
// are ai-tools-specific conventions that would false-fail on an arbitrary repo
// (okf flags any docs lacking OKF frontmatter; file-caps needs a per-repo
// baseline), so distributing them fleet-wide is a deliberate per-repo curation
// decision, not part of the universal golden set. `push` fires on `main`.
const REPO_HYGIENE = `name: repo-hygiene

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read
  packages: read

env:
  REPO_HYGIENE_VERSION: 0.4.0

jobs:
  action-pins:
    name: GitHub Actions SHA pins
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - name: Install ai-repo-hygiene
        env:
          NODE_AUTH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
        run: |
          printf '@rmartz:registry=https://npm.pkg.github.com\\n//npm.pkg.github.com/:_authToken=%s\\n' "\${NODE_AUTH_TOKEN}" > ~/.npmrc
          npm install -g "@rmartz/repo-hygiene@\${REPO_HYGIENE_VERSION}"
      - run: ai-repo-hygiene action-pins --check
`;

/**
 * Golden whole files distributed to every repo. Two idempotency policies (see
 * {@link GoldenWorkflowFile.policy}): `manage` (bootstrap-owned, overwrite drift)
 * for the workflows, `seed` (write-once, repo-owned) for the Dependabot config.
 *
 * - `dependabot-auto-merge.yml` (`manage`) — GitHub-native auto-merge for green
 *   patch/minor Dependabot PRs. Depends on `merge-safety` being a *required* check
 *   — the gate the auto-merge verifier confirms before the file may be seeded (an
 *   ungated `gh pr merge --auto` merges *immediately*, so it must never land
 *   without the gate).
 * - `merge-safety.yml` (`manage`) — posts the advisory `merge-safety` check
 *   (consumer shape, installs `@rmartz/pr-review`). No `gateChecks` of its own: it
 *   *provides* the check the auto-merge file depends on rather than consuming one.
 * - `.github/dependabot.yml` (`seed`) — a starting Dependabot config the repo then
 *   owns; bootstrap writes it only if absent and never overwrites local edits.
 * - `repo-hygiene.yml` (`manage`) — runs the universally-safe `action-pins` check
 *   via the published `@rmartz/repo-hygiene` CLI. Advisory; `gateChecks: []`.
 */
export const goldenWorkflowFiles: readonly GoldenWorkflowFile[] = [
  {
    filename: '.github/workflows/dependabot-auto-merge.yml',
    content: DEPENDABOT_AUTO_MERGE,
    gateChecks: ['merge-safety'],
  },
  {
    filename: '.github/workflows/merge-safety.yml',
    content: MERGE_SAFETY,
    gateChecks: [],
  },
  {
    filename: '.github/dependabot.yml',
    content: DEPENDABOT_CONFIG,
    gateChecks: [],
    policy: 'seed',
  },
  {
    filename: '.github/workflows/repo-hygiene.yml',
    content: REPO_HYGIENE,
    gateChecks: [],
  },
];

/**
 * The **cross-repo floor** of the auto-merge gate: the union of every golden
 * workflow's `gateChecks` (currently just `merge-safety`), the one member present
 * in any repo that runs the golden workflows.
 *
 * This is a floor, **not** a sufficient gate. GitHub-native auto-merge waits only
 * on *required* checks and ignores non-required ones, so requiring `merge-safety`
 * alone would still let a bump that breaks a *non-required* Test/Build auto-merge.
 * A safe gate additionally requires the repo's substantive CI checks (typecheck /
 * lint / format / build / test / PR-title, by whatever names that repo uses) —
 * which are repo-specific and so are supplied per repo via the verifier's
 * `--check` flags, not hardcoded here.
 */
export const goldenGateChecks: readonly string[] = [
  ...new Set(goldenWorkflowFiles.flatMap((w) => w.gateChecks)),
];
