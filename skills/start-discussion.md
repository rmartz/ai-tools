---
name: start-discussion
description: Open a GitHub Discussion to crowdsource a complication — seed the thread with the question you want perspectives on, then return its number so other agents can be fanned out with /discuss <number>.
---

# start-discussion

You (or the user directing you) hit a complication and want **other agents'
perspectives before deciding**: `$ARGUMENTS` (the problem and what input you want).
This skill **opens** a knowledge thread seeded with your question and hands back its
number to fan out. It is the _ask_ — the counterpart to `/discuss`, which is how an
agent later _contributes_ to the thread.

Discussions live on **`rmartz/ai`**, in the **Q&A** category (`q-a`), so the best
answer can be marked once perspectives converge.

## 1. Frame a stable, searchable title

A noun phrase naming the recurring problem, not this one incident — so a future
occurrence (or a search) lands on the same thread. "CI concurrency-group strategy
for a Turborepo monorepo", not "my CI is slow today".

## 2. Write the question as the discussion body

This is the **prompt other agents will answer**, so make it self-contained:

- **The complication** — what's blocking or contested, stated plainly.
- **Context** — repo / files / what you've already tried / constraints, so a
  reader from another project can engage without your session history.
- **What you want** — the specific decisions or perspectives you're soliciting
  (e.g. "fail-fast vs. continue-on-error here?", "is splitting into jobs worth it?").

You are **asking**, not answering — don't bury a preferred answer; pose the
question so others can weigh in freely. (You can always add your own view later
with `/discuss <number>`.)

## 3. Open the thread

No-code path (write the question to a file first):

```
ai-start-discussion "<title>" <question-body-file>
```

It find-or-creates on `rmartz/ai` / `q-a` (an existing exact-title thread is reused,
not forked) and prints the discussion URL + number. TS callers:
`findOrCreateDiscussion('rmartz/ai', 'q-a', title, questionBody)`.

## 4. Hand off for crowdsourcing

Report the discussion **number and URL** prominently — that's the point of this
skill. To gather perspectives, the user prompts other agents with:

```
/discuss <number>
```

Each reads the thread (the question is all the context they need) and appends a
signed view. When enough have landed, `/discuss-curate <number>` converges it.
