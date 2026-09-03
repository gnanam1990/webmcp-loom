import { describe, expect, it } from 'vitest';

import {
  createOllamaRssMemorySampler,
  parseOllamaRssKilobytes,
  parseOllamaVramBytes,
} from './ollama-memory.js';
import type { OllamaMemorySample } from './ollama-memory.js';

describe('Ollama RSS memory sampling', () => {
  it('rejects automatic sampling for a non-local Ollama server', () => {
    expect(() => createOllamaRssMemorySampler({
      baseUrl: 'https://ollama.example.com',
      model: 'test-model',
    })).toThrow('requires a loopback base URL');
    expect(() => createOllamaRssMemorySampler({
      baseUrl: 'file://localhost/tmp/ollama',
      model: 'test-model',
    })).toThrow('requires an HTTP base URL');
  });

  it('sums only Ollama serving processes from ps output', () => {
    const output = [
      '  101 42000 /opt/homebrew/bin/ollama serve',
      '  102 800000 /tmp/ollama_llama_server --model artifact.gguf',
      '  103 90000 /opt/homebrew/bin/ollama ps',
      '  104 70000 rg ollama serve',
      '  105 1000 /opt/homebrew/bin/ollama runner --port 1234',
    ].join('\n');

    expect(parseOllamaRssKilobytes(output)).toBe(843_000);
  });

  it('reads only the selected model VRAM allocation from Ollama inventory', () => {
    expect(parseOllamaVramBytes({ models: [
      { model: 'qwen3:4b', size_vram: 2_895_118_335 },
      { model: 'other:latest', size_vram: 500_000_000 },
    ] }, 'qwen3:4b')).toBe(2_895_118_335);
    expect(() => parseOllamaVramBytes({ models: {} }, 'qwen3:4b'))
      .toThrow('did not contain a models array');
  });

  it('retains the peak sample around the measured operation', async () => {
    const samples = [
      { rssKilobytes: 100, vramBytes: 0 },
      { rssKilobytes: 400, vramBytes: 2_000 },
      { rssKilobytes: 250, vramBytes: 0 },
    ];
    let releaseOperation: (() => void) | undefined;
    const operationReleased = new Promise<void>((resolve) => {
      releaseOperation = resolve;
    });
    const sampler = createOllamaRssMemorySampler({
      baseUrl: 'http://127.0.0.1:11434',
      intervalMs: 1,
      model: 'test-model',
      readMemorySample: async () => {
        const sample = samples.shift() ?? { rssKilobytes: 250, vramBytes: 0 };
        if (samples.length === 0) releaseOperation?.();
        return sample;
      },
    });

    const measured = await sampler.measure(async () => {
      await operationReleased;
      return 'complete';
    });

    expect(measured).toEqual({
      memory: {
        method: 'combined Ollama serve/runner RSS via ps plus /api/ps VRAM allocation',
        peakMemoryBytes: 411_600,
        samplingIntervalMs: 1,
      },
      value: 'complete',
    });
  });

  it('fails a benchmark instead of hanging on an unresponsive sample', async () => {
    const sampler = createOllamaRssMemorySampler({
      baseUrl: 'http://127.0.0.1:11434',
      model: 'test-model',
      readMemorySample: async () => new Promise<OllamaMemorySample>(() => undefined),
      sampleTimeoutMs: 5,
    });

    await expect(sampler.measure(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return 'complete';
    })).rejects.toThrow('Ollama RSS sampling failed');
  });
});
