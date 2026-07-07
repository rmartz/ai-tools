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

/** A comment with the fields needed to evaluate prior approaches and pick an answer. */
export interface DiscussionCommentDetail extends DiscussionComment {
  body: string;
  authorLogin: string | null;
  createdAt: string;
  isAnswer: boolean;
  upvoteCount: number;
}

/** A discussion plus its body and comments (the read side of curation). */
export interface DiscussionDetail extends DiscussionRef {
  title: string;
  body: string;
  comments: DiscussionCommentDetail[];
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

/** Resolve a repo's GraphQL node ID — required to create a discussion. */
export async function getRepositoryId(repo: string): Promise<string> {
  const { owner, name } = splitRepo(repo);
  const query = `query($owner:String!,$name:String!){repository(owner:$owner,name:$name){id}}`;
  const data = (await graphql(query, { owner, name })) as { repository: { id: string } | null };
  if (!data.repository) throw new Error(`repository not found: ${repo}`);
  return data.repository.id;
}

interface RawComment {
  id: string;
  url: string;
  body: string;
  createdAt: string;
  isAnswer: boolean;
  upvoteCount: number;
  author: { login: string } | null;
}

const COMMENT_FIELDS = 'id url body createdAt isAnswer upvoteCount author{login}';

function mapComment(c: RawComment): DiscussionCommentDetail {
  return {
    id: c.id,
    url: c.url,
    body: c.body,
    authorLogin: c.author?.login ?? null,
    createdAt: c.createdAt,
    isAnswer: c.isAnswer,
    upvoteCount: c.upvoteCount,
  };
}

/** List a discussion's comments (by node ID), for evaluating prior approaches. */
export async function listComments(discussionId: string): Promise<DiscussionCommentDetail[]> {
  const query = `query($id:ID!){node(id:$id){... on Discussion{comments(first:100){nodes{${COMMENT_FIELDS}}}}}}`;
  const data = (await graphql(query, { id: discussionId })) as {
    node: { comments: { nodes: RawComment[] } } | null;
  };
  return data.node ? data.node.comments.nodes.map(mapComment) : [];
}

/** Fetch a discussion by number with its body + comments, or null if absent. */
export async function getDiscussion(
  repo: string,
  number: number,
): Promise<DiscussionDetail | null> {
  const { owner, name } = splitRepo(repo);
  const query = `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){discussion(number:$number){id number url title body comments(first:100){nodes{${COMMENT_FIELDS}}}}}}`;
  const data = (await graphql(query, { owner, name, number: String(number) })) as {
    repository: {
      discussion:
        (DiscussionRef & { title: string; body: string; comments: { nodes: RawComment[] } }) | null;
    } | null;
  };
  const d = data.repository?.discussion;
  if (!d) return null;
  return {
    id: d.id,
    number: d.number,
    url: d.url,
    title: d.title,
    body: d.body,
    comments: d.comments.nodes.map(mapComment),
  };
}

/**
 * Find a discussion by exact title, else create it in the category named by
 * `categorySlug`. Returns the ref either way — the find-or-create half of
 * find-or-create-or-append; the caller appends an approach via {@link addComment}.
 */
export async function findOrCreateDiscussion(
  repo: string,
  categorySlug: string,
  title: string,
  body: string,
): Promise<DiscussionRef> {
  const existing = await findDiscussionByTitle(repo, title);
  if (existing) return existing;
  const category = (await listCategories(repo)).find((c) => c.slug === categorySlug);
  if (!category) throw new Error(`discussion category not found: ${categorySlug} in ${repo}`);
  const repositoryId = await getRepositoryId(repo);
  return createDiscussion(repositoryId, category.id, title, body);
}
