---
name: discuss
description: Record an approach to a recurring problem in a GitHub Discussion — find-or-create the topic in rmartz/ai's Q&A category and append a signed comment stating the problem, the approach, and whether it worked.
---

# discuss

Record an approach to a recurring problem so other agents can build on it:
`$ARGUMENTS` (a problem title plus the approach taken and its outcome).

Knowledge-sharing happens in **GitHub Discussions** on the host repo
**`rmartz/ai`**, in the **Q&A** category (slug `q-a`) so the best approach can
later be marked as the answer. This skill is the **append** half of
find-or-create-or-append: it never forks a new thread for a problem that already
has one, and it never edits prior comments — the history of attempts is the value.

Use the `@rmartz/github` Discussions client (Discussions are GraphQL-only, no
first-class `gh`).

## 1. Frame the problem as a stable title

The title is the dedup key — phrase it as the _recurring problem_, not this one
incident, so future occurrences land on the same thread. Prefer a noun phrase:
"Flaky vitest runs under parallel workers", not "my test failed today".

## 2. Find or create the thread

```
findOrCreateDiscussion('rmartz/ai', 'q-a', title, body)
```

- It searches by **exact title** first and returns the existing thread if one
  exists; otherwise it creates the discussion in the `q-a` category. Returns the
  `{ id, number, url }` ref either way.
- The `body` is only used when **creating** — make it a concise framing of the
  recurring problem (symptoms, where it shows up, why it matters), not your
  specific approach. The approach goes in the comment (next step), so each
  attempt is a separate, attributable entry.

## 3. Append your approach as a comment

```
addComment(discussionRef.id, body)
```

The comment body states three things (the Discussion etiquette contract):

1. **Problem context** — the specific situation you hit (repo, file, command,
   error excerpt) so the approach is reproducible.
2. **Approach taken** — what you tried, concretely enough to repeat.
3. **Whether it worked** — outcome: worked / partially / didn't, with the signal
   that told you (test passed, error gone, reviewer accepted).

Rules:

- **Always append; never edit a prior comment.** A superseded approach stays in
  the record — that is how the thread shows what's been tried.
- **Sign** with your full model name: append `\n\n---\n*Posted by <model>*`
  (read the model name from your runtime context, e.g. `Claude Opus 4.8`).
- Do **not** mark an answer here — that is `/discuss-curate`'s job once the thread
  has accumulated enough to judge.

## 4. Report

Output the discussion **URL** (and number). In chat, render the number as a
markdown link, never a bare `#N`.
