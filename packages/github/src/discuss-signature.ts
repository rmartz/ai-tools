/**
 * Bridge a discuss CLI's signature flags (`--model` / `--project` / `--commit`)
 * to a {@link CommentSignature}, auto-filling the project (`owner/repo`) and its
 * default-branch HEAD sha when not given explicitly. Kept in the library (not the
 * thin CLI wrappers) so `ai-discuss` and `ai-discussion-comment` — and any future
 * caller — share one resolution path.
 */
import { resolveProjectRef, currentRepo, type GhCallOptions } from './gh-call.js';
import type { CommentSignature } from './discuss-helpers.js';

/** Raw signature flags parsed from a discuss CLI's argv. */
export interface SignatureFlags {
  model?: string;
  project?: string;
  commit?: string;
}

/** A 12-char sha is unambiguous in practice yet readable inside the footer. */
const SHORT_SHA = 12;

/**
 * Resolve a {@link CommentSignature} from CLI flags. The project's default-branch
 * HEAD sha is resolved for the *effective* repo — the `--project` override, or the
 * working repo — so the footer anchors the perspective to that project's mainline
 * at post time, and a later reader can compare it against how the project evolved.
 * An explicit `--commit` is used verbatim; an auto-resolved sha is shortened to 12
 * chars. Soft-fails: if the repo/sha can't be resolved, the footer simply omits
 * what's missing.
 *
 * gh calls are kept to the minimum the flags require: with an explicit `--commit`
 * the branch HEAD is never needed, so we resolve only the project *name* (a single
 * `currentRepo()`) — and skip even that when `--project` is also given. Only when a
 * sha must be discovered do we pay for the two-call {@link resolveProjectRef}.
 */
export async function resolveSignatureContext(
  flags: SignatureFlags,
  opts: GhCallOptions = {},
): Promise<CommentSignature> {
  // An explicit sha means we never need the branch HEAD — resolve just the project
  // name when it wasn't supplied, rather than the full (two-call) project ref.
  if (flags.commit) {
    const project = flags.project ?? (await currentRepo(opts)) ?? undefined;
    return { model: flags.model, project, commit: flags.commit };
  }
  const ref = await resolveProjectRef(flags.project, opts);
  return {
    model: flags.model,
    project: flags.project ?? ref?.repo,
    commit: ref?.sha?.slice(0, SHORT_SHA),
  };
}
