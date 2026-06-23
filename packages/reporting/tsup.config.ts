import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/bin/report-to-tracking.ts', 'src/bin/extract-friction.ts'],
  format: ['esm'],
  dts: { entry: 'src/index.ts' },
  clean: true,
});
