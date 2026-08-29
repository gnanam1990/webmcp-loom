import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

interface RuntimeSourceConfig {
  readonly compilerOptions?: {
    readonly paths?: Record<string, readonly string[]>;
  };
}

const runtimeSourceConfig = JSON.parse(readFileSync(
  new URL('./tsconfig.runtime-source.json', import.meta.url),
  'utf8',
)) as RuntimeSourceConfig;
const runtimeAliases = Object.entries(runtimeSourceConfig.compilerOptions?.paths ?? {});
if (runtimeAliases.length !== 1) {
  throw new Error('Expected exactly one runtime source alias.');
}
const runtimeAlias = runtimeAliases[0];
if (runtimeAlias === undefined || runtimeAlias[1].length !== 1 || runtimeAlias[1][0] === undefined) {
  throw new Error('Expected the runtime source alias to have exactly one target.');
}
const [runtimePackageName, [runtimeSourcePath]] = runtimeAlias;

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
      [runtimePackageName]: fileURLToPath(new URL(runtimeSourcePath, import.meta.url)),
    },
  },
  build: {
    outDir: 'dist-web',
    emptyOutDir: true,
    target: 'es2022',
  },
});
