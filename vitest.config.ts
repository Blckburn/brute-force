import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Один прогон на весь монорепо: pnpm test.
    include: ['{packages,apps,server}/**/*.{test,spec}.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    environment: 'node',
  },
});
