---
type: Library
title: agent-runtime
description: Layer-0 foundation — bounded subprocess execution and (later) headless claude dispatch.
resource: packages/agent-runtime/src/index.ts
tags: [foundation, runtime, subprocess]
---

# @rmartz/agent-runtime

The provider-agnostic foundation both the toolkit and PR Shepherd build on.
Nothing imports above it; it imports nothing internal.

## Current surface

- `boundedRun(command, args, { timeoutMs, cwd, env })` — run a command with a
  hard wall-clock timeout, killing the whole process group on expiry. Returns
  `{ stdout, stderr, code, timedOut }`.

## Planned (migrated from dotfiles)

- `claudeInvoke` / `skillDispatch` — headless `claude` CLI invocation with
  session-id injection and transcript paths.
- `skillMeta` — hidden traceability markers and their counting helpers.
- `logEvents` — generic JSONL event-log reader.
- resume / timeout pointer I/O.
