import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { platform, arch, release } from 'node:os';

import { SMOKE_TASKS } from '../benchmarks/smoke-tasks.ts';
import { TRAVEL_TASKS } from '../benchmarks/travel-tasks.ts';
import { runLocalOllamaBenchmark } from '../benchmarks/local-ollama.ts';

const model = required('WEBMCP_OLLAMA_MODEL');
const attemptsPerTask = integerEnv('WEBMCP_BENCHMARK_ATTEMPTS', 3);
const tasks = selectedTasks(process.env.WEBMCP_BENCHMARK_TASK_IDS);
const hardware = jsonEnv('WEBMCP_BENCHMARK_HARDWARE_JSON');
const memory = jsonEnv('WEBMCP_BENCHMARK_MEMORY_JSON');

const report = await runLocalOllamaBenchmark({
  attemptsPerTask,
  baseUrl: process.env.WEBMCP_OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434',
  ...(hardware === undefined ? {} : { hardware }),
  ...(memory === undefined ? {} : { memory }),
  model,
  modelOptions: {
    maxTokens: integerEnv('WEBMCP_OLLAMA_MAX_TOKENS', 128),
    seed: integerEnv('WEBMCP_OLLAMA_SEED', 42),
    temperature: numberEnv('WEBMCP_OLLAMA_TEMPERATURE', 0),
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

function integerEnv(name, fallback) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer.`);
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
