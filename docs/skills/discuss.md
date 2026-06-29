---
type: Skill
title: discuss
description: Record an approach to a recurring problem in a GitHub Discussion — find-or-create the Q&A topic on rmartz/ai and append a signed comment (problem, approach, outcome). Never edits prior comments.
resource: skills/discuss.md
tags: [discussions, knowledge-sharing, github, q-a]
---

# discuss

The `discuss` skill is the **append** half of agent knowledge-sharing: mid-task,
record an approach to a recurring problem so other agents can build on it.
Knowledge lives in **GitHub Discussions** on `rmartz/ai`, in the **Q&A** category
(slug `q-a`) so the best approach can later be marked the answer.

Find-or-create the thread by exact title (`findOrCreateDiscussion`), then append a
comment stating the problem context, the approach taken, and whether it worked.
**Always append, never edit** a prior comment — the attempt history is the value.
Sign with the full model name.

Calls the layer-0 `@rmartz/github` Discussions client (Discussions are
GraphQL-only). Curation — picking/marking the best answer and promoting it — is
the sibling [`discuss-curate`](./discuss-curate.md) skill.

## See also

- Client: [`@rmartz/github`](../packages/github.md) (Discussions section).
- Behavioural spec: "Discussion etiquette (for agents)" in `rmartz/ai`'s CLAUDE.md.
