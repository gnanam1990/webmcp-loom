import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * The showcase bundles the runtime from source for the same reason the tests
 * resolve it that way: the root build runs workspaces in parallel, so depending
 * on a sibling package's `dist/` makes the build order load-bearing. Bundling
 * source keeps this app buildable from a clean checkout.
 *
 * `base` is relative so the built page can be opened from any path, including
 * a plain static file server during the pre-pull-request visual check.
 */
export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@webmcp-loom/runtime': fileURLToPath(
        new URL('../../packages/runtime/src/index.ts', import.meta.url),
      ),
    },
  },
  build: {
    outDir: 'dist-web',
    emptyOutDir: true,
    target: 'es2022',
  },
});
