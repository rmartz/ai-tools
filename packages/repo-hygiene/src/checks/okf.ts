import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import matter from 'gray-matter';
import type { Check, CheckConfig, Finding } from '../types.js';
import { trackedFiles } from '../discovery.js';

/**
 * Open Knowledge Format frontmatter conformance for docs pages — ported from
 * ai-tools' `scripts/check-okf-frontmatter.ts` (itself a port of dotfiles'
 * `test_docs_okf_frontmatter.py`). Every docs page except the configured
 * reserved files must carry a valid `type` from the repo's vocabulary plus a
 * `title` and `description`; a non-exempt type must name a `resource` that
 * exists.
 *
 * The `type` vocabulary, the scanned roots, the reserved exemptions, and which
 * types skip the resource check all differ per repo, so they come from
 * `.repo-hygiene.yml` (with defaults matching ai-tools' own docs) rather than
 * being baked in as library constants.
 */

const NAME = 'okf';

const DEFAULT_TYPES = ['Skill', 'Script', 'Library', 'Design'];
const DEFAULT_ROOTS = ['docs'];
const DEFAULT_EXEMPT = ['docs/index.md'];
const DEFAULT_RESOURCE_EXEMPT_TYPES = ['Design'];

interface OkfConfig {
  types: string[];
  roots: string[];
  exempt: string[];
  resourceExemptTypes: string[];
}

function stringList(settings: CheckConfig, key: string, fallback: string[]): string[] {
  const value = settings[key];
  if (value === undefined) return fallback;
  if (Array.isArray(value) && value.every((v) => typeof v === 'string')) return value as string[];
  throw new Error(`${NAME}: "${key}" must be a list of strings`);
}

function resolveConfig(settings: CheckConfig): OkfConfig {
  return {
    types: stringList(settings, 'types', DEFAULT_TYPES),
    roots: stringList(settings, 'roots', DEFAULT_ROOTS),
    exempt: stringList(settings, 'exempt', DEFAULT_EXEMPT),
    resourceExemptTypes: stringList(settings, 'resourceExemptTypes', DEFAULT_RESOURCE_EXEMPT_TYPES),
  };
}

const isUnder = (path: string, root: string): boolean =>
  path === root || path.startsWith(`${root}/`);

/** A docs Markdown page under a scanned root and not on the exempt list. */
function inScope(path: string, cfg: OkfConfig): boolean {
  if (!path.endsWith('.md')) return false;
  if (cfg.exempt.includes(path)) return false;
  return cfg.roots.some((root) => isUnder(path, root));
}

/** Validate one page's frontmatter; returns a finding per problem found. */
export function validateDoc(
  path: string,
  text: string,
  cfg: OkfConfig,
  existsFn: (resource: string) => boolean,
): Finding[] {
  const findings: Finding[] = [];
  const push = (message: string): void => {
    findings.push({ check: NAME, path, message, severity: 'error' });
  };
  const data = matter(text).data as Record<string, unknown>;
  const type = typeof data.type === 'string' ? data.type : undefined;

  if (type === undefined || !cfg.types.includes(type)) {
    push(`type must be one of ${cfg.types.join('|')}`);
  }
  if (!data.title) push('missing title');
  if (!data.description) push('missing description');

  // Run the resource check for every non-exempt type — including an invalid or
  // missing type, matching the ported script (a Design page skips it).
  if (type === undefined || !cfg.resourceExemptTypes.includes(type)) {
    const resource = data.resource;
    if (typeof resource !== 'string' || resource === '') {
      push(`${type ?? 'this'} page needs a resource`);
    } else if (!existsFn(resource)) {
      push(`resource not found: ${resource}`);
    }
  }
  return findings;
}

export const okfCheck: Check = {
  name: NAME,
  description: 'Open Knowledge Format frontmatter conformance for docs pages.',
  async run(ctx) {
    const cfg = resolveConfig(ctx.settings);
    const cwd = ctx.cwd ?? process.cwd();
    // In --staged mode ctx.files.read reads the git index; probe the index for
    // existence too — existsSync reads the worktree and disagrees when a
    // resource is staged-for-deletion but still present on disk.
    const indexPaths = ctx.mode === '--staged' ? new Set(await trackedFiles({ cwd })) : null;
    const resourceExists =
      indexPaths !== null
        ? (r: string) => indexPaths.has(r)
        : (r: string) => existsSync(resolve(cwd, r));
    const findings: Finding[] = [];
    for (const path of ctx.files.paths) {
      if (!inScope(path, cfg)) continue;
      const text = await ctx.files.read(path);
      findings.push(...validateDoc(path, text, cfg, resourceExists));
    }
    return findings;
  },
};
