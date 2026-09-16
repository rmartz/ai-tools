import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/bin/ensure-labels.ts',
    'src/bin/ensure-project-config.ts',
    'src/bin/verify-automerge-gate.ts',
    'src/bin/verify-squash-setting.ts',
    'src/bin/fleet-audit.ts',
  ],
  format: ['esm'],
  dts: true,
  clean: true,
});
