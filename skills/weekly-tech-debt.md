---
name: weekly-tech-debt
description: Audit a codebase for tech debt — combine session-friction analysis with structural static review — and express filable findings.
---

Audit a codebase for tech debt and surface filable findings: $ARGUMENTS

Run from inside the target project repo (or pass an optional target repo/path).

---

> **Scope**: this skill is tech-debt _craft_, not coordination. It owns the
> **detection**: how to mine session friction, how to read module structure, and
> how to judge what is worth filing. The mechanical **how** — which labels to
> apply, which milestone a finding belongs to, how the issue is de-duplicated
> against the tracking ledger, and how it is routed — belongs to the coordinator,
> not to this skill. Never name a workflow/domain label or cite a specific issue
> template mechanism; speak of "the coordinator" abstractly for anything
> mechanical, and describe issue writes generically (`gh` / GitHub MCP
> `mcp__github__*`).

> **Runner-agnostic emission (read this first).** This skill produces a **set of
> findings** — each a diagnosed piece of debt with a location, a severity, and a
> suggested fix. How those findings are _recorded_ depends on the runner:
>
> - **Run directly by the harness**: you file the issues yourself. Use a GitHub
>   MCP tool (`mcp__github__issue_write`) or `gh issue create`, applying the label
>   that matches the project's domain conventions. Prefer an MCP tool where one
>   exists; fall back to `gh` only when no equivalent is available.
> - **Dispatched by a coordinator**: your GitHub credentials are scrubbed and
>   **you must not file**. You only _express_ the findings — location, severity,
>   diagnosis, suggested fix — and the coordinator renders them into issues,
>   applies the correct labels, assigns milestones, and de-duplicates against what
>   is already tracked.
>
> Either way, **do not** hard-code any coordinator's label taxonomy, milestone
> mechanics, or ledger-routing into your output. Express each finding as a
> self-contained diagnosis so it maps cleanly onto whatever the runner emits.

## Step 1 — Orient

Determine the project context: the repo root, the GitHub remote, and the
`owner/repo` slug (via `gh repo view` or the MCP equivalent). Save the slug — a
direct run needs it for filing and for checking existing issues.

If there is no GitHub remote, there is nothing to file against: express the
findings as a formatted list and stop after the analysis.

## Step 2 — Session friction audit

Search the **last 7 days** of Claude Code transcripts for _code-level_ friction
in this project. The signal you want is not workflow errors, but moments where the
**structure of the code itself** caused hesitation, re-reading, or a workaround —
the code fighting the agent, not the tooling.

Query the transcript store (`mcp__ccd_session_mgmt__search_session_transcripts`)
one query at a time, collecting all results before moving on. Target these
friction signals:

| Signal                        | Query terms                                                                 |
| ----------------------------- | --------------------------------------------------------------------------- |
| Naming friction               | `rename` / `"should be called"` / `"confusing name"` / `"unclear name"`     |
| Navigation friction           | `"hard to find"` / `"where is"` / `"looking for"` / `"not sure which file"` |
| Files with surprising content | `"re-read"` / `"read again"` / `"let me re-read"`                           |
| Forced workarounds            | `"workaround"` / `"hack"` / `"unfortunately"` / `"I had to"`                |
| Duplication signals           | `"duplicate"` / `"already exists"` / `"same logic"` / `"repeated"`          |
| Oversized files               | `"too large"` / `"big file"` / `"long file"` / `"split this"`               |
| Dependency problems           | `"circular"` / `"import cycle"` / `"dependency"`                            |

Filter results to sessions involving the current repo (match by project path or
repo name). For each hit, note the file or symbol mentioned, the friction type,
and the session date — the date and signal become the evidence for any issue this
produces. Friction that appeared in **multiple** sessions is your strongest
signal and should carry the highest severity.

If no relevant sessions exist in the past 7 days, note that and proceed with
static analysis alone.

## Step 3 — Static code analysis

Read the top-level directory structure first, then the source root. Dive deeper
into areas flagged in Step 2 and any areas that look structurally complex. Do
**not** edit any files in this step — this is a read-only audit.

### 3a. Naming consistency

- Are file names consistent in style within a layer? Mixed styles (kebab-case
  next to camelCase next to snake_case) in the same layer are a smell.
- Do component / class / function names match what they actually do?
- Are there undefined, unexplained abbreviations in identifiers?
- Are there names so generic they carry no meaning — `util`, `helper`,
  `manager`, `handler`, `data`, `info`, `stuff`?
