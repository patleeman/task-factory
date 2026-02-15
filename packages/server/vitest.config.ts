import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.d.ts',
        'src/**/__tests__/**',
        'tests/**',
        'dist/**',
      ],
      thresholds: {
        statements: 35,
        branches: 30,
        functions: 40,
        lines: 35,
      },
    },
  },
});
