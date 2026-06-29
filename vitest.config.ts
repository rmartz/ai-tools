import { defineConfig } from 'vitest/config';

// One root config; vitest globs `packages/**/*.test.ts` automatically, so the
// "silently-skipped split test file" class of bug that bit dotfiles (#1277)
// cannot occur here — there is no manual discovery list to fall out of sync.
export default defineConfig({
  test: {
    include: ['packages/**/test/**/*.test.ts', 'packages/**/*.test.ts', 'scripts/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      exclude: ['**/bin/**', '**/index.ts'],
    },
  },
});
