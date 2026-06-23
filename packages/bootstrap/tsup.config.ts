import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/bin/ensure-labels.ts', 'src/bin/ensure-project-config.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
});
