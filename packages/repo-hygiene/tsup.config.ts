import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/bin/check-conflict-markers.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
});
