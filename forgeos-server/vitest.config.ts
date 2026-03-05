/**
 * Vitest configuration for ForgeOS server test suite.
 *
 * Configures module resolution aliases for middleware stubs that
 * have not yet been implemented. This allows pool/migrate tests
 * to run in isolation without requiring the full middleware stack.
 *
 * @ticket TASK-FOS-01-002 (QA infrastructure)
 */

import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/__tests__/**',
        'src/**/index.ts',
      ],
    },
  },
});
