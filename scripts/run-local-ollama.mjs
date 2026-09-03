import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { platform, arch, release } from 'node:os';

import { SMOKE_TASKS } from '../benchmarks/smoke-tasks.ts';
import { TRAVEL_TASKS } from '../benchmarks/travel-tasks.ts';
import { runLocalOllamaBenchmark } from '../benchmarks/local-ollama.ts';
import { createOllamaRssMemorySampler } from '../benchmarks/ollama-memory.ts';
import {
  createTravelToolSelector,
  TRAVEL_RETRIEVAL_PROFILE,
} from '../apps/travel-showcase/src/retrieval.ts';
import { checkedOutSourceRevision } from './source-revision.mjs';

const model = required('WEBMCP_OLLAMA_MODEL');
const baseUrl = process.env.WEBMCP_OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434';
const attemptsPerTask = integerEnv('WEBMCP_BENCHMARK_ATTEMPTS', 3);
const tasks = selectedTasks(process.env.WEBMCP_BENCHMARK_TASK_IDS);
const hardware = jsonEnv('WEBMCP_BENCHMARK_HARDWARE_JSON');
const memory = jsonEnv('WEBMCP_BENCHMARK_MEMORY_JSON');
const memorySampler = hardware === undefined || memory !== undefined
  ? undefined
  : createOllamaRssMemorySampler({
      baseUrl,
      intervalMs: integerEnv('WEBMCP_BENCHMARK_MEMORY_INTERVAL_MS', 100),
      model,
    });
const sourceRevision = checkedOutSourceRevision();

const report = await runLocalOllamaBenchmark({
  attemptsPerTask,
  baseUrl,
  ...(hardware === undefined ? {} : { hardware }),
  ...(memory === undefined ? {} : { memory }),
  ...(memorySampler === undefined ? {} : { memorySampler }),
  model,
  modelOptions: {
    maxTokens: integerEnv('WEBMCP_OLLAMA_MAX_TOKENS', 128),
    seed: integerEnv('WEBMCP_OLLAMA_SEED', 42, 0),
    temperature: numberEnv('WEBMCP_OLLAMA_TEMPERATURE', 0),
  },
  retrieval: {
    profile: { ...TRAVEL_RETRIEVAL_PROFILE, sourceRevision },
    toolSelector: createTravelToolSelector(),
  },
  tasks,
});

const output = JSON.stringify({
  environment: { architecture: arch(), operatingSystem: `${platform()} ${release()}` },
  ...report,
}, null, 2);
const outputPath = process.env.WEBMCP_BENCHMARK_OUTPUT;
if (outputPath === undefined || !outputPath.trim()) {
  process.stdout.write(`${output}\n`);
} else {
  const target = resolve(outputPath);
  await writeFile(target, `${output}\n`, { encoding: 'utf8', flag: 'wx' });
  process.stdout.write(`Wrote local benchmark report to ${target}\n`);
}

function selectedTasks(value) {
  const corpus = [...SMOKE_TASKS, ...TRAVEL_TASKS];
  if (value === undefined || !value.trim()) return corpus;
  const wanted = new Set(value.split(',').map((id) => id.trim()).filter(Boolean));
  const selected = corpus.filter(({ id }) => wanted.has(id));
  if (selected.length !== wanted.size) {
    const missing = [...wanted].filter((id) => !selected.some((task) => task.id === id));
    throw new Error(`Unknown benchmark task ids: ${missing.join(', ')}`);
  }
  return selected;
}

function required(name) {
  const value = process.env[name];
  if (value === undefined || !value.trim()) throw new Error(`${name} is required.`);
  return value;
}

function integerEnv(name, fallback, minimum = 1) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  if (!value.trim()) throw new Error(`${name} must not be empty.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    const range = minimum === 0 ? 'a non-negative safe integer' : 'a positive safe integer';
    throw new Error(`${name} must be ${range}.`);
  }
  return parsed;
}

function numberEnv(name, fallback) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be a finite number.`);
  return parsed;
}

function jsonEnv(name) {
  const value = process.env[name];
  if (value === undefined || !value.trim()) return undefined;
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('value is not an object');
    }
    return parsed;
  } catch (error) {
    throw new Error(
      `${name} must contain one JSON object: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}
