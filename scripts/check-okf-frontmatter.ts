#!/usr/bin/env tsx
/**
 * OKF frontmatter conformance — port of dotfiles'
 * test_docs_okf_frontmatter.py. Every `docs/**` page except the index
 * (docs/README.md) must carry valid Open Knowledge Format frontmatter, and a
 * non-Design page's `resource` must point to a file that exists.
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';

const TYPES = new Set(['Skill', 'Script', 'Library', 'Design']);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.md') ? [p] : [];
  });
}

function main(): void {
  const errors: string[] = [];
  for (const path of walk('docs')) {
    if (path === join('docs', 'README.md')) continue;
    const { data } = matter(readFileSync(path, 'utf8'));

    if (!TYPES.has(data.type)) errors.push(`${path}: type must be one of ${[...TYPES].join('|')}`);
    if (!data.title) errors.push(`${path}: missing title`);
    if (!data.description) errors.push(`${path}: missing description`);
    if (data.type !== 'Design') {
      if (!data.resource) errors.push(`${path}: ${data.type} page needs a resource`);
      else if (!existsSync(data.resource))
        errors.push(`${path}: resource not found: ${data.resource}`);
    }
  }

  if (errors.length > 0) {
    console.error('OKF frontmatter check failed:');
    console.error(errors.map((e) => `  ${e}`).join('\n'));
    process.exit(1);
  }
  console.log('OKF frontmatter: ok');
}

main();
