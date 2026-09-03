import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { LocalBenchmarkMemoryMeasurement, LocalBenchmarkMemorySampler } from './local-ollama.js';

const execFileAsync = promisify(execFile);
const MAX_TIMER_MILLISECONDS = 2_147_483_647;

export interface OllamaRssMemorySamplerOptions {
  baseUrl: string;
  intervalMs?: number;
  model: string;
  readMemorySample?: (signal: AbortSignal) => Promise<OllamaMemorySample>;
  sampleTimeoutMs?: number;
}

export interface OllamaMemorySample {
  rssKilobytes: number;
  vramBytes: number;
}

/**
 * Samples the combined resident set of Ollama's serving processes for the
 * complete benchmark operation. This observes the serving runtime rather than
 * the Node launcher and retains the highest sample as selection evidence.
 */
export function createOllamaRssMemorySampler(
  options: OllamaRssMemorySamplerOptions,
): LocalBenchmarkMemorySampler {
  const intervalMs = options.intervalMs ?? 100;
  const sampleTimeoutMs = options.sampleTimeoutMs ?? 2_000;
  if (!isValidTimerMilliseconds(intervalMs)) {
    throw new Error('Ollama memory sampling interval must fit the positive Node timer range.');
  }
  if (!isValidTimerMilliseconds(sampleTimeoutMs)) {
    throw new Error('Ollama memory sample timeout must fit the positive Node timer range.');
  }
  if (!options.baseUrl.trim() || !options.model.trim()) {
    throw new Error('Ollama memory sampling needs a base URL and model.');
  }
  assertLoopbackBaseUrl(options.baseUrl);
  const readMemorySample = options.readMemorySample
    ?? ((signal) => readOllamaMemorySample(options.baseUrl, options.model, sampleTimeoutMs, signal));
  return {
    async measure<T>(operation: () => Promise<T>) {
      let active = true;
      const shutdown = new AbortController();
      let peakMemoryBytes = 0;
      let sampleCount = 0;
      let samplingError: unknown;
      const sampling = (async () => {
        while (active) {
          try {
            const sample = await withTimeout(readMemorySample, sampleTimeoutMs);
            validateSample(sample);
            peakMemoryBytes = Math.max(
              peakMemoryBytes,
              (sample.rssKilobytes * 1024) + sample.vramBytes,
            );
            sampleCount += 1;
          } catch (error) {
            samplingError = error;
            active = false;
            break;
          }
          await delay(intervalMs, shutdown.signal);
        }
      })();

      let value: T;
      try {
        value = await operation();
      } finally {
        active = false;
        shutdown.abort();
        await sampling;
      }
      if (samplingError !== undefined) {
        throw new Error('Ollama RSS sampling failed.', { cause: samplingError });
      }
      if (sampleCount === 0 || peakMemoryBytes <= 0) {
        throw new Error('Ollama RSS sampling did not observe a serving process.');
      }
      const memory: LocalBenchmarkMemoryMeasurement = {
        method: 'combined Ollama serve/runner RSS via ps plus /api/ps VRAM allocation',
        peakMemoryBytes,
        samplingIntervalMs: intervalMs,
      };
      return { memory, value };
    },
  };
}

function isValidTimerMilliseconds(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0 && value <= MAX_TIMER_MILLISECONDS;
}

function assertLoopbackBaseUrl(baseUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch (error) {
    throw new Error('Ollama memory sampling base URL is invalid.', { cause: error });
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Ollama memory sampling requires an HTTP base URL.');
  }
  if (!['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)) {
    throw new Error('Automatic Ollama process sampling requires a loopback base URL.');
  }
}

export function parseOllamaVramBytes(payload: unknown, model: string): number {
  if (typeof payload !== 'object' || payload === null || !('models' in payload)
    || !Array.isArray(payload.models)) {
    throw new Error('Ollama process inventory did not contain a models array.');
  }
  return payload.models.reduce((total, candidate) => {
    if (typeof candidate !== 'object' || candidate === null) return total;
    const entry = candidate as { model?: unknown; name?: unknown; size_vram?: unknown };
    if (entry.model !== model && entry.name !== model) return total;
    if (!Number.isSafeInteger(entry.size_vram) || (entry.size_vram as number) < 0) {
      throw new Error('Ollama process inventory contained an invalid VRAM allocation.');
    }
    return total + (entry.size_vram as number);
  }, 0);
}

export function parseOllamaRssKilobytes(output: string): number {
  return output.split('\n').reduce((total, line) => {
    const match = /^\s*\d+\s+(\d+)\s+(\S+)(?:\s+(.*))?$/.exec(line);
    if (match === null) return total;
    const rss = Number(match[1]);
    const executable = match[2]?.split('/').at(-1) ?? '';
    const argumentsText = match[3] ?? '';
    const isOllamaProcess = executable === 'ollama'
      ? /^(?:serve|runner)(?:\s|$)/.test(argumentsText)
      : /^ollama_(?:llama_)?server$/.test(executable);
    return isOllamaProcess && Number.isSafeInteger(rss) ? total + rss : total;
  }, 0);
}

async function readOllamaMemorySample(
  baseUrl: string,
  model: string,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<OllamaMemorySample> {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '').replace(/\/api$/, '');
  const [{ stdout }, processResponse] = await Promise.all([
    execFileAsync('ps', ['-axo', 'pid=,rss=,command='], {
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
      signal,
      timeout: timeoutMs,
    }),
    fetch(`${normalizedBaseUrl}/api/ps`, { signal }),
  ]);
  if (!processResponse.ok) {
    throw new Error(`Ollama process inventory returned HTTP ${processResponse.status}.`);
  }
  return {
    rssKilobytes: parseOllamaRssKilobytes(stdout),
    vramBytes: parseOllamaVramBytes(await processResponse.json(), model),
  };
}

function validateSample(sample: OllamaMemorySample): void {
  if (!Number.isSafeInteger(sample.rssKilobytes) || sample.rssKilobytes < 0
    || !Number.isSafeInteger(sample.vramBytes) || sample.vramBytes < 0) {
    throw new Error('Ollama memory sampler returned an invalid sample.');
  }
  if (!Number.isSafeInteger((sample.rssKilobytes * 1024) + sample.vramBytes)) {
    throw new Error('Ollama memory sample exceeded the safe integer range.');
  }
}

async function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const done = (): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, milliseconds);
    signal.addEventListener('abort', done, { once: true });
  });
}

async function withTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('Ollama memory sample timed out.'));
    }, timeoutMs);
  });
  try {
    return await Promise.race([operation(controller.signal), timeout]);
  } finally {
    controller.abort();
    if (timer !== undefined) clearTimeout(timer);
  }
}
