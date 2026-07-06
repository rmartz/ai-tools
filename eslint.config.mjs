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
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    // Tests — longer ceiling, no boundary constraints.
    files: ['packages/*/test/**/*.ts', '**/*.test.ts'],
    languageOptions: { parser: tsparser, parserOptions: tsParserOptions },
    plugins: { '@typescript-eslint': tseslint },
    rules: { 'max-lines': ['error', { max: 720 }] },
  },
  {
    // Repo-level scripts (the CI gates themselves) — basic rules, no boundaries.
    files: ['scripts/**/*.ts'],
    languageOptions: { parser: tsparser, parserOptions: tsParserOptions },
    plugins: { '@typescript-eslint': tseslint },
    rules: {
      'max-lines': ['error', { max: 480 }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
];
