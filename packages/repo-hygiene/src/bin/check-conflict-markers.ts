#!/usr/bin/env node
// Thin CLI wrapper over `checkConflictMarkers`. All logic lives in the library;
// the bin only selects a mode, prints the report, and sets the exit code.
//
// Modes (default `--staged`): scan staged blobs (pre-commit hook), `--check`
// (all tracked files — the CI backstop), `--check-diff` (files changed vs
// origin/main). Exit 0 when clean, 1 when markers are found, 2 on unknown mode.
import { checkConflictMarkers, formatReport, type Mode } from '../check-conflict-markers.js';

const MODES: Mode[] = ['--staged', '--check', '--check-diff'];

async function main(): Promise<number> {
  const arg = process.argv[2] ?? '--staged';
  if (!MODES.includes(arg as Mode)) {
    console.error(`unknown mode: ${arg}`);
    return 2;
  }
  const violations = await checkConflictMarkers(arg as Mode);
  if (violations.length > 0) {
    console.error(formatReport(violations));
    return 1;
  }
  return 0;
}

async function run(): Promise<void> {
  try {
    process.exit(await main());
  } catch (err: unknown) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }
}

void run();
