import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
    // UI tests opt in per file with: // @vitest-environment happy-dom
  },
});
