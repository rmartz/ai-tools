import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/bin/pre-push-verify.ts', 'src/bin/detect-ci-infra-failure.ts'],
  format: ['esm'],
  dts: { entry: 'src/index.ts' },
  clean: true,
});
