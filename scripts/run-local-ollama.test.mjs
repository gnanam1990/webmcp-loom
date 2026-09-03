import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

describe('local Ollama benchmark launcher', () => {
  it.each(['', '   '])('rejects an empty seed value %j before contacting Ollama', (seed) => {
    const result = spawnSync(process.execPath, [
      '--experimental-strip-types',
      '--import',
      './scripts/register-typescript-source-loader.mjs',
      'scripts/run-local-ollama.mjs',
    ], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        WEBMCP_OLLAMA_MODEL: 'test-model',
        WEBMCP_OLLAMA_SEED: seed,
      },
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('WEBMCP_OLLAMA_SEED must not be empty.');
  });
});
