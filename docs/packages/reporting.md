---
type: Library
title: reporting
description: Layer-2 composed reporting — tracking-issue ledgers (find-or-create-or-append) and transcript friction extraction.
resource: packages/reporting/src/index.ts
tags: [composed, reporting, tracking, friction, transcripts]
---

# @rmartz/reporting

Layer-2 composed package for **reporting** recurring agent observations. It
composes the layer-0 `@rmartz/github` issue ops and `@rmartz/agent-runtime`
transcript reader; nothing here knows about PR Shepherd's gate/verdict labels.

This round ships two concerns — **tracking** and **friction**. Two further
concerns (`anomaly` and `efficiency-audit`) are **deferred** pending cross-repo
schema coordination with PR Shepherd (rmartz/pr-shepherd#109); they have no
files or exports yet.

## Tracking ledgers (`tracking.ts`)

A tracking ledger is a long-lived GitHub issue that aggregates recurring
occurrences of one pattern into a single issue — one comment per occurrence —
rather than filing a new issue each time. `reportToTracking` owns the entire
**find-or-create-or-append** process:

1. Resolve the source repo (`sourceRepo`, else `currentRepo()`) and coordinator
   sha (`coordinatorSha`, else `coordinatorGitSha()`).
2. Prepend the standardized metadata header (below) to the body.
3. Find an open issue with the exact title and the `tracking` label.
4. **If found**, append the body as a comment; **if not**, create the issue with
   the body and the `tracking` label (first occurrence becomes the ledger).

Callers never pre-create or recreate the ledger: once a fix PR closes one, the
next occurrence recreates it lazily by title. All ops **soft-fail to `null`**,
matching the underlying `@rmartz/github` posture.

### Target repo

Ledgers default to the central **`rmartz/ai-reports`** repo
(`DEFAULT_TRACKING_REPO`), overridable per call via `repo`. A ledger usually
lives in this central repo while occurrences arrive from many app repos, so the
header's **Repository** line keeps each occurrence's origin unambiguous. (This
supersedes the retired "self-report into PR Shepherd's own issues" pattern.)

### Standardized occurrence header

`formatOccurrence(body, meta)` prepends one line per available field, in this
order — each omitted when its value is absent, returning the body unchanged when
no metadata exists:

| Field            | Header line                      | Source                       |
| ---------------- | -------------------------------- | ---------------------------- |
| `sourceRepo`     | `**Repository:** \`owner/repo\`` | `sourceRepo` / `currentRepo` |
| `coordinatorSha` | `**Coordinator:** \`sha\``       | `coordinatorSha` / git HEAD  |
| `skill`          | `**Skill:** \`/name\``           | `skill`                      |
| `pr`             | `**PR:** owner/repo#N` (or `#N`) | `pr`                         |
| `transcriptId`   | `**Transcript:** \`id\``         | `transcriptId`               |
| `skillMeta`      | `**Skill metadata:** \`marker\`` | `skillMeta`                  |

### API

- `reportToTracking(title, body, opts?) => Promise<string | null>` — the ledger
  URL, or `null` on failure. `opts`: `repo`, `label`, `extraLabels`, `cwd`,
  `call`, plus all `OccurrenceMeta` fields.
- `formatOccurrence(body, meta?) => string`
- `coordinatorGitSha(cwd?) => Promise<string | null>` — short HEAD sha, cached
  for the process lifetime; best-effort.
- `DEFAULT_TRACKING_REPO`, `TRACKING_LABEL` constants.

### CLI — `ai-report-to-tracking`

```
ai-report-to-tracking <title> <body-file> [--repo <owner/repo>] \
  [--source-repo <owner/repo>] [--skill <name>] [--pr <n>] \
  [--transcript <id>] [--meta <text>] [--delete-body]
```

`--repo` is the **ledger** repo (defaults to `rmartz/ai-reports`); `--source-repo`
is the repo the occurrence is about. `--delete-body` removes the body file, but
only after a successful post. Prints the ledger URL on success.

## Friction extraction (`friction.ts`)

Scans Claude Code transcript events for five friction signals and renders a
Markdown report. The JSONL reader is **not** re-implemented: the library parses
transcript text via `@rmartz/agent-runtime`'s `parseLogEventsText`, so it carries
no `~/.claude` directory-walking knowledge and tests stay hermetic (in-memory
strings).

Signals detected:

- **Tool Errors** — `tool_result` blocks with `is_error: true`.
- **User Corrections** — short user text matching correction keywords.
- **Hook Blocks** — user-role hook feedback matching blocked/denied patterns.
- **Tool Retries** — the same tool re-invoked in a later assistant turn.
- **Context Compactions** — `summarized`/`compact` events or context-limit
  mentions in system/assistant text.

### API

- `extractFrictionEvents(events, fallbackLabel?) => FrictionEvent[]`
- `extractFrictionFromText(text, fallbackLabel?) => FrictionEvent[]`
- `formatFrictionReport(results, days?) => string` — `days` only labels the
  heading; transcript discovery/windowing is the caller's job.

### CLI — `ai-extract-friction`

```
ai-extract-friction [--days N] <transcript.jsonl> [<transcript.jsonl> ...]
```

Takes explicit transcript paths (discovery is the caller's responsibility) and
prints the report. `--days N` labels the heading only.

## Deferred (pending pr-shepherd#109)

- **`anomaly`** — same-action-reroute / max-iterations anomaly reporting.
- **`efficiency-audit`** — post-run efficiency / mass-blocking self-reports.

Both depend on schema details still being coordinated with PR Shepherd, so they
are intentionally not built here yet — no files, no barrel exports.
