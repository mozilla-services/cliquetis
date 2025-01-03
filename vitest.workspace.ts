import { defineWorkspace } from 'vitest/config';

const single_thread_files = [
  'test/integration_test.ts',
  'test/http/integration_test.ts'
];

export default defineWorkspace([
  {
    extends: './vite.config.ts',
    test: {
      name: 'parallel',
      exclude: [ ...single_thread_files, 'node_modules/**' ],
      include: ["test/**/*_{test,spec}.?(c|m)[jt]s?(x)"],
      setupFiles: ["test/setup-globals.ts", "test/server.ts"],
    }
  }, {
    extends: './vite.config.ts',
    test: {
      name: 'sequential',
      include: single_thread_files,
      setupFiles: ["test/setup-globals.ts", "test/server.ts"],
      poolOptions: {
        forks: {
          singleFork: true
        }
      }
    }
  }
])