- Are there confusable near-twins (`UserService` / `UsersService`, `auth.ts` /
  `authentication.ts`)?
- Do exported names reflect their module, or do they only make sense once you know
  the full import path?

### 3b. Abstraction quality

- Find the largest files (over ~400 lines) and read the biggest.
- Are there functions or components doing multiple unrelated things (low
  cohesion)?
- Is there duplicated logic to extract — identical or near-identical blocks across
  files?
- Are there "god objects" — files that import from everywhere and are imported by
  everyone?
- Are there **thin wrappers** that add no value — a function that only calls
  another function with the same arguments? These are noise the moment they stop
  earning their name; flag them for inlining.
- Does the **data model leak** into the presentation layer, or vice versa —
  persistence or wire types (DB rows, API DTOs) used raw where a mapped
  boundary type belongs?

### Targeting for the structural passes (3c–3f)

The four passes below analyze module _structure_, which you cannot do by reading
every file. Bound the cost with an explicit target set: the top ~5–10 modules by
**import frequency** (how many other files import them — grep for the module's
path in import statements) or by **recent git churn** (the most-changed files over
the last ~90 days). Adapt the heuristic to the project's layout — the judgment is
yours. Never expand to "read every module": if a pass surfaces a thread worth
pulling outside the target set, note it as a candidate for the _next_ audit rather
than widening this sweep.

### 3c. Public-API coherence

The primary "bad abstraction" detector: a module's export list should read as one
coherent concept. For each targeted module, list its exported symbols (grep for
`export` declarations, or read the barrel/`index`) and cluster them by concern:

- **Grab-bag modules**: exports spanning 4+ unrelated concerns (date formatting,
  HTTP retries, and permission checks all exported from one `utils.ts`) → split
  candidate. **Name the clusters** a split would produce.
- **Near-dead exports**: symbols with 0–1 importers anywhere → make them internal
  (drop the `export`) or delete them outright.

### 3d. Cross-module duplication

Hunt for _concept-level_ duplicates — logic a text diff would never match, but
that implements the same capability twice. Within the target set (plus any
suspects from Step 2), look for:

- **Same capability, different names**: two modules implementing one thing under
  different vocabulary (`CacheManager` vs `MemoService`, `HttpClient` vs
  `RequestHandler`).
- **Re-implemented utilities**: `formatDate` / `deepClone` / `parseQuery`-class
  helpers written independently in 3+ files — grep for the characteristic names
  and signatures.
- **Parallel hierarchies**: two similar trees of types or functions that evolve in
  lockstep and should be one abstraction.

For each hit, judge explicitly: a **true duplicate** (consolidate into one
implementation) or **meaningfully different** (then the finding, if any, is that
the difference is undocumented — note where a comment should say why both exist).

### 3e. Module cohesion & coupling

For each targeted module, map imports in both directions — grep for imports that
reference the module, and read the module's own import block:

- **Circular imports**: pairs of modules that import each other. Flag every cycle
  — each is a module boundary that has already failed.
- **God modules**: high fan-in _and_ high fan-out — imported by many while
  themselves importing from many unrelated concerns. They couple everything to
  everything.
- **Low-cohesion modules**: a module whose own imports span many unrelated areas
  is doing too many jobs → split candidate.

### 3f. Overloaded-module detection

These findings feed the Step 4 architecture assessment — carry them forward rather
than treating them as per-file nits:

- **Interface bloat**: a module or barrel exporting more than ~15 symbols.
- **Directory size imbalance**: one folder dominating the codebase (by file count
  or total lines) while its siblings stay small — the dominant folder is usually
  several concepts wearing one name.
