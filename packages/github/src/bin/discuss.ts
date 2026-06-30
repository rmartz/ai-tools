#!/usr/bin/env node
// Thin CLI over the Discussions client: find-or-create a Q&A topic and append a
// signed approach as a comment (the mechanical half of the /discuss skill). All
// logic lives in the library — this only parses args, reads the body, and prints.
import { readFileSync } from 'node:fs';
import { findOrCreateDiscussion, addComment } from '../discussions.js';
import { framingBody, signComment } from '../discuss-helpers.js';
import { resolveSignatureContext, type SignatureFlags } from '../discuss-signature.js';

const DEFAULT_REPO = 'rmartz/ai';
const DEFAULT_CATEGORY = 'q-a';

interface Args extends SignatureFlags {
  title?: string;
  bodyFile?: string;
  repo: string;
  category: string;
}

function parse(argv: string[]): Args {
  const args: Args = { repo: DEFAULT_REPO, category: DEFAULT_CATEGORY };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--repo') args.repo = argv[++i] ?? args.repo;
    else if (a === '--category') args.category = argv[++i] ?? args.category;
    else if (a === '--model') args.model = argv[++i];
    else if (a === '--project') args.project = argv[++i];
    else if (a === '--commit') args.commit = argv[++i];
    else if (a !== undefined) positional.push(a);
  }
  [args.title, args.bodyFile] = positional;
  return args;
}

async function main(): Promise<void> {
  const { title, bodyFile, repo, category, model, project, commit } = parse(process.argv.slice(2));
  if (!title || !bodyFile) {
    console.error(
      'usage: ai-discuss <title> <body-file> [--repo owner/repo] [--category slug] [--model <model>] [--project owner/repo] [--commit <sha>]',
    );
    process.exit(2);
  }
  const approach = readFileSync(bodyFile, 'utf8');
  // Attribution: working repo + its mainline sha, auto-detected unless given.
  const signature = await resolveSignatureContext({ model, project, commit });
  const ref = await findOrCreateDiscussion(repo, category, title, framingBody(title));
  const comment = await addComment(ref.id, signComment(approach, signature));
  console.log(`discussion: ${ref.url}\ncomment: ${comment.url}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
