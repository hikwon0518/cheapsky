import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'scripts/**/*.test.ts',
    ],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // `server-only` is a build-time marker for Next.js; in unit tests we
      // swap it for an empty module so we can import server modules directly.
      'server-only': path.resolve(__dirname, './src/test/server-only-shim.ts'),
    },
  },
});
