import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
    fileParallelism: false,
    testTimeout: 10000,
    hookTimeout: 10000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/server.ts',
        'src/worker.ts',
        // Open API document generator is a build-time tool, not runtime code.
        'src/docs/**',
        // Pure type modules carry no executable statements.
        '**/*.types.ts',
        // Repository ports are interface-only contracts; their
        // PostgreSQL implementations (*.repository.pg.ts) stay measured.
        '**/*.repository.ts'
      ],
      // Regression floors at the 2026-10-19 measured baseline
      // (B-16): 80.88 stmts / 63.72 branches / 87.27 funcs / 81.5 lines.
      thresholds: {
        statements: 80,
        branches: 63,
        functions: 87,
        lines: 81
      }
    }
  }
});
