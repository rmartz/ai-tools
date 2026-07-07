---
type: Skill
title: drive-to-merge
description: Human-invoked escape hatch — drive one or more PRs (expanding stacks bottom-up) through review → fix-review → merge concurrently until each merges or blocks, bypassing the coordinator and reading /review's runner-agnostic outcome.
resource: skills/drive-to-merge.md
tags: [drive-to-merge, review, merge, stacked, escape-hatch]
---

# `/drive-to-merge`

`drive-to-merge` is the **human-invoked escape hatch** that drives PRs to merge
**without** the coordinator (PR Shepherd) — for when the coordinator can't drive a
PR itself (e.g. a breaking change to the coordinator that must land first), when a
PR must merge immediately and the coordinator isn't running, or to step through the
loop by hand. It is _not_ owned by PR Shepherd; it is the manual alternative to it.

It **composes the skills** `/review`, `/fix-review`, and `/merge` (by name) and — the
key ai-tools adaptation — reads each `/review`'s **runner-agnostic outcome**
(`approve` / `soft_reject` / `hard_reject` / `no_op` / `error`), not a coordinator's
verdict labels. Reads compose `ai-pr-summary` (`@rmartz/github`) + `gh`. As its own
mini-runner it performs the branch mutations (`gh pr ready`, `update-branch`) the
normal `/review` refuses.

## Behaviour

- **Concurrent** across all named PRs — the next available action is dispatched per
  PR and external waits (CI, Copilot) are batched; merges are **serialized** (each
  merge triggers a safety check for every remaining PR).
- **Stacks expand bottom-up** — a stacked PR's ancestor chain is walked down to the
  default-branch base (or an exempt `epic`/`release` accumulator) and driven from
  the bottom through the selected PR; descendants are never driven.
- **Un-drafts immediately** — a non-`[WIP]` draft leaves draft at Step 2, before the
  first review round (the sanctioned exception to "only `/review` promotes out of
  draft").

## Flow

1. **Validate** — hard-stop on `[WIP]` / `do not merge`; carry `headRefOid`.
2. **Expand stacks** — build the driving set (selected PRs + ancestors) with
   `parent` pointers.
3. **Assign states** — un-draft; `blocked_on_parent` for held children, else
   `awaiting_ci` / `ready_review` from CI.
4. **Scheduler loop** — `ready_review` → `/review` (map its outcome), `ready_fix` →
   `/fix-review` (commit-guard on `headRefOid`), `approved` → `/merge`; 3-iteration
   ceiling; batch-wait on CI/Copilot when idle.
5. **Post-merge** — three-signal branch-update check on remaining PRs, then release
   stacked children onto fresh main.

## See also

- Composed sub-skill: [`review`](./review.md) (its outcome enum is what this reads).
- Libraries: [`@rmartz/github`](../packages/github.md) (`fetchPrSummary`).
