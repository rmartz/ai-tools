---
name: status
description: Show open PR status and identify the actionable issues across every epic — what's unblocked, what's in progress, what's blocked, and the recommended next action for each.
---

# status

Show open PR status and identify actionable issues across all epics: $ARGUMENTS

---

> **Tooling**: this skill is status _craft_ — the judgment of what work is
> actionable across a repo's epics, and the recommendation for each. It composes
> `@rmartz/github`'s `ai-repo-status` (`gatherRepoStatus`) for the raw issue /
> milestone / PR data. It is **read-only**: it reports and recommends, and only
> acts after you confirm. The **coordinator's per-PR routing view** (the CI /
> approval / idle / merge-candidate flags computed by PR Shepherd) is not part of
> this skill — a direct run presents the lighter PR overview `ai-repo-status` and
> `gh pr list` provide, and defers the full routing triage to the coordinator.

## Step 1 — Gather the repo state

Run `ai-repo-status` (`@rmartz/github`), which returns open issues, milestones,
and open-PR data as one JSON object:

- `milestones` — `{ title, number, openIssues }` per open milestone (epic).
- `issues` — `{ number, title, milestone, labels, assignees, deps }` per open
  issue; `deps` are the issue numbers parsed from "depends on / blocked by /
  requires #N" in the body.
- `openPrs` — `{ number, headRefName, issueNumbers }`, where `issueNumbers` is the
  same-repo issues the PR closes, resolved from GitHub's `closingIssuesReferences`
  (authoritative), then the `[<type>/]issue-<N>-*` branch convention, then
  `Closes/Fixes/Resolves #N` in the body. An issue whose number appears in any
  `openPrs[].issueNumbers` is **in progress** — it already has an open PR.

For a plain PR overview, `gh pr list --json number,title,author,isDraft,labels,mergeable`
is enough; the rich routing/gate triage belongs to the coordinator, so note
merge-relevant PRs at a high level rather than recomputing gate state here.

## Step 2 — Classify each open issue

For each open issue, decide its state:

- **Blocked** — its `deps` include an issue/PR that is still open.
- **In progress** — its number appears in some `openPrs[].issueNumbers` (a PR is
  already implementing it). Skip it as a candidate.
- **Unblocked** — its dependencies are all merged/closed, or it has none.

## Step 3 — Detect empty and completed epics

Scan `milestones` to surface epics that won't appear in the per-issue sections:

- **Empty** — `openIssues == 0`: no sub-issues filed yet, only the epic issue
  exists. Find the epic issue by matching an issue's title to the milestone title
  (case-insensitive, trimmed); record its number (may be absent if the epic issue
  is closed).
- **Completed** — `openIssues == 1` and that one open issue _is_ the epic issue
  (title starts with "Epic:" or matches the milestone title). All sub-issues are
  done — the epic is ready to close.
- **Fully in motion** — `openIssues > 0` but every issue is in progress or
  blocked: work is ongoing, nothing is actionable right now.

## Step 4 — Recommend an action for each unblocked issue

| Action                  | When                                                                                   |
| ----------------------- | -------------------------------------------------------------------------------------- |
| **Assign to Copilot**   | Well-specified, self-contained, clear task list, no ambiguous design or account setup. |
| **Spin up a sub-agent** | Medium complexity; needs codebase exploration, or benefits from parallel work.         |
| **Implement directly**  | Simple, small, or urgent; or needs tight back-and-forth with you.                      |
| **Needs human input**   | Ambiguous design, external credential setup, security-sensitive, or your judgment.     |

## Step 5 — Present the plan

Group by epic/milestone (issues with no milestone go under "Unepiked"):

```
## Epic: <milestone title> (<N> open issues)

### Actionable
- #N **Title** → <recommended action> — <one-line reason>

### Blocked / In progress
- #N **Title** — <blocked on #X / covered by PR #Y>
```

Then, if any were detected in Step 3:

```
## Completed Epics (ready to close)
- **<title>** — epic issue #N → `gh issue close N`

## Un-implemented Epics (no sub-issues yet)
- **<title>** — epic issue #N → `/implement-all #N` to seed sub-issues from the epic body
```

If nothing is actionable anywhere **and** un-implemented epics exist, lead with a
prominent callout that the most actionable next step is to seed sub-issues for an
un-implemented epic, ranked by foundational-ness (earlier milestone number first).

## Step 6 — Hand back to the user

Ask which issues to act on, or whether to proceed with all recommended actions.
Do **not** open PRs or assign issues without explicit confirmation, unless you
have been pre-authorized to act autonomously this session.
