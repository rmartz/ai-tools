---
type: Design
title: PR Shepherd handoff
description: The ai-tools → PR Shepherd delegation contract — published API PR Shepherd consumes, the injection seams it must supply, and what is delegated to it rather than ported here.
tags: [handoff, pr-shepherd, delegation, contract]
---

# ai-tools → PR Shepherd handoff

A single reference for the agent building **`rmartz/pr-shepherd`**: what `ai-tools`
publishes for PR Shepherd to consume, the seams PR Shepherd must fill, and the
coordinator/gate/verdict functionality that is **delegated to PR Shepherd** (not
ported into `ai-tools`). Source-of-truth pointers are at the bottom.

## The dependency contract

- **One-way arrow: PR Shepherd → ai-tools.** PR Shepherd imports `ai-tools`
  packages; **nothing in `ai-tools` imports PR Shepherd.**
- **No `ai-tools` package knows PR Shepherd's gate/verdict labels** (`approved`,
  `changes requested`, `ready for UAT`, `UAT pending`, `no UAT needed`, `tested`,
  …). Those live in PR Shepherd. The `@rmartz/bootstrap` label roster deliberately
  excludes them.
- **Layers** (enforced by `eslint-plugin-boundaries`): 0 foundation, 1 tooling,
  2 composed. PR Shepherd may consume any layer.

## Consuming the packages

Published to **GitHub Packages** (private npm) by `release.yml` on `v*` tags.
Consumer setup:

```
# .npmrc
@rmartz:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}   # needs read:packages
```

Then `pnpm add @rmartz/agent-runtime @rmartz/github @rmartz/worktree …`. Every
package is a library first; each also ships thin CLIs (`ai-*`) the harness can
invoke, but PR Shepherd should import the library API.

## Published API surface (what PR Shepherd composes)

### layer-0

- **`@rmartz/agent-runtime`** — provider-agnostic runtime:
  - `boundedRun(cmd, args, { timeoutMs, cwd?, env?, input? })` — hard-timeout
    subprocess (kills the process group); `input` feeds stdin.
  - `buildArgv` / `runInvocation` / `fromTemplate` — headless `claude` argv build + exec.
  - `dispatchSkill(...)`, `TranscriptResumeRegistry`, `dispatchEnv`,
    `injectSessionId`, `claudeTranscriptPath`, `ENV_*` constants — skill dispatch
    with session-id pinning + resume-on-retry.
  - `renderSkillMeta` / `skillMetaPattern` / `hasSkillMeta` / `countSkillMeta` —
    hidden traceability markers.
  - resume: `formatMarker` / `parseMarker` / `selectActivePointer` /
    `countActiveMarkers`, the `ResumeStore` interface, `FsResumeStore`,
    `recordResumeMarkerOnTimeout` / `recoverResumePointer`.
  - `classifyCommand` (CI `run:` → check category), `parseLogEvents` (JSONL).
- **`@rmartz/github`** — the shared GitHub client (REST-first → GraphQL fallback,
  soft-fail to `null`): issue ops (`findOpenIssue`/`createIssue`/`addIssueComment`/
  `addAssignees`), labels CRUD, `fetchPrSummary`, `computePrDiff`,
  `gatherRepoStatus`, `postPrComment` (+ `skillMeta`), `resolveThread`/
  `dismissThread`, `submitReview`/`mergePullRequest`, the Discussions client,
  `currentRepo`, and the rate-limit coordinator.

### layer-1

- **`@rmartz/worktree`** — `new-worktree`, `git-cleanup`, `worker-permissions`.
- **`@rmartz/verify`** — `pre-push-verify`, `tool-resolver`, `infra-failure`.
- **`@rmartz/repo-hygiene`** — `check-conflict-markers`.
- **`@rmartz/bootstrap`** — `ensure-labels`, `ensure-project-config`.

### layer-2 (in progress — scope confirmed against PR Shepherd)

A scout of PR Shepherd (a derive→decide→execute daemon that spawns ai-tools
skills by name) confirmed **all nine Wave 2 modules belong in ai-tools**; PR
Shepherd composes them. Verdicts:

- **`@rmartz/pr-review`** — `review` skill craft, `dependabot-risk` judgment,
  review `context-helpers`. PR Shepherd has a review _step_ + gate but **no review
  craft** — it spawns the `review` skill. Build all three here.
- **`@rmartz/issues`** — `create-issue` skill craft, `dependabot-fix-issue`
  authoring. Absent in PR Shepherd (it owns Dependabot _mechanics_ via #199 —
  `spawn_fix_pr` / `rebase_dependabot` / merge arbitration — not the _judgment_).
  Build both here.
- **`@rmartz/reporting`** — `tracking` (ledgers → `rmartz/ai-reports`) and
  `friction` (transcript scan): absent in PR Shepherd, build here. `anomaly` and
  `efficiency-audit`: **complementary primitives** — coordinate with #109 (see
  below).

## Two contract boundaries Wave 2 must respect

### Skill-outcome protocol (PR Shepherd owns it)

PR Shepherd defines the **Skill Outcome Protocol** (`src/engine/outcome`,
`docs/subsystems/skill-outcome-protocol.md`): every dispatched skill ends by
recording **one** `<!-- skill-outcome: {json} -->` marker (`SkillOutcomeRecord`:
skill, skillVersion, gitHash, **outcome** ∈ {`approve`, `soft_reject`,
`hard_reject`, `no_op`, `error`}, runId, stepInstanceId, headSha, timestamp). The
engine routes purely off it. Crucially, **a dispatched skill cannot post** — its
GitHub credentials are scrubbed; PR Shepherd's `buildOutcomeAction` + `github_api`
queue render and post the record.

