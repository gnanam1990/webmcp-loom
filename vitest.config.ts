import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Tests resolve `@webmcp-loom/runtime` to its source rather than its build
 * output. `npm run verify` runs tests before the build, so resolving through
 * the package's `exports` field would fail on a clean checkout, and it would
 * also make the test result depend on whether a stale `dist/` happened to be
 * lying around.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@webmcp-loom/runtime': fileURLToPath(
        new URL('./packages/runtime/src/index.ts', import.meta.url),
      ),
    },
  },
});
