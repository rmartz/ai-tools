---
name: weekly-tune-up
description: Analyze the last 7 days of transcripts, cluster the friction, audit for cross-repo drift, and propose concrete tooling improvements — each routed to the repo that owns it.
---

Analyze the last 7 days of Claude Code transcripts, identify friction patterns,
cross-reference them against the current directives and skills, audit the
dotfiles → ai-tools/ai/ai-reports split for drift, and propose concrete
improvements — each one routed to the repository that owns its artifact type.

---

> **Tooling**: this skill is tune-up _craft_, not coordination. It owns the
> **what** — the friction-detection method, the routing judgment (which repo an
> artifact belongs in), the drift classification, and the diagnosis of each
> cluster into a gap type. The **how** — the exact transcript-extraction command,
> which label to apply, how a filed issue or PR body is formatted, and how the
> resulting change is merged — belongs to the coordinator (PR Shepherd) and is
> abstracted here. For direct GitHub reads/writes prefer the GitHub MCP tools
> (`mcp__github__*`); fall back to `gh` only where no equivalent exists. Never
> name a workflow/gate/verdict label — that vocabulary is the coordinator's.

> **Runner-agnostic emission (read this first).** This skill produces a set of
> **proposals**, each tagged with a **destination repo** and a **gap type**. How
> those proposals are _recorded_ depends on the runner:
>
> - **Run directly by the harness**: you carry them out yourself — edit the
>   dotfiles-destined artifacts in a worktree, and for every proposal destined for
>   another repo, file a linked issue there via `mcp__github__*` / `gh`.
> - **Coordinator-dispatched run**: your GitHub credentials are scrubbed and you
>   **must not** edit or file anything. You only _express_ the routed proposals;
>   the engine renders and records them.
>
> Either way, do **not** bake in any coordinator's PR-body section format, label
> names, or merge semantics. Express each proposal as
> `{ change, destination-repo, gap-type, evidence }` and let the runner emit it.
> The **routing judgment** — the decision of which repo a change belongs in — is
> yours and stays here; the **routing plumbing** is the runner's.

## Step 1 — Gather friction data

Pull the last 7 days of transcripts and extract a structured friction report
(the runner provides the extraction; you consume its output). Read it carefully
and note the volume and distribution across these categories:

- **Tool errors** — tool calls that returned an error.
- **User corrections** — short messages where the user redirected or corrected
  course.
- **Hook blocks** — tool calls denied by a pre-tool hook.
- **Tool retries** — the same tool re-invoked after a likely failure.
- **Context compactions** — sessions that hit the token limit.
- **Permission-prompt frequency** — the same tool call repeatedly hitting the
  approval prompt across sessions; an allowlist (or named-script extraction)
  candidate.
- **Published-CLI shadow** — a dotfiles script invoked where an installed `ai-*`
  CLI equivalent already exists (the local copy is a shadow of the maintained
  successor).
- **Symlink / install staleness** — missing `~/.claude` symlinks, skills not
  installed, or an `unknown command` error on a slash command.
- **Rate-limit stalls** — GitHub API 429s or GraphQL point-exhaustion patterns
  stalling a run.

The last four are **split-aware**: they only exist because tooling now lives
across several repos rather than in one. Treat them as first-class friction, not
edge cases.

If there are no events, stop and tell the user — there is nothing to tune.

## Step 2 — Route every proposal to its destination repository

The tooling is split across repos — dotfiles is no longer the home for
everything. Deciding **where** a change belongs is core craft: every proposal is
routed to the repo that owns its artifact type before it goes any further.

| Proposed-change type                                                      | Destination repo                             |
| ------------------------------------------------------------------------- | -------------------------------------------- |
| System config: `settings.json`, shell config, global CLAUDE.md directives | `rmartz/dotfiles`                            |
| Skills / packages / CLIs                                                  | `rmartz/ai-tools` (`skills/*`, `packages/*`) |
| Base directives & curated guidance                                        | `rmartz/ai` (guidance docs, Discussions)     |
| Reports / ledgers / metrics                                               | `rmartz/ai-reports`                          |
| Project-specific conventions                                              | that project's own repo                      |

Tag every proposal with its destination as part of diagnosis — no proposal
reaches Step 5 untagged. If a single proposal spans more than one destination,
**split it into one artifact per destination**; a proposal is never applied
across repos as a single unit.

## Step 3 — Read the current configuration and audit it for drift

### 3a — Read what defines current behavior

Read the files that define current behavior so you can spot the gaps: the global
directives, the dotfiles project notes, every skill, and the scripts/packages
that back them. You cannot diagnose a missing or weak directive without the
directive set in front of you.

### 3b — Audit the directive set for accumulated noise

Independently of the friction data, scan the global directives for structural
problems that incremental additions introduce over time:

- **Duplicates / near-duplicates** — two directives saying the same thing, or
  covering the same case from different angles. Consolidate into the stronger
  statement.
- **Contradictions** — two directives that could instruct opposite behavior in
  the same situation. The more specific or more recent one usually wins; flag for
  resolution.
- **Ambiguities** — a directive an agent could reasonably read two ways. Rewrite
  with a concrete example or an explicit exclusion.
- **Preferences leaking into review criteria** — an _authoring_ convention phrased
  so it could cause an agent to flag another author's style choice as a required
  change. Add a scope note, or move it to the relevant skill.
