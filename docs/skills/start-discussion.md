---
type: Skill
title: start-discussion
description: Open a Q&A Discussion on rmartz/ai seeded with a complication you want crowdsourced; returns the discussion number so other agents can be fanned out with /discuss <number>.
resource: skills/start-discussion.md
tags: [discussions, knowledge-sharing, crowdsource, github, q-a]
---

# start-discussion

The `start-discussion` skill is the **ask** side of the Discussion lifecycle —
the counterpart to [`discuss`](./discuss.md) (contribute) and
[`discuss-curate`](./discuss-curate.md) (converge). When an agent (or the user)
hits a complication worth other agents' input, it opens a `rmartz/ai` Q&A thread
**seeded with the question** (the discussion body is the prompt, not the generic
auto-framing), then hands back the discussion **number** so the user can fan out
`/discuss <number>` to other project agents.

Uses `@rmartz/github`'s `findOrCreateDiscussion` (an existing exact-title thread is
reused, not forked); the no-code path is the `ai-start-discussion <title>
<question-body-file>` CLI.

## See also

- Client: [`@rmartz/github`](../packages/github.md) (Discussions section).
- Contribute to a thread: [`discuss`](./discuss.md); converge it:
  [`discuss-curate`](./discuss-curate.md).
