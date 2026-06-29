---
name: discuss-curate
description: Curate a knowledge Discussion — read the prior approaches, mark the current best as the Q&A answer (or synthesize one), and when the answer is stable, output PR-ready guidance content to promote into rmartz/ai docs/guidance.
---

# discuss-curate

Evaluate the approaches recorded on a knowledge Discussion and converge it on a
current best answer: `$ARGUMENTS` (a discussion title or number on `rmartz/ai`).

This is the **promotion, not accumulation** half of the Discussion lifecycle. A
thread of attempts has value, but a reader needs the _current best_ surfaced —
and once that's stable, it belongs in curated guidance, not buried in a thread.
Use the `@rmartz/github` Discussions client. **No-code path** (when not in a TS
context) — the mechanical steps are CLIs; the _judgment_ between them is yours:

```
ai-discussion-read <number>                       # → JSON of the discussion + comments
ai-discussion-answer <comment-node-id>            # mark the chosen best as the answer
ai-discussion-comment <number> <body-file> --model "<m>"   # post a synthesized answer
```

## 1. Read the thread

- Resolve the discussion: by number → `getDiscussion('rmartz/ai', number)`; by
  title → `findDiscussionByTitle('rmartz/ai', title)` then
  `getDiscussion(...)` (or `listComments(ref.id)`).
- Read each comment's `body`, `authorLogin`, `createdAt`, `isAnswer`, and
  `upvoteCount`. The discussion `body` holds the problem framing.

## 2. Evaluate the approaches against the problem

Judge the recorded approaches on whether they actually solve the framed problem —
not on recency or author. Weigh:

- **Outcome** — did it work, partially, or not (per the comment's own report)?
- **Generality** — does it address the recurring problem, or just one incident?
- **Cost / risk** — simplicity, side effects, maintenance burden.
- **Corroboration** — `upvoteCount` and later comments confirming it.

Pick the **current best** among the existing comments.

## 3. Mark the answer — never edit prior comments

- If an existing comment is the clear best, `markAnswer(comment.id)` on it. Do
  **not** rewrite anyone's comment; the attempt history is preserved.
- If **no** existing comment is adequate (the best is partial, or the real answer
  is a synthesis of several), `addComment(discussion.id, body)` with a synthesized
  best answer — cite the comments it draws from, state the recommended approach
  and when it applies — then `markAnswer` that new comment. Sign it with your model
  and project: `\n\n---\n*Posted by <model> (<owner/repo>)*` (or use
  `ai-discussion-comment <number> <body-file> --model <model>`, which signs and
  auto-detects the project).
- If the thread isn't yet conclusive (approaches still in flux, no clear winner),
  say so and **stop** — don't force an answer. Curation can wait for more attempts.

## 4. When the answer is stable, recommend promotion

A settled answer should graduate from the thread into curated guidance. The
guidance lives in the **`rmartz/ai`** repo under `docs/guidance/`, so the commit
happens **there, not in ai-tools** — this skill produces the content and hands it
off.

Output, as PR-ready material for `rmartz/ai`:

- A proposed path: `docs/guidance/<topic>.md` (kebab-case topic slug).
- The full page content: the problem, the recommended approach, when it applies /
  when not, and a **link back to the source discussion** (so the page stays
  traceable to the thread it distilled).
- A one-line PR title (e.g. `docs(guidance): <topic> — distilled from #<n>`).

State clearly that the commit is for a human/agent to land in `rmartz/ai`; this
skill does not write to that repo.

## 5. Report

Output the discussion **URL**, what you marked as the answer (or that you held
off), and — when applicable — the promotion content. Render any discussion/issue
number as a markdown link, never a bare `#N`.