- **Wrong-section placement** — a project-specific directive sitting in the global
  file. Move it to that project's own CLAUDE.md, or drop it if already there.

For each finding record the affected directive (first ~15 words), the issue type,
and the proposed fix. A finding with no clear fix is noted for the user, not
touched. These feed Step 4 as the `directive-noise` gap type.

### 3c — Cross-repo drift audit (craft — keep in full)

For every dotfiles script that has an ai-tools port, compare which side is
current and classify the relationship:

- **Dotfiles copy is stale vs. the port** → `published-shadow`: recommend the
  installed `ai-*` CLI. Do **not** edit the stale dotfiles copy.
- **Port lags the dotfiles original** → `missing-port-update`: route a fix to
  `rmartz/ai-tools`.
- **Both changed recently and diverged** → `migration-drift`: flag for manual
  resolution. Flag and continue — do not halt the run.

> **Hard rule: never edit a dotfiles script that has an ai-tools port.** The port
> is the maintained successor; the fix always routes to `rmartz/ai-tools`, never
> to the dotfiles copy. Editing the shadow re-forks work that the migration exists
> to converge.

### 3d — Ad hoc command pattern analysis

Scan the transcript's shell commands for operations too complex or variable to
express as a safe allowlist glob — inline Python with a non-trivial body, long
`jq` chains (`select`/`map`/`group_by`/multi-level `.[]`), multi-stage
`gh api … | jq …` pipelines, `awk`/`sed`/`perl` one-liners reshaping `gh`/`git`
output. For each, record a short semantic label ("extract open-thread node IDs",
"filter CI check states"), the session, and the date. A pattern in **2+ sessions**
(under any spelling) justifies action. Cross-reference against existing coverage:

- **Coverage exists (documented or not)** → `missing-directive`: add a pointer to it.
- **No coverage** → `missing-script`: the pattern needs a new named script/CLI.
- **Fits as an extension of an existing script** (new flag/subcommand/format) →
  `script-extension`: extend it rather than creating a new file.

`missing-script` and `script-extension` rows already cleared the frequency bar
here, so they feed Step 4 as pre-classified clusters.

## Step 4 — Cluster and diagnose

Group friction events into thematic clusters. For each:

1. **Identify the pattern** — what went wrong or needed extra intervention?
2. **Find the cause** — is there a directive that should have prevented this but
   didn't, or none at all?
3. **Classify the gap**:
   - `missing-directive` — no rule covers this case.
   - `weak-directive` — a rule exists but is too vague to act on (add example /
     specificity).
   - `missing-script` — a repetitive multi-step task with no automation.
   - `missing-skill` — a workflow initiated repeatedly with no `/command` to
     standardize it.
   - `permission-gap` — a safe, routine call that keeps hitting the approval
     prompt. Repeated ad hoc patterns (inline Python, long `gh api … | jq …`) that
     can't be expressed as a simple glob are candidates for named-script
     extraction rather than a blanket allowlist.
   - `directive-noise` — a structural defect in the directive set itself (from 3b).
   - `migration-drift` — a fix that spans repos or is caused by the split itself
     (a stale copy and its port both changed). **Needs a destination decision
     (Step 2) before any edit is made.**

Discard clusters with fewer than 2 events — a single occurrence may be a one-off
not worth a directive.

## Step 5 — Propose concrete changes, each routed home

For each surviving cluster, draft exactly one artifact, written as a concrete
instruction (not a principle):

- **New / refined directive** — a single concrete bullet (`When X happens, do Y.
Never do Z.`), or a before/after edit to a specific skill step. Apply only where
  the friction clearly points at that gap.
- **New script / CLI** — for a 3+-command sequence repeated across 2+ sessions,
  in the style of the destination repo's existing tooling, with a pointer added
  wherever agents will look for it.
- **Allowlist entry** — for a safe command that kept prompting. Be as specific as
  possible; never add a blanket glob. If the command is too complex for a clean
  glob, prefer extracting it into a named script and allowlisting that.

For each proposal write a one-sentence evidence citation — the project, session,
and friction type that motivated it (e.g. "3 tool-error events in
`hidden-role-game` sessions `Fix auth middleware`, `Debug login flow`").

**Route, don't cross-edit.** Carry each proposal's Step 2 destination all the way
through. In a direct run, edit only the artifacts whose destination is the repo
you're working in; for every proposal destined elsewhere, file a **linked issue**
in the target repo describing the change and its evidence, so it is tracked as
real work in its own repo rather than a dangling recommendation. The mechanics of
_how_ those issues and edits are grouped, labeled, and merged are the runner's —
your job is to get each proposal to the right repo with enough context to act on.

## Step 6 — Report

Report to the caller:

- **Friction analysis** — events found, clusters that survived the 2-event
  threshold, and the drift classifications from the cross-repo audit.
- **Proposals** — one line each: the change, its destination repo, and its gap
  type.
- **Routing** — which changes were applied locally vs. filed as linked issues in
  another repo, with links.

Render every issue/PR number as a markdown link (`[#49](…)`), never a bare `#N`.
Any issue you file on the user's behalf gets a signed footer with your full model
name: `\n\n---\n*Created by <model>*`.
