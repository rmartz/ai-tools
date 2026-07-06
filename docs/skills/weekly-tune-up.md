---
type: Skill
title: weekly-tune-up
description: The weekly tune-up skill — cluster the last 7 days of transcript friction, audit the multi-repo split for drift, and propose improvements each routed to the repo that owns it.
resource: skills/weekly-tune-up.md
tags: [tune-up, skill, friction, routing, drift, craft]
---

# `/weekly-tune-up`

Tune-up _craft_: the judgment applied to a week of transcripts to turn friction
into concrete tooling improvements. It owns the **what** — the friction-detection
method, the **routing judgment** (which repo an artifact belongs in), the
cross-repo drift classification, and the diagnosis of each cluster into a gap
type. It does **not** own the coordination around it: the exact
transcript-extraction command, label vocabulary, PR/issue-body formatting, and
merge are the coordinator's (PR Shepherd), which spawns this skill by name.

The routing _decision_ is craft and stays in the skill; the routing _plumbing_
(labels, body sections, merge) is abstracted out. The hard rule that anchors the
drift audit — **never edit a dotfiles script that has an ai-tools port; route the
fix to ai-tools instead** — is part of the craft, because it is a judgment about
where a change belongs, not a mechanical step.

## Runner-agnostic emission

The skill produces a set of proposals, each tagged with a **destination repo** and
a **gap type**; how they are _recorded_ depends on who ran it:

- **Direct (harness) run** — the skill carries them out itself: gathers friction
  with `ai-extract-friction --days 7` (`@rmartz/reporting`), edits the
  locally-owned artifacts, and files linked issues in each other destination repo
  with `ai-create-issue --repo <owner/repo>` (`@rmartz/github`).
- **Coordinator-dispatched run** — the skill's GitHub credentials are scrubbed and
  it **must not** edit or file. It only expresses the routed proposals; the engine
  renders and records them.

So the skill describes the **detection + routing + diagnosis** but bakes in **no**
coordinator label names, body-section format, or merge semantics. Each proposal is
expressed as `{ change, destination-repo, gap-type, evidence }`.

The split-aware destinations the skill routes to:

| Destination repo    | Owns                                                      |
| ------------------- | --------------------------------------------------------- |
| `rmartz/dotfiles`   | System config, shell config, global CLAUDE.md directives. |
| `rmartz/ai-tools`   | Skills, packages, CLIs.                                   |
| `rmartz/ai`         | Base directives and curated guidance.                     |
| `rmartz/ai-reports` | Reports, ledgers, metrics.                                |
| the project's repo  | Project-specific conventions.                             |

## Flow

1. **Gather friction** — extract the last 7 days of transcripts (runner-provided)
   and distribute events across the categories, including the split-aware ones:
   permission-prompt frequency, published-CLI shadow, symlink/install staleness,
   rate-limit stalls. No events → stop.
2. **Route** — tag every proposal with the destination repo that owns its artifact
   type; split any multi-destination proposal into one artifact per repo.
3. **Read + audit** — read the current directives/skills/scripts; audit the
   directive set for noise (`directive-noise`); run the **cross-repo drift audit**
   (`published-shadow` / `missing-port-update` / `migration-drift`, never editing a
   ported dotfiles script); scan for ad hoc command patterns.
4. **Cluster + diagnose** — group events, classify each cluster's gap
   (`missing-directive`, `weak-directive`, `missing-script`, `missing-skill`,
   `permission-gap`, `directive-noise`, `migration-drift`); discard sub-2-event
   clusters.
5. **Propose, routed home** — draft one artifact per cluster with an evidence
   citation; apply locally-owned artifacts and file linked issues for everything
   destined elsewhere.
6. **Report** — friction analysis, drift classifications, proposals with their
   destination and gap type, and what was applied locally vs. filed elsewhere.

## See also

- `/review` — the sibling craft skill, and the reference for the runner-agnostic
  emission pattern (`docs/skills/review.md`).
- The delegation contract — `docs/pr-shepherd-handoff.md`.