- **Responsibility drift**: read the module's name and any doc comment stating its
  purpose, then its actual exports. Do the exports cluster into 2+ clearly
  separable concerns? If so, name the seam a split would follow ("parsing vs.
  rendering", "fetching vs. cache policy").

### 3g. Legacy patterns

Catalogue markers of abandoned or deferred work:

- `TODO` / `FIXME` / `HACK` / `XXX` / `@deprecated` / `TEMP` / `REMOVE ME`
  markers — grep for them, then read the matching lines so a stale marker isn't
  filed as live debt.
- Commented-out code blocks (multi-line comment sections that are not
  documentation).
- Old API patterns sitting alongside newer ones for the same concern (`fetch`
  next to `axios`, REST calls next to SDK calls).
- Dead exports — symbols exported but never imported anywhere.
- Feature flags or conditional blocks referencing completed work that is no longer
  toggled.

### 3h. Structural clarity

- Does the top-level folder structure make the app's architecture immediately
  clear to a new reader?
- Are module / layer boundaries well-defined and respected (no `../../` chains
  crossing layers)?
- Is there clear separation between data-fetching, business logic, and
  rendering/presentation?
- Are types co-located with the code they describe, or scattered into one global
  types file that everything imports?
- Do tests mirror the source tree, or pile into one flat folder?

## Step 4 — Architecture assessment

Step back from individual files and assess the overall design. Read any
architecture docs, `AGENTS.md`, or `README` describing the intended structure, and
fold in the overloaded-module findings from 3f.

- What is the dominant architectural pattern (feature-based, layered, MVC, …)? Is
  it applied consistently, or does it drift?
- Are there modules that outgrew their original scope and now own multiple
  concerns?
- Is there a cleaner folder/module structure that would reduce coupling — e.g.
  collapsing scattered feature directories into one cohesive module?
- Are cross-cutting concerns (auth, logging, error handling, analytics, feature
  flags) handled ad-hoc at each call site, or centrally?
- Is there a pattern mismatch between what the framework expects and how the code
  uses it (a Next.js app treating API routes like a REST server instead of server
  actions; a React app managing server state with `useState`)?
- Are internal API surfaces larger than necessary — a module exposing 20 functions
  when 3 would do?
- Are there **thin layers or adapters** that add no value — a wrapper layer whose
  functions only forward to one underlying function with the same arguments?
- Does the **data model leak across layers** — persistence or wire types used raw
  in the presentation layer instead of being mapped at the boundary?

## Step 5 — Diagnose, cluster, and set severity

Turn the raw observations into a clean set of findings worth acting on. Noise is
the enemy: a report that files ten low-value nits trains readers to ignore it.

**Cluster related symptoms into one finding.** Five inconsistently named route
handlers in the same module are _one_ finding, not five. A grab-bag module and its
near-dead exports are one split, not two tickets.

**Assign severity** by real-world impact:

- **High** — causes real bugs or data loss, makes adding features risky, or
  appeared in multiple agent sessions as a concrete blocker.
- **Medium** — adds clear friction but work routes around it; an agent had to
  pause or adapt because of it.
- **Low** — aesthetic or nice-to-have; worth tracking but not urgent.

**File High and Medium.** File Low only when there are fewer than three
High/Medium findings total, so a genuinely clean codebase produces a short honest
report rather than manufactured busywork.

**Check what already exists.** Before treating a finding as new, scan the
project's open issues for one that already describes it (a keyword search over open
issues, plus the debt-labelled set). A finding already tracked is not re-filed —
note it as already-covered. In a coordinator-dispatched run, de-duplication and
ledger reconciliation are the coordinator's job; you still note likely overlaps so
it has the context.

## Step 6 — Emit the findings

For each surviving finding, produce a self-contained diagnosis with four parts, so
it stands on its own whether you file it or a coordinator does:

- **Problem** — what the issue is and where it lives: file paths, symbol names,
  specific lines where relevant.
- **Why it matters** — the concrete effect: makes feature X hard to add, caused
  agent confusion on `<date>`, introduces bug risk because Y. Be specific; a vague
  "this is messy" finding gets deprioritised.
- **Suggested fix** — the target state, not just the complaint: rename, extract,
  delete, consolidate, inline the thin wrapper, map the leaked type at the
  boundary. Name the clusters a split would produce.
- **Evidence** — for a session-sourced finding, the session date and the friction
  signal; for a static finding, the offending code or pattern quoted.

**Direct (harness) run** — file each finding yourself via `mcp__github__issue_write`
(or `gh issue create`), with a concise title and the four-part body. Apply the
label that matches the project's domain conventions; if a needed label is missing,
the coordinator owns the taxonomy — create it per the project's convention only
when running directly and it is clearly required. Render the diagnosis body with
the `Write` tool to a file and pass it by reference rather than shell-constructing
it. Sign the body with your full model name.

**Coordinator-dispatched run** — your credentials are scrubbed; **do not file.**
Express the findings — title, four-part body, severity, and any suspected
duplicate — and let the coordinator render, label, assign, and de-duplicate them.

## Step 7 — Summarize

Close with a short report the caller can relay: how many sessions were scanned and
how many friction signals surfaced; how many files were reviewed and how many
legacy markers were found; the findings by severity with their sources
(session date vs. static analysis); which findings were already covered by open
issues and so not re-filed; and which Low items were skipped below the threshold.

A run that files nothing because everything is already tracked is a **good
outcome**, not a gap — report it plainly.
