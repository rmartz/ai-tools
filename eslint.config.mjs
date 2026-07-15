// @ts-check
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import boundaries from 'eslint-plugin-boundaries';
import importPlugin from 'eslint-plugin-import';

/**
 * Layer model (lower numbers are more foundational; a layer may only import
 * from layers below it). This is the structural successor to dotfiles'
 * scripts-vs-libraries convention — enforced by tooling, not prose.
 *
 *   layer-0  foundation   agent-runtime, github        (no internal deps)
 *   layer-1  tooling      worktree, verify, repo-hygiene, bootstrap
 *   layer-2  composed     pr-review, reporting, issues
 *
 * PR Shepherd lives in its own repo and may import any of these as published
 * packages; nothing here imports it. Rules are NOT type-aware (no `project`),
 * so a file does not need to live in a tsconfig to be linted — but cross-package
 * imports are resolved via the TypeScript resolver so `boundaries` and
 * `no-cycle` can follow `@rmartz/*` workspace imports to their source.
 */
const LAYERS = {
  'layer-0': ['packages/agent-runtime', 'packages/github'],
  'layer-1': [
    'packages/worktree',
    'packages/verify',
    'packages/repo-hygiene',
    'packages/bootstrap',
  ],
  'layer-2': ['packages/pr-review', 'packages/reporting', 'packages/issues'],
};

const tsParserOptions = { sourceType: 'module', ecmaVersion: 2023 };
const importResolver = {
  typescript: { alwaysTryTypes: true, project: ['packages/*/tsconfig.json'] },
  node: true,
};

/**
 * Code-style conventions promoted from CLAUDE.md prose to static enforcement, so
 * they hold at every model tier instead of relying on a reviewer's eye. Every
 * rule is core ESLint or an already-installed plugin (`typescript-eslint`,
 * `eslint-plugin-import`) — no new dependency. Applied uniformly to first-party
 * source, scripts, and tests.
 */
const STYLE_RULES = {
  // "Strict TypeScript throughout — no `any`, no `@ts-ignore`." `ban-ts-comment`
  // still permits `@ts-expect-error` with a description (the sanctioned hatch).
  '@typescript-eslint/no-explicit-any': 'error',
  '@typescript-eslint/ban-ts-comment': 'error',
  // Type-only imports: `import type`, side-effect-free (companion pair).
  '@typescript-eslint/consistent-type-imports': 'error',
  '@typescript-eslint/no-import-type-side-effects': 'error',
};

// "Prefer async/await over .then() chains", "No IIFEs", and "Named exports only —
// no default exports". Expressed as core `no-restricted-syntax` selectors (rather
// than `import/no-default-export`, which crashes under ESLint 10 flat config) so
// there is no plugin-compat risk. Config files are globally ignored, so tsup /
// eslint / vitest configs keep their required default export.
const RESTRICTED_SYNTAX = [
  {
    selector: "CallExpression[callee.property.name='then']",
    message: 'Prefer async/await over .then() chains (CLAUDE.md).',
  },
  {
    selector: 'CallExpression[callee.type=/FunctionExpression|ArrowFunctionExpression/]',
    message:
      'No IIFEs — extract a named helper or compute the value with a plain expression (CLAUDE.md).',
  },
  {
    selector: 'ExportDefaultDeclaration',
    message: 'Named exports only — no default exports (CLAUDE.md).',
  },
];

// Tests additionally forbid Vitest's `test()` global — the repo uses describe/it.
const TEST_RESTRICTED_SYNTAX = [
  ...RESTRICTED_SYNTAX,
  {
    selector: "CallExpression[callee.name='test']",
    message: 'Use it() from Vitest, not test() (CLAUDE.md).',
  },
];

export default [
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/.turbo/**', '**/*.config.*'],
  },
  {
    // Package source — full rules, including layer boundaries.
    files: ['packages/*/src/**/*.ts'],
    languageOptions: { parser: tsparser, parserOptions: tsParserOptions },
    plugins: { '@typescript-eslint': tseslint, boundaries, import: importPlugin },
    settings: {
      'boundaries/elements': Object.entries(LAYERS).flatMap(([layer, dirs]) =>
        dirs.map((pattern) => ({ type: layer, pattern: `${pattern}/**` })),
      ),
      'import/resolver': importResolver,
    },
    rules: {
      // File size: the sole file-length cap (there is no separate CI ratchet).
      // Hard ceiling at 2x the 240 split point; counts every line.
      'max-lines': ['error', { max: 480, skipBlankLines: false, skipComments: false }],

      // Layer boundaries: upper layers import lower, never the reverse.
      'boundaries/element-types': [
        'error',
        {
          default: 'disallow',
          rules: [
            { from: 'layer-0', allow: ['layer-0'] },
            { from: 'layer-1', allow: ['layer-0', 'layer-1'] },
            { from: 'layer-2', allow: ['layer-0', 'layer-1', 'layer-2'] },
          ],
        },
      ],

      'import/no-cycle': ['error', { maxDepth: 1 }],
      '@typescript-eslint/no-inferrable-types': 'error',
      ...STYLE_RULES,
      'no-restricted-syntax': ['error', ...RESTRICTED_SYNTAX],
    },
  },
  {
    // Repo-level scripts (the CI gates themselves) — basic rules, no boundaries.
    files: ['scripts/**/*.ts'],
    languageOptions: { parser: tsparser, parserOptions: tsParserOptions },
    plugins: { '@typescript-eslint': tseslint },
    rules: {
      'max-lines': ['error', { max: 480 }],
      ...STYLE_RULES,
      'no-restricted-syntax': ['error', ...RESTRICTED_SYNTAX],
    },
  },
  {
    // Tests — longer ceiling, no boundary constraints.
    // Must come after scripts/**/*.ts so the 720 override wins for script test files.
    files: ['packages/*/test/**/*.ts', '**/*.test.ts'],
    languageOptions: { parser: tsparser, parserOptions: tsParserOptions },
    plugins: { '@typescript-eslint': tseslint },
    rules: {
      'max-lines': ['error', { max: 720 }],
      ...STYLE_RULES,
      'no-restricted-syntax': ['error', ...TEST_RESTRICTED_SYNTAX],
    },
  },
];
