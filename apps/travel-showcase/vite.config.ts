import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

interface WorkspaceSourceConfig {
  readonly compilerOptions?: {
    readonly paths?: Record<string, readonly string[]>;
  };
}

const workspaceSourceConfig = JSON.parse(readFileSync(
  new URL('./tsconfig.runtime-source.json', import.meta.url),
  'utf8',
)) as WorkspaceSourceConfig;
const workspaceSourceAliases = Object.fromEntries(
  Object.entries(workspaceSourceConfig.compilerOptions?.paths ?? {}).map(([packageName, targets]) => {
    if (targets.length !== 1 || targets[0] === undefined) {
      throw new Error(`Expected ${packageName} source alias to have exactly one target.`);
    }
    return [packageName, fileURLToPath(new URL(targets[0], import.meta.url))];
  }),
);
if (Object.keys(workspaceSourceAliases).length === 0) {
  throw new Error('Expected at least one workspace source alias.');
}

/**
 * The showcase bundles workspace packages from source for the same reason the
 * tests resolve the runtime that way: the root build runs workspaces in
 * parallel, so depending on a sibling package's `dist/` makes build order
 * load-bearing and can silently bundle stale output.
 *
 * `base` is relative so the built page can be opened from any path, including
 * a plain static file server during the pre-pull-request visual check.
 */
export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: workspaceSourceAliases,
  },
  build: {
    outDir: 'dist-web',
    emptyOutDir: true,
    target: 'es2022',
  },
});
