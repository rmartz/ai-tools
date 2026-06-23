---
type: Library
title: agent-runtime
description: Layer-0 foundation — bounded subprocess, headless claude dispatch, skill-meta, resume pointers, log + command classification.
resource: packages/agent-runtime/src/index.ts
tags: [foundation, runtime, subprocess, dispatch, resume]
---

# @rmartz/agent-runtime

The provider-agnostic foundation both the toolkit and PR Shepherd build on.
Nothing imports above it; it imports nothing internal. Library-only (no CLIs):
the harness/PR Shepherd compose these primitives. Everything soft-fails or takes
injectable boundaries (subprocess, clock, storage) so tests are hermetic.

## Subprocess (`bounded-subprocess.ts`)

- `boundedRun(command, args, { timeoutMs, cwd, env, input? })` — run a command
  with a hard wall-clock timeout, killing the whole process group on expiry.
  Optional `input` is written to stdin (for `gh api --input -` bodies). Returns
  `{ stdout, stderr, code, timedOut }`.

## Headless claude (`claude-invoke.ts`, `skill-dispatch.ts`)

- `buildArgv(invocation)` — **pure** argv builder; always terminates options with
  `--` before the prompt. `runInvocation(invocation, { timeoutMs })` — soft-fail
  exec over `boundedRun` (branch on `.ok`). `fromTemplate(opts)` — parse a
  user-configurable `{name}` command template into an invocation.
- `dispatchSkill({ invocation, pr, sessionId, registry, store, confirmationRe?, … })`
  — pin a `--session-id`, overlay the resume/traceability env, and run the
  resume-on-retry handoff. `TranscriptResumeRegistry` is the in-memory per-run
  registry; `injectSessionId` / `claudeTranscriptPath` / `dispatchEnv` are the
  composable pieces. All PR-Shepherd-specific inputs (the `ResumeStore`, the
  `confirmationRe`, the session id) are injected.

## Skill-meta (`skill-meta.ts`)

- `renderSkillMeta(fields)` — render the hidden `<!-- skill-meta: {…} -->`
  traceability marker (deterministic; the caller resolves PR-head/skill-hash).
- `skillMetaPattern(skill?)` / `hasSkillMeta(body, skill?)` /
  `countSkillMeta(bodies, skill?)` — detect/count markers. Wires
  `@rmartz/github` pr-comment's `--skill` flag.

## Resume pointers (`resume-marker.ts` pure + `resume.ts` I/O)

- Pure layer: `formatMarker` / `parseMarker` / `selectActivePointer` /
  `countActiveMarkers` over `ResumeEntry[]` — storage-agnostic; a later
  confirmation (matched by an injected `confirmationRe`) supersedes a pointer.
- I/O layer: the `ResumeStore { read, append }` seam (PR Shepherd plugs in a
  PR-comment store; default `FsResumeStore` is fs-backed at `RESUME_STORE_PATH`)
  plus `recordResumeMarkerOnTimeout` / `recoverResumePointer`.

## Classifiers (`log-events.ts`, `command-classifier.ts`)

- `parseLogEvents(logFile, read?)` / `parseLogEventsText(text)` — JSONL
  event-log reader; soft-fails to `[]`, read boundary injectable.
- `classifyCommand(command)` — classify a CI `run:` segment into a check
  `Category` (`format`/`lint`/`typecheck`/`test`) + tool, or `null`. Strips
  runner prefixes and refuses write-mode formatters.
