import { describe, it, expect } from 'vitest';

import { classifyCommand, CATEGORY_ORDER } from '../src/command-classifier.js';

describe('classifyCommand', () => {
  // [command, expected category | null, expected tool | undefined]
  const cases: Array<[string, string | null, string?]> = [
    // format — only read-only --check variants
    ['prettier --check .', 'format', 'prettier'],
    ['black --check src', 'format', 'black'],
    ['ruff format --check', 'format', 'ruff'],
    // format write-mode → null (never rewrite files)
    ['prettier --write .', null],
    ['black .', null],
    ['ruff format', null],
    // lint
    ['pylint mypkg', 'lint', 'pylint'],
    ['eslint . --max-warnings 0', 'lint', 'eslint'],
    ['ruff check .', 'lint', 'ruff'],
    // bare ruff with no/unknown subcommand → null
    ['ruff', null],
    ['ruff lint', null],
    // typecheck
    ['tsc --noEmit', 'typecheck', 'tsc'],
    // test
    ['pytest -q', 'test', 'pytest'],
    ['unittest', 'test', 'unittest'],
    // package.json script names (after stripping the package-manager prefix)
    ['pnpm run lint', 'lint', 'lint'],
    ['pnpm run typecheck', 'typecheck', 'typecheck'],
    ['npm run test', 'test', 'test'],
    ['yarn run format:check', 'format', 'format:check'],
    ['pnpm run format-check', 'format', 'format-check'],
    ['pnpm run tsc', 'typecheck', 'tsc'],
    // bare `format` script is excluded (it usually writes)
    ['pnpm run format', null],
    // unknown / fallthrough
    ['echo hello', null],
    ['git status', null],
    ['', null],
    ['   ', null],
    // comment-only / comment-stripped lines
    ['# just a comment', null],
    ['pytest -q # run the suite', 'test', 'pytest'],
    // unbalanced quote → null (shlex ValueError parity)
    ["prettier --check 'unterminated", null],
  ];

  it.each(cases)('classifies %j', (command, category, tool) => {
    const result = classifyCommand(command);
    if (category === null) {
      expect(result).toBeNull();
    } else {
      expect(result).not.toBeNull();
      expect(result!.category).toBe(category);
      expect(result!.tool).toBe(tool);
      expect(result!.command).toBe(command); // original preserved verbatim
    }
  });

  it('strips runner prefixes before classifying the underlying tool', () => {
    // The wrapper is stripped for matching, but Check.command stays verbatim.
    for (const cmd of [
      'pnpm exec prettier --check .',
      'npx prettier --check .',
      'npx --no-install prettier --check .',
      'pnpm dlx prettier --check .',
    ]) {
      const result = classifyCommand(cmd);
      expect(result).toEqual({ category: 'format', command: cmd, tool: 'prettier' });
    }
  });

  it('resolves python -m runner prefixes to the module tool', () => {
    expect(classifyCommand('python3 -m pytest')).toEqual({
      category: 'test',
      command: 'python3 -m pytest',
      tool: 'pytest',
    });
    expect(classifyCommand('python -m black --check .')).toEqual({
      category: 'format',
      command: 'python -m black --check .',
      tool: 'black',
    });
  });
});

describe('CATEGORY_ORDER', () => {
  it('lists the canonical run order', () => {
    expect(CATEGORY_ORDER).toEqual(['format', 'lint', 'typecheck', 'test']);
  });
});
