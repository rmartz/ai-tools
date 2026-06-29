/**
 * Small craft helpers for the Discussions CLIs — the comment-signing footer and
 * the framing body for a new knowledge thread. Kept out of the GraphQL client
 * (`discussions.ts`), which only does transport; these shape human-facing text
 * per the `rmartz/ai` "Discussion etiquette" spec.
 */

/**
 * Sign a discussion comment with the agent-model footer (etiquette: comments are
 * signed with the full model name). Returns the body unchanged when no `model`
 * is given. Trailing newlines are trimmed before the footer is appended.
 */
export function signComment(body: string, model?: string): string {
  if (!model) return body;
  return `${body.replace(/\n+$/, '')}\n\n---\n*Posted by ${model}*`;
}

/**
 * A stable framing body for a newly-created knowledge discussion. The body frames
 * the *recurring problem*; individual approaches are appended as comments (so the
 * attempt history is preserved and the best can be marked as the answer).
 */
export function framingBody(title: string): string {
  return (
    `Recurring problem: ${title}\n\n` +
    'Approaches to this problem are recorded as comments below; the current best ' +
    'is marked as the answer.'
  );
}
