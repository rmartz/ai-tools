import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/bin/report-to-tracking.ts',
    'src/bin/extract-friction.ts',
    'src/bin/report-anomaly.ts',
    'src/bin/efficiency-audit.ts',
  ],
  format: ['esm'],
  dts: { entry: 'src/index.ts' },
  clean: true,
});
