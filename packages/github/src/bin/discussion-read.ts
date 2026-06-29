#!/usr/bin/env node
// Thin CLI: print a discussion + its comments as JSON, so a curator (the
// /discuss-curate skill) can evaluate prior approaches without writing TS.
import { getDiscussion } from '../discussions.js';

const DEFAULT_REPO = 'rmartz/ai';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let repo = DEFAULT_REPO;
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--repo') repo = argv[++i] ?? repo;
    else if (a !== undefined) positional.push(a);
  }
  const number = Number(positional[0]);
  if (!positional[0] || Number.isNaN(number)) {
    console.error('usage: ai-discussion-read <number> [--repo owner/repo]');
    process.exit(2);
  }
  const discussion = await getDiscussion(repo, number);
  if (discussion === null) {
    console.error(`discussion #${number} not found in ${repo}`);
    process.exit(1);
  }
  console.log(JSON.stringify(discussion, null, 2));
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
