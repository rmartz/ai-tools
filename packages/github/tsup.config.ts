import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/bin/pr-summary.ts', 'src/bin/pr-diff.ts', 'src/bin/repo-status.ts'],
  format: ['esm'],
  dts: { entry: 'src/index.ts' },
  clean: true,
});
