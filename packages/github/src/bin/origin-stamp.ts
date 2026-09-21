#!/usr/bin/env node
// Thin CLI wrapper over `stampOriginRepo`, invoked as a Claude Code `PostToolUse`
// hook matched on `mcp__github__create_pull_request` and `mcp__github__issue_write`.
// It reads the hook payload as JSON on stdin and resolves the origin repo from
// `CLAUDE_PROJECT_DIR` (available in hook execution); all logic stays in the library.
//
// It writes only a one-line status to STDERR (never stdout — a hook's stdout can be
// surfaced to the agent) and always exits 0: stamping must never block artifact creation.
import { stampOriginRepo, type StampOutcome } from '../origin-stamp.js';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

function summarize(outcome: StampOutcome): string {
  if (outcome.status === 'stamped') {
    const scope = outcome.crossRepo
      ? `CROSS-REPO ${outcome.originRepo} -> ${outcome.targetRepo}`
      : outcome.originRepo;
    return `stamped ${outcome.kind} ${outcome.targetRepo}#${outcome.number} (origin ${scope})`;
  }
  return `${outcome.status}: ${outcome.reason}`;
}

async function main(): Promise<void> {
  const outcome = await stampOriginRepo(await readStdin());
  console.error(`[ai-origin-stamp] ${summarize(outcome)}`);
}

main().catch((err: unknown) => {
  console.error(`[ai-origin-stamp] error: ${err instanceof Error ? err.message : String(err)}`);
  // Soft-fail: a stamping hook must never block PR/issue creation.
  process.exit(0);
});
