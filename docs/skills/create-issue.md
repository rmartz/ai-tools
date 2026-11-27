---
type: Skill
title: create-issue
description: Issue-authoring craft — dedup before filing, imperative title, goal + acceptance-criteria + context body, domain/milestone labelling, posted via @rmartz/github.
resource: skills/create-issue.md
tags: [issues, github, authoring, dedup]
---

# create-issue

The `create-issue` skill captures the craft of authoring **one good GitHub
issue**: search for a duplicate first, write an imperative title, give the body a
goal + acceptance-criteria checklist + real file-path context, and apply the
repo's domain/status labels and milestone. It does not assign the issue.

Lives in `@rmartz/issues` (layer-2) because issue authoring composes layer-0
`@rmartz/github` primitives — `findOpenIssue` for client-side-exact dedup and
`createIssue` for the REST-first create. A direct harness run prefers the
first-party `mcp__github__issue_write` MCP tool to create the issue (detected by
the desktop app); the `createIssue` library path is the fallback and the one library callers use.

## Runner-agnostic emission

The skill describes the **judgment** only. It does **not** bake in a
coordinator's `<!-- skill-outcome -->` marker or its own posting. In direct-harness mode it creates the issue via
`mcp__github__issue_write` (preferred; detected by the desktop app), falling back
to `@rmartz/github`'s `createIssue` / `ai-create-issue` when MCP is unavailable;
under a coordinator the engine renders and posts the outcome via the library path.

## See also

- Library: [`@rmartz/issues`](../packages/issues.md).
- Sibling judgment skill: [`dependabot-fix-issue`](./dependabot-fix-issue.md).
