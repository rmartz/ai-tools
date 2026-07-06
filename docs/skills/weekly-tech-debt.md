---
type: Skill
title: weekly-tech-debt
description: The tech-debt audit skill — mine session friction and module structure, diagnose debt, and express filable findings runner-agnostically.
resource: skills/weekly-tech-debt.md
tags: [tech-debt, skill, audit, static-analysis, craft]
---

# `/weekly-tech-debt`

Tech-debt _craft_: the judgment an auditor applies to a codebase, expressed as a
set of diagnosed findings. It combines a **session-friction audit** (what tripped
agents up over the last 7 days) with a **structural static review** (naming,
abstraction, duplication, cohesion, coupling, and overall architecture). It owns
the **detection** — how to find debt and how to judge what is worth filing — not
the coordination around it. Label taxonomy, milestone assignment, ledger
de-duplication, and routing belong to the coordinator, which spawns this skill by
name.

Unlike `/review`, this skill has **no dedicated package or CLI** — direct-run
GitHub writes go through `gh` / GitHub MCP (`mcp__github__*`) generically, and
transcript mining goes through the session-search tool.

## Runner-agnostic emission

The skill reaches a set of findings and stops; how those findings are _recorded_
depends on who ran it:

- **Direct (harness) run** — the skill files the issues itself via
  `mcp__github__issue_write` / `gh issue create`, applying the label that matches
  the project's domain conventions.
- **Coordinator-dispatched run** — the skill's GitHub credentials are scrubbed and
  it **must not file**. It only expresses each finding (location, severity,
  four-part diagnosis, suspected duplicate); the coordinator renders it into an
  issue, labels it, assigns any milestone, and de-duplicates it against the
  tracking ledger.

So the skill describes the **detection + diagnosis** but bakes in **no** label
names, milestone mechanics, or ledger-routing rules.

## Flow

1. **Orient** — resolve the repo root, remote, and `owner/repo` slug; with no
   remote, express findings as a list and stop.
2. **Session friction audit** — search the last 7 days of transcripts for
   code-level friction (naming, navigation, re-reads, workarounds, duplication,
   oversized files, dependency cycles); multi-session hits carry the highest
   severity.
3. **Static analysis** — naming, abstraction (thin wrappers, data-model leak),
   then the targeted structural passes: public-API coherence (3c),
   cross-module duplication (3d), cohesion & coupling (3e), overloaded-module
   detection (3f), legacy patterns, and structural clarity — bounded to a
   ~5–10 module target set by import frequency or churn.
4. **Architecture assessment** — dominant pattern, scope drift, cross-cutting
   concerns, framework mismatch, oversized API surfaces, thin layers, and
   cross-layer data-model leakage.
5. **Diagnose, cluster, set severity** — collapse related symptoms into one
   finding, rank High/Medium/Low, file High/Medium (Low only below threshold),
   and note findings already covered by open issues.
6. **Emit** — a self-contained four-part diagnosis (Problem / Why it matters /
   Suggested fix / Evidence) per finding; file directly, or (dispatched) hand it
   to the coordinator.
7. **Summarize** — sessions scanned, files reviewed, findings by severity and
   source, already-covered items, and skipped Low items. Filing nothing because
   all debt is tracked is a good outcome.

## See also

- The delegation contract — `docs/pr-shepherd-handoff.md`.
- `/review` — the PR-review craft skill, same runner-agnostic shape.
