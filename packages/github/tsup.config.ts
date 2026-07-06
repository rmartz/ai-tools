import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/bin/pr-summary.ts',
    'src/bin/pr-diff.ts',
    'src/bin/repo-status.ts',
    'src/bin/pr-comment.ts',
    'src/bin/create-pr.ts',
    'src/bin/create-issue.ts',
    'src/bin/resolve-thread.ts',
    'src/bin/dismiss-thread.ts',
    'src/bin/discuss.ts',
    'src/bin/start-discussion.ts',
    'src/bin/discussion-read.ts',
    'src/bin/discussion-answer.ts',
    'src/bin/discussion-comment.ts',
  ],
  format: ['esm'],
  dts: { entry: 'src/index.ts' },
  clean: true,
});
