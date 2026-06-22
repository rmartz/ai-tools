import { boundedRun } from '@rmartz/agent-runtime';

export interface PrSummary {
  number: number;
  title: string;
  state: string;
  isDraft: boolean;
  labels: string[];
  mergeable: string | null;
}

/**
 * Fetch a PR's coordination-relevant metadata via `gh`. The reading half of PR
 * mechanics — review *craft*, reusable by any agent or by PR Shepherd. It knows
 * nothing about verdict labels or gate state; that contract lives in PR
 * Shepherd, which composes this with its own recording step.
 */
export async function fetchPrSummary(repo: string, prNumber: number): Promise<PrSummary> {
  const fields = 'number,title,state,isDraft,labels,mergeable';
  const { stdout, stderr, code } = await boundedRun(
    'gh',
    ['pr', 'view', String(prNumber), '--repo', repo, '--json', fields],
    { timeoutMs: 30_000 },
  );
  if (code !== 0) throw new Error(`gh pr view failed: ${stderr.trim()}`);

  const raw = JSON.parse(stdout) as {
    number: number;
    title: string;
    state: string;
    isDraft: boolean;
    labels: { name: string }[];
    mergeable: string | null;
  };
  return { ...raw, labels: raw.labels.map((l) => l.name) };
}
