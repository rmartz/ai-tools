#!/usr/bin/env node
// Thin CLI: open (or reuse) a Q&A discussion seeded with a QUESTION you want
// crowdsourced — the body file IS your prompt, not the generic auto-framing. Prints
// the discussion number + URL so you can fan it out with `/discuss <number>`. This
// is the *ask* counterpart to ai-discuss (which records an *approach* as a comment).
import { readFileSync } from 'node:fs';
import { findOrCreateDiscussion } from '../discussions.js';

const DEFAULT_REPO = 'rmartz/ai';
const DEFAULT_CATEGORY = 'q-a';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let repo = DEFAULT_REPO;
  let category = DEFAULT_CATEGORY;
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--repo') repo = argv[++i] ?? repo;
    else if (a === '--category') category = argv[++i] ?? category;
    else if (a !== undefined) positional.push(a);
  }
  const [title, bodyFile] = positional;
  if (!title || !bodyFile) {
    console.error(
      'usage: ai-start-discussion <title> <question-body-file> [--repo owner/repo] [--category slug]',
    );
    process.exit(2);
  }
  // find-or-create: if a thread with this exact title already exists, reuse it
  // (its body is left intact) so the same question isn't forked.
  const ref = await findOrCreateDiscussion(repo, category, title, readFileSync(bodyFile, 'utf8'));
  console.log(`✓ Discussion ready: ${ref.url}  (#${ref.number})\n`);
  console.log(`Fan out to other agents:  /discuss ${ref.number}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
