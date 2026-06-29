#!/usr/bin/env node
// Thin CLI over the Discussions client: find-or-create a Q&A topic and append a
// signed approach as a comment (the mechanical half of the /discuss skill). All
// logic lives in the library — this only parses args, reads the body, and prints.
import { readFileSync } from 'node:fs';
import { findOrCreateDiscussion, addComment } from '../discussions.js';
import { currentRepo } from '../gh-call.js';
import { framingBody, signComment } from '../discuss-helpers.js';

const DEFAULT_REPO = 'rmartz/ai';
const DEFAULT_CATEGORY = 'q-a';

interface Args {
  title?: string;
  bodyFile?: string;
  repo: string;
  category: string;
  model?: string;
  project?: string;
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
    else if (a !== undefined) positional.push(a);
  }
  [args.title, args.bodyFile] = positional;
  return args;
}

async function main(): Promise<void> {
  const { title, bodyFile, repo, category, model, project } = parse(process.argv.slice(2));
  if (!title || !bodyFile) {
    console.error(
      'usage: ai-discuss <title> <body-file> [--repo owner/repo] [--category slug] [--model <model>] [--project owner/repo]',
    );
    process.exit(2);
  }
  const approach = readFileSync(bodyFile, 'utf8');
  // Attribution project: the agent's working repo, auto-detected unless given.
  const fromProject = project ?? (await currentRepo()) ?? undefined;
  const ref = await findOrCreateDiscussion(repo, category, title, framingBody(title));
  const comment = await addComment(ref.id, signComment(approach, { model, project: fromProject }));
  console.log(`discussion: ${ref.url}\ncomment: ${comment.url}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
