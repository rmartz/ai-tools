---
type: Skill
title: status
description: Cross-epic status craft — read the repo's issues/milestones/PRs via ai-repo-status, classify each issue (unblocked / in progress / blocked), detect empty & completed epics, and recommend a next action for each.
resource: skills/status.md
tags: [status, issues, epics, github, planning]
---

# `/status`

The `status` skill answers "what should I work on next?" across a repo's epics.
It composes `@rmartz/github`'s `ai-repo-status` (`gatherRepoStatus` — the read
literally built for this skill) for issues, milestones, and open-PR/closing-issue
data, then applies the craft: classify each issue (unblocked / in progress /
blocked), detect **empty** and **completed** epics, recommend an action per
unblocked issue, and present the plan grouped by epic.

It is **read-only** — it reports and recommends, acting only after you confirm.
The coordinator's per-PR routing/gate flags (CI, approval, idle, merge-candidate)
are **not** recomputed here; those belong to PR Shepherd, so a direct run gives
the lighter PR overview `ai-repo-status` + `gh pr list` provide.

## Flow

1. **Gather** — `ai-repo-status`: milestones, issues (+ parsed `deps`), and
   `openPrs` with the same-repo issue numbers each closes.
2. **Classify** — each open issue as unblocked, in progress (has an open PR), or
   blocked (a dep is still open).
3. **Epics** — flag empty (no sub-issues) and completed (only the epic issue open)
   milestones.
4. **Recommend** — Assign-to-Copilot / sub-agent / implement-directly / needs-human
   per unblocked issue.
5. **Present & hand back** — the plan grouped by epic; ask before acting.

## See also

- Library: [`@rmartz/github`](../packages/github.md) (`gatherRepoStatus`).
- Downstream: `/implement-all #N` seeds sub-issues for an empty epic (not yet
  ported — still a dotfiles command during the cutover).
