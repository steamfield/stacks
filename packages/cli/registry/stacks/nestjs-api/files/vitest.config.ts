import { defineConfig } from 'vitest/config';

// Vite's transformer reads experimentalDecorators and emitDecoratorMetadata from
// tsconfig.json, so Nest's dependency injection works in tests without a plugin.
export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 30_000,
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.spec.ts', 'tests/hooks/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: { name: 'e2e', include: ['tests/e2e/**/*.e2e-spec.ts'] },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // main.ts is the process entry; verify's serve step runs it.
      exclude: ['src/**/*.spec.ts', 'src/main.ts'],
      thresholds: { statements: 90, lines: 90, branches: 80, functions: 80 },
    },
  },
});
