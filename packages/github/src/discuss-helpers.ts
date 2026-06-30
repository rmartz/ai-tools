/**
 * Small craft helpers for the Discussions CLIs — the comment-signing footer and
 * the framing body for a new knowledge thread. Kept out of the GraphQL client
 * (`discussions.ts`), which only does transport; these shape human-facing text
 * per the `rmartz/ai` "Discussion etiquette" spec.
 */

/** Who a discussion comment is from: the model, and the project it speaks for. */
export interface CommentSignature {
  model?: string;
  /** The agent's working repo (`owner/repo`) — attribution, since every post
   * shows the token owner as GitHub author. */
  project?: string;
  /** The project's default-branch HEAD sha at post time. Anchors the perspective
   * to how the project looked when it was written, so it can be compared against
   * how the project later evolved. Only rendered when `project` is also present
   * (a commit is meaningless without the repo it belongs to). */
  commit?: string;
}

/**
 * Sign a discussion comment with the `*Posted by <model> (<project> @ <commit>)*`
 * footer. Because every post is authored by the token owner on GitHub, this footer
 * is the only attribution between agents — so it carries the model, the project the
 * agent represents, and that project's mainline commit at post time. Accepts a
 * `{ model, project, commit }` (or a bare model string, back-compat); returns the
 * body unchanged when neither model nor project is given. `commit` renders only
 * alongside `project`. Trailing newlines are trimmed before the footer.
 */
export function signComment(body: string, sig?: CommentSignature | string): string {
  const { model, project, commit } =
    typeof sig === 'string' ? { model: sig, project: undefined, commit: undefined } : (sig ?? {});
  if (!model && !project) return body;
  const where = project ? (commit ? `${project} @ ${commit}` : project) : undefined;
  const who = [model, where ? `(${where})` : undefined].filter(Boolean).join(' ');
  return `${body.replace(/\n+$/, '')}\n\n---\n*Posted by ${who}*`;
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

/** A resolved discussion reference: which repo, which number. */
export interface DiscussionTarget {
  repo: string;
  number: number;
}

/**
 * Resolve a discussion reference from either a bare number (using `defaultRepo`)
 * or a full `github.com/<owner>/<repo>/discussions/<n>` URL (repo + number taken
 * from the URL). Returns `null` for anything else. Letting the CLIs accept a URL
 * means an agent can act on a thread with one self-contained arg — no `--repo`,
 * no `cd` into a repo for auth — which keeps the command stable + allowlistable.
 */
export function parseDiscussionRef(arg: string, defaultRepo: string): DiscussionTarget | null {
  if (/^\d+$/.test(arg)) return { repo: defaultRepo, number: Number(arg) };
  const m = arg.match(/github\.com\/([^/]+\/[^/]+)\/discussions\/(\d+)/);
  return m ? { repo: m[1]!, number: Number(m[2]) } : null;
}
