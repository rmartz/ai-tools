#!/usr/bin/env node
// Thin CLI over the check framework. All logic lives in the library; the bin
// only parses args, loads config, dispatches, prints the report, and sets the
// exit code.
//
//   ai-repo-hygiene [<check>...] [--staged|--check|--check-diff] [--config <path>]
//
// With no check name it runs every registered check (one aggregate status);
// naming one or more runs just those (independent per-check statuses). Mode
// defaults to `--staged`. Exit 0 when clean or warn-only, 1 on any error
// finding, 2 on a usage error or unknown check.
import { createRegistry } from '../registry.js';
import { loadConfig } from '../config.js';
import { runHygiene } from '../runner.js';
import { formatFindings } from '../reporter.js';
import type { Mode } from '../discovery.js';

const MODES: readonly Mode[] = ['--staged', '--check', '--check-diff'];
const USAGE =
  'usage: ai-repo-hygiene [<check>...] [--staged|--check|--check-diff] [--config <path>]';

interface ParsedArgs {
  mode: Mode;
  only: string[];
  configPath?: string;
}

function parseArgs(argv: string[]): ParsedArgs | { error: string } {
  let mode: Mode = '--staged';
  const only: string[] = [];
  let configPath: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if ((MODES as readonly string[]).includes(arg)) {
      mode = arg as Mode;
    } else if (arg === '--config') {
      const next = argv[i + 1];
      if (next === undefined) return { error: 'missing value for --config' };
      configPath = next;
      i++;
    } else if (arg.startsWith('-')) {
      return { error: `unknown option: ${arg}` };
    } else {
      only.push(arg);
    }
  }
  return { mode, only, configPath };
}

async function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2));
  if ('error' in parsed) {
    console.error(parsed.error);
    console.error(USAGE);
    return 2;
  }
  const registry = createRegistry();
  const config = loadConfig({ path: parsed.configPath });
  const result = await runHygiene(registry, {
    mode: parsed.mode,
    only: parsed.only,
    config,
  });
  if (result.findings.length > 0) {
    console.error(formatFindings(result.findings));
  }
  return result.exitCode;
}

async function run(): Promise<void> {
  try {
    process.exit(await main());
  } catch (err: unknown) {
    // Unknown check, malformed config, or an unexpected failure — usage-level.
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }
}

void run();
