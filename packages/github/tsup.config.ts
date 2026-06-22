import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/bin/pr-summary.ts'],
  format: ['esm'],
  dts: { entry: 'src/index.ts' },
  clean: true,
});
