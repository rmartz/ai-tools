import { addIssueComment } from './issue-ops.js';
import type { GhCallOptions } from './gh-call.js';

/**
 * Post a plain PR comment with the agent-model signing footer (and, optionally,
 * a hidden skill-meta traceability marker). Transport is `addIssueComment` —
 * REST-first with the GraphQL `gh issue comment` fallback on rate-limit. TS port
 * of dotfiles' `pr_comment.py` library half; the CLI shim (arg parsing,
 * file-vs-literal body, body-file cleanup) lives in `bin/pr-comment.ts`.
 *
 * The skill-meta marker concept lands with `@rmartz/agent-runtime` skill-meta
 * (#4); until then callers pass a pre-rendered marker via `skillMeta`.
 */

export interface PostPrCommentOptions extends GhCallOptions {
  /** Full agent model name; appended as the `_<model>_` signing footer. */
  model?: string;
  /** Pre-rendered hidden skill-meta marker, appended after the footer. */
  skillMeta?: string;
}

/** Append the agent-model signing footer between the body and any skill-meta marker. */
export function appendSignature(body: string, model: string): string {
  return `${body.replace(/\n+$/, '')}\n\n---\n\n_${model}_\n`;
}

function appendSkillMeta(body: string, marker: string): string {
  return `${body.replace(/\n+$/, '')}\n${marker.trim()}\n`;
}

/**
 * Post `body` as a comment on `pr`, applying the signing footer (when `model` is
 * given) and skill-meta marker (when `skillMeta` is given). Returns the comment
 * URL, or `null` on failure (soft-fail, like `addIssueComment`).
 */
export async function postPrComment(
  repo: string,
  pr: string | number,
  body: string,
  opts: PostPrCommentOptions = {},
): Promise<string | null> {
  let finalBody = body;
  if (opts.model) finalBody = appendSignature(finalBody, opts.model);
  if (opts.skillMeta) finalBody = appendSkillMeta(finalBody, opts.skillMeta);
  return addIssueComment(repo, pr, finalBody, opts);
}
