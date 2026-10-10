import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    coverage: {
      provider: 'v8',
      include: ['src/lib/**/*.js'],
      reporter: ['text', 'html'],
      thresholds: { lines: 90, functions: 90, branches: 85, statements: 90 },
    },
  },
});
