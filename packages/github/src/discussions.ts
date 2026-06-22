import { boundedRun } from '@rmartz/agent-runtime';

/**
 * GitHub Discussions client — the single place GraphQL/node-ID/category-ID
 * plumbing lives. Discussions have no REST API and no first-class `gh` command,
 * so everything goes through `gh api graphql`. Consumers (PR Shepherd, the
 * harness, knowledge-sharing automation) call this surface and never see a raw
 * query. Target repo is `owner/name` (e.g. `rmartz/ai`).
 */

export interface DiscussionCategory {
  id: string;
  name: string;
  slug: string;
}

export interface DiscussionRef {
  id: string;
  number: number;
  url: string;
}

export interface DiscussionComment {
  id: string;
  url: string;
}

async function graphql(query: string, vars: Record<string, string>): Promise<unknown> {
  const args = ['api', 'graphql', '-f', `query=${query}`];
  for (const [key, value] of Object.entries(vars)) args.push('-F', `${key}=${value}`);
  const { stdout, stderr, code } = await boundedRun('gh', args, { timeoutMs: 30_000 });
  if (code !== 0) throw new Error(`gh api graphql failed: ${stderr.trim()}`);
  return (JSON.parse(stdout) as { data: unknown }).data;
}

function splitRepo(repo: string): { owner: string; name: string } {
  const [owner, name] = repo.split('/');
  if (!owner || !name) throw new Error(`expected owner/name, got: ${repo}`);
  return { owner, name };
}

/** List the discussion categories for a repo (needed to create a discussion). */
export async function listCategories(repo: string): Promise<DiscussionCategory[]> {
  const { owner, name } = splitRepo(repo);
  const query = `query($owner:String!,$name:String!){repository(owner:$owner,name:$name){discussionCategories(first:25){nodes{id name slug}}}}`;
  const data = (await graphql(query, { owner, name })) as {
    repository: { discussionCategories: { nodes: DiscussionCategory[] } };
  };
  return data.repository.discussionCategories.nodes;
}

/**
 * Find a discussion by exact title (the find half of find-or-create-or-append).
 * Returns null when none matches.
 */
export async function findDiscussionByTitle(
  repo: string,
  title: string,
): Promise<DiscussionRef | null> {
  const query = `query($q:String!){search(query:$q,type:DISCUSSION,first:10){nodes{... on Discussion{id number url title}}}}`;
  const data = (await graphql(query, { q: `repo:${repo} in:title ${JSON.stringify(title)}` })) as {
    search: { nodes: (DiscussionRef & { title: string })[] };
  };
  const match = data.search.nodes.find((n) => n.title === title);
  return match ? { id: match.id, number: match.number, url: match.url } : null;
}

/** Create a discussion. `repositoryId` + `categoryId` come from the repo/categories. */
export async function createDiscussion(
  repositoryId: string,
  categoryId: string,
  title: string,
  body: string,
): Promise<DiscussionRef> {
  const query = `mutation($repo:ID!,$cat:ID!,$title:String!,$body:String!){createDiscussion(input:{repositoryId:$repo,categoryId:$cat,title:$title,body:$body}){discussion{id number url}}}`;
  const data = (await graphql(query, { repo: repositoryId, cat: categoryId, title, body })) as {
    createDiscussion: { discussion: DiscussionRef };
  };
  return data.createDiscussion.discussion;
}

/** Append a comment to a discussion (the append half). */
export async function addComment(discussionId: string, body: string): Promise<DiscussionComment> {
  const query = `mutation($id:ID!,$body:String!){addDiscussionComment(input:{discussionId:$id,body:$body}){comment{id url}}}`;
  const data = (await graphql(query, { id: discussionId, body })) as {
    addDiscussionComment: { comment: DiscussionComment };
  };
  return data.addDiscussionComment.comment;
}

/** Mark a comment as the accepted answer (Q&A "current best solution"). */
export async function markAnswer(commentId: string): Promise<void> {
  const query = `mutation($id:ID!){markDiscussionCommentAsAnswer(input:{id:$id}){clientMutationId}}`;
  await graphql(query, { id: commentId });
}
