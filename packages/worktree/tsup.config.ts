import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/bin/new-worktree.ts', 'src/bin/git-cleanup.ts'],
  format: ['esm'],
  dts: { entry: 'src/index.ts' },
  clean: true,
});
