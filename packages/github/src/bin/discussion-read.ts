#!/usr/bin/env node
// Thin CLI: print a discussion + its comments so an agent has the full context to
// contribute or curate. Accepts a bare number or a discussions URL (which carries
// the repo) — one self-contained, allowlistable command, no `cd` / `gh graphql`.
// Readable text by default; `--json` for the structured form.
import { getDiscussion, type DiscussionDetail } from '../discussions.js';
import { parseDiscussionRef } from '../discuss-helpers.js';

const DEFAULT_REPO = 'rmartz/ai';

function renderText(d: DiscussionDetail): string {
  const lines = [
    `TITLE: ${d.title}`,
    `URL: ${d.url}  (#${d.number})`,
    '',
    '===== BODY =====',
    d.body,
    '',
    `===== COMMENTS (${d.comments.length}) =====`,
  ];
  for (const c of d.comments) {
    const answer = c.isAnswer ? '  ✓ ANSWER' : '';
    lines.push('', `----- @${c.authorLogin ?? '?'} · ${c.createdAt}${answer} -----`, c.body);
  }
  return lines.join('\n');
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let defaultRepo = DEFAULT_REPO;
  let json = false;
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--repo') defaultRepo = argv[++i] ?? defaultRepo;
    else if (a === '--json') json = true;
    else if (a !== undefined) positional.push(a);
  }
  const target = positional[0] ? parseDiscussionRef(positional[0], defaultRepo) : null;
  if (!target) {
    console.error('usage: ai-discussion-read <number|discussion-url> [--repo owner/repo] [--json]');
    process.exit(2);
  }
  const discussion = await getDiscussion(target.repo, target.number);
  if (discussion === null) {
    console.error(`discussion #${target.number} not found in ${target.repo}`);
    process.exit(1);
  }
  console.log(json ? JSON.stringify(discussion, null, 2) : renderText(discussion));
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