Implication for ai-tools skill craft (`review`, `create-issue`, dependabot
judgments): the skill describes the **judgment** and expresses a verdict that maps
onto that outcome enum, but it must stay **runner-agnostic about emission** —
do **not** bake PR Shepherd's typed marker format or posting into the skill. When
run directly by the harness, the skill posts via `@rmartz/github`
(`postPrComment` / `submitReview`); under PR Shepherd, emission is the engine's.

### Reporting ↔ self-observability (#109) — coordinate the taxonomy

PR Shepherd's open **#109** (self-observability, Epic 11) detects engine-internal
anomalies (timeout-then-fast-retry, fix-review loops, high retry rate, duration
outliers, merge failures, mass-blocking) and records per-merge efficiency metrics
**over its own event stream**. `@rmartz/reporting`'s `anomaly` (diagnosis +
ledger routing) and `efficiency-audit` (deterministic PR-history profiler) are the
broader, harness-facing primitives. To avoid two parallel taxonomies: PR Shepherd
#109 should **detect/emit** engine anomalies and **call the ai-tools primitive to
file** them into `rmartz/ai-reports`; align the anomaly-category enum + the
event-record schema across the seam. The deprecated `coordinator-self-report`
pattern (writing reports into PR Shepherd's own issues, e.g. PR Shepherd #168)
should be retired in favor of `rmartz/ai-reports`. **The proposed shared contract
(anomaly enum + occurrence record + filing API + efficiency event) is in
[Reporting event schema](reporting-schema.md) — pending your confirmation.**

## Seams PR Shepherd must supply (injection points)

These are deliberately abstracted so PR-Shepherd-specific behavior stays out of
the foundation:

- **`ResumeStore`** — the resume layer abstracts persistence behind
  `ResumeStore { read(): Promise<ResumeEntry[]|null>; append(entry): Promise<void> }`.
  PR Shepherd implements a **PR-comment-backed store** (`read` → `gh pr view`
  comments; `append` → `gh pr comment`). The bundled `FsResumeStore` is only for
  the harness/tests.
- **`confirmationRe`** — the fix-confirmation/skill-meta supersession regex is a
  parameter on the resume + dispatch APIs. PR Shepherd supplies its own; keep its
  confirmation-marker label **distinct** from the resume marker's
  `coordinator-resume-pointer` sentinel (or a pointer supersedes itself).
- **skill-meta field resolution** — `ai-tools` _renders_ the marker
  (`renderSkillMeta`) and _posts_ it (`postPrComment({ skillMeta })` /
  `ai-pr-comment --skill-meta`). PR Shepherd **resolves the fields**: PR-head,
  the skill-file hash (`git hash-object` on its own skill files), and the
  transcript / coordinator-start-time correlation from its run context.
- **session ids** for `dispatchSkill`.

## Delegated TO PR Shepherd (not ported into ai-tools)

From the migration ledger + dotfiles inventory §1 — start from
`docs/design/pr-lifecycle-spec.md` in `rmartz/dotfiles`:

- **Routing / gate engine:** `pr_route`, `pr_gate_*`, `prioritization`,
  `gate_routing`, `stacked_pr`.
- **Per-PR coordinator loop:** `pr_review_iteration`, `stall_detection`,
  `liveness_watchdog`, `main_breakage`.
- **Verdict-recording protocol:** `post-review-verdict`, `verdict_lifecycle`,
  `fix-confirmation`, `post-uat-labels`, `breaking-change`, gated
  `merge-pr` / `merge_status`.
- **Dependabot mechanics:** sweep / advance / merge. (Only the two Dependabot
  _judgment_ skills — risk assessment + fix-issue creation — stay in `ai-tools`.)
- **Resume persistence** (the PR-comment `ResumeStore` impl) + `worktree_salvage`.
- The **`route-prs` / `drive-to-merge` / `assess-progress`** skills.

## Re-homing decisions made during this migration

- **`ci_status.py` → PR Shepherd** (ai-tools #10 closed, not ported). It is a
  pure classifier, but its input is a PR-Shepherd GraphQL projection and it is
  **already implemented natively** in PR Shepherd Epic 10 (`#96` state-axis
  derivation, `#98` gate model, `#100` evaluate_gates).
- **`branch_currency.py` → PR Shepherd** (ai-tools #11 closed, not ported). It is
  orchestration (imports routing/merge/tracking), owned by PR Shepherd **`#104`**
  (merge path; it already has a branch-currency acceptance criterion). Two edge
  cases to carry over (noted on `#104`): (1) **never `update-branch` a Dependabot
  PR** — it creates a foreign web-flow commit Dependabot then refuses to rebase;
  (2) **fail fast on operator-actionable update failures** (missing OAuth scope /
  bad credentials / insufficient permission / unauthorized SSO can never succeed
  on retry).
- **`submitReview` + `mergePullRequest` KEPT in `@rmartz/github`** as thin,
  label-free, gate-free primitives. PR Shepherd composes `mergePullRequest` inside
  its gated, serialized merge path (`#104`) rather than reimplementing the raw
  call; all gating/verdict logic stays PR Shepherd's.

## Source-of-truth pointers

- Migration ledger — `~/Development/ai-repos-skeletons/MIGRATION-LEDGER.md`
  ("Goes to PR Shepherd" + per-package tables).
- Dotfiles inventory — `~/Development/ai-repos-skeletons/repo-split-inventory.md`
  §1 (PR Coordinator) and §7 (cross-repo seams).
- PR lifecycle spec — `docs/design/pr-lifecycle-spec.md` in `rmartz/dotfiles`.
