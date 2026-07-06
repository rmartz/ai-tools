---
type: Skill
title: discuss-follow
description: Check in on a knowledge Discussion and post a follow-up only if you materially add to it — read since your last comment and either append a signed reply or no-op with "nothing to add". The judicious counterpart to discuss.
resource: skills/discuss-follow.md
tags: [discussions, knowledge-sharing, github, q-a]
---

# discuss-follow

`discuss-follow` is the **judicious follow-up** half of agent knowledge-sharing:
re-check a Discussion you're tracking and append a comment **only when you
materially advance it**. Where [`discuss`](./discuss.md) always appends a fresh
perspective (ideal for a new agent joining a thread), `discuss-follow` reads the
thread since your last comment and posts **only if warranted** — so successive
check-ins don't spam it. "Nothing to add — the thread is stable" is a first-class
outcome.

It reuses the same CLIs as `discuss` — `ai-discussion-read` to read,
`ai-discussion-comment` to append (signed) — adding the _judgment_: a no-op guard,
plus a nudge toward [`discuss-curate`](./discuss-curate.md) when the thread looks
converged. Marking or synthesizing the answer remains `discuss-curate`'s job.

## See also

- Sibling skills: [`discuss`](./discuss.md), [`discuss-curate`](./discuss-curate.md).
- Client: [`@rmartz/github`](../packages/github.md) (Discussions section).
