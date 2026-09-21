import { boundedRun } from '@rmartz/agent-runtime';
import { ghCall, parseSlugFromRemoteUrl, type GhCallOptions, type Transport } from './gh-call.js';
import {
  applyStamp,
  parseHookPayload,
  type StampContext,
  type StampOutcome,
} from './origin-stamp-core.js';

export type {
  CreatedArtifactKind,
  StampContext,
  StampOutcome,
  StampRender,
} from './origin-stamp-core.js';
export {
  extractCreatedNumber,
  parseHookPayload,
  renderStamp,
  hasOriginMarker,
  applyStamp,
} from './origin-stamp-core.js';

const GIT_TIMEOUT_MS = 30_000;

export interface OriginStampOptions extends GhCallOptions {
  /** Environment consulted for `CLAUDE_PROJECT_DIR` (defaults to `process.env`). */
  env?: Record<string, string | undefined>;
  /** Explicit project root, overriding `CLAUDE_PROJECT_DIR` (mainly for tests). */
  projectDir?: string;
}

/**
 * Resolve the agent's origin `owner/repo` from the session's project root:
 * `CLAUDE_PROJECT_DIR` (populated inside hook execution, pinned to the session
 * origin) → `git -C <dir> remote get-url origin` → normalized slug. Returns
 * `null` when no project dir is known or the repo has no `origin` remote.
 */
export async function resolveOriginRepo(opts: OriginStampOptions = {}): Promise<string | null> {
  const env = opts.env ?? process.env;
  const dir = opts.projectDir?.trim() || env.CLAUDE_PROJECT_DIR?.trim();
  if (!dir) return null;
  const remote = await boundedRun('git', ['-C', dir, 'remote', 'get-url', 'origin'], {
    timeoutMs: GIT_TIMEOUT_MS,
  });
  return remote.code === 0 ? parseSlugFromRemoteUrl(remote.stdout) : null;
}

/** REST path for an artifact's resource (`pulls/N` for a PR, `issues/N` for an issue). */
function apiPath(ctx: StampContext): string {
  const collection = ctx.kind === 'pr' ? 'pulls' : 'issues';
  return `repos/${ctx.targetRepo}/${collection}/${ctx.number}`;
}

/** Fetch the artifact's current body (empty string is valid), or `null` on failure. */
async function fetchBody(ctx: StampContext, opts: GhCallOptions): Promise<string | null> {
  const viewCmd = ctx.kind === 'pr' ? 'pr' : 'issue';
  const rest: Transport = { argv: ['gh', 'api', apiPath(ctx), '--jq', '.body // ""'] };
  const fb: Transport = {
    argv: [
      'gh',
      viewCmd,
      'view',
      ctx.number,
      '--repo',
      ctx.targetRepo,
      '--json',
      'body',
      '--jq',
      '.body // ""',
    ],
  };
  return ghCall(rest, fb, opts);
}

/** PATCH the artifact's body. Returns whether the edit succeeded. */
async function editBody(ctx: StampContext, newBody: string, opts: GhCallOptions): Promise<boolean> {
  const editCmd = ctx.kind === 'pr' ? 'pr' : 'issue';
  const rest: Transport = {
    argv: ['gh', 'api', '-X', 'PATCH', apiPath(ctx), '--input', '-', '--jq', '.html_url'],
    stdin: JSON.stringify({ body: newBody }),
  };
  const fb: Transport = {
    argv: ['gh', editCmd, 'edit', ctx.number, '--repo', ctx.targetRepo, '--body-file', '-'],
    stdin: newBody,
  };
  return (await ghCall(rest, fb, opts)) !== null;
}

/**
 * End-to-end: parse the hook payload, resolve the origin repo, and stamp the
 * created PR/issue's body (appending the origin footer, prepending a warning on a
 * cross-repo create). Soft-fails to a `skipped`/`error` outcome — it never
 * throws, so a hook can call it and always exit 0.
 */
export async function stampOriginRepo(
  rawPayload: string,
  opts: OriginStampOptions = {},
): Promise<StampOutcome> {
  const ctx = parseHookPayload(rawPayload);
  if (!ctx) return { status: 'skipped', reason: 'not-a-handled-create' };
  const originRepo = await resolveOriginRepo(opts);
  if (!originRepo) return { status: 'skipped', reason: 'no-origin-repo' };
  const body = await fetchBody(ctx, opts);
  if (body === null) return { status: 'error', reason: 'fetch-body-failed' };
  const stamped = applyStamp(body, ctx.kind, originRepo, ctx.targetRepo);
  if (stamped === null) return { status: 'skipped', reason: 'already-stamped' };
  if (!(await editBody(ctx, stamped, opts))) return { status: 'error', reason: 'edit-failed' };
  return {
    status: 'stamped',
    kind: ctx.kind,
    number: ctx.number,
    originRepo,
    targetRepo: ctx.targetRepo,
    crossRepo: originRepo !== ctx.targetRepo,
  };
}
