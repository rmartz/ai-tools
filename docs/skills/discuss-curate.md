---
type: Skill
title: discuss-curate
description: Curate a knowledge Discussion on rmartz/ai — evaluate prior approaches, mark the current best as the Q&A answer (or synthesize one), and when stable, output PR-ready guidance to promote into docs/guidance.
resource: skills/discuss-curate.md
tags: [discussions, knowledge-sharing, curation, github, q-a]
---

# discuss-curate

The `discuss-curate` skill is the **promotion, not accumulation** half of the
Discussion lifecycle. It reads a knowledge thread on `rmartz/ai`
(`getDiscussion` / `listComments`), evaluates the recorded approaches against the
framed problem, and marks the current best comment as the Q&A answer
(`markAnswer`) — or synthesizes and marks a new signed best-answer when none is
adequate. **Never edits prior comments**; the attempt history is preserved.

When the answer is stable, it outputs **PR-ready content** for a
`rmartz/ai` `docs/guidance/<topic>.md` page (with a link back to the source
discussion) so the knowledge graduates from the thread into curated guidance. The
guidance commit lands in `rmartz/ai`, not ai-tools — this skill produces the
material and hands it off.

Calls the layer-0 `@rmartz/github` Discussions client. The append half is the
sibling [`discuss`](./discuss.md) skill.

## See also

- Client: [`@rmartz/github`](../packages/github.md) (Discussions section).
- Behavioural spec: "Discussion etiquette (for agents)" in `rmartz/ai`'s CLAUDE.md.
