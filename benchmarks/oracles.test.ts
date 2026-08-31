import { describe, expect, it } from 'vitest';
import { createTravelTools } from '../apps/travel-showcase/src/tools.js';
import { benchmarkFixture } from './fixtures.js';
import {
  ITEM_ID_PLACEHOLDER,
  REVISION_PLACEHOLDER,
  SEARCH_RESULT_ID_PLACEHOLDER,
  TASK_ORACLES,
} from './oracles.js';
import { SMOKE_TASKS } from './smoke-tasks.js';
import { TRAVEL_TASKS } from './travel-tasks.js';
import type { JsonObject, RuntimeTool } from '@webmcp-loom/runtime';
import type { ItineraryItem } from '../apps/travel-showcase/src/types.js';
import type { BenchmarkTask } from './schema.js';
import type { OracleCall } from './oracles.js';
/** Every task the corpus ships, whichever suite it belongs to. */
const BENCHMARK_CORPUS = [...SMOKE_TASKS, ...TRAVEL_TASKS];


interface OracleOutcome {
  calls: readonly OracleCallRecord[];
  calledTools: string[];
  writeCalls: number;
}

interface OracleCallRecord {
  input: JsonObject;
  output: unknown;
  template: JsonObject;
  tool: string;
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Oracle tool result must be an object.');
  }
  return value as Record<string, unknown>;
}

function stringId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`Oracle result has no ${label} identifier.`);
  return value;
}

function resultRevision(output: unknown): number {
  const revision = record(output).revision;
  if (typeof revision !== 'number' || !Number.isInteger(revision)) {
    throw new Error('Oracle result has no integer revision.');
  }
  return revision;
}

function itemIdFromResult(output: unknown, kind: ItineraryItem['kind']): string {
  const items = record(output).items;
  if (!Array.isArray(items)) throw new Error('Itinerary result has no items array.');
  const item = items.map(record).find((candidate) => candidate.kind === kind);
  if (item === undefined) throw new Error(`Itinerary result has no ${kind} item.`);
  return stringId(item.id, `${kind} item`);
}

function searchIdFromResult(output: unknown, collection: string, last = false): string {
  const candidates = record(output)[collection];
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new Error(`Search result has no ${collection} to reuse.`);
  }
  const candidate = record(last ? candidates.at(-1) : candidates[0]);
  return stringId(candidate.id, collection);
}

/** Resolves every generated value from a previous real tool result. */
function resolveInput(
  input: JsonObject,
  latestOutput: unknown,
  outputsByTool: ReadonlyMap<string, unknown>,
): JsonObject {
  const resolved: JsonObject = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === REVISION_PLACEHOLDER) resolved[key] = resultRevision(latestOutput);
    else if (value === ITEM_ID_PLACEHOLDER.activity) {
      resolved[key] = itemIdFromResult(outputsByTool.get('get_itinerary'), 'activity');
    } else if (value === ITEM_ID_PLACEHOLDER.flight) {
      resolved[key] = itemIdFromResult(outputsByTool.get('get_itinerary'), 'flight');
    } else if (value === ITEM_ID_PLACEHOLDER.stay) {
      resolved[key] = itemIdFromResult(outputsByTool.get('get_itinerary'), 'stay');
    } else if (value === SEARCH_RESULT_ID_PLACEHOLDER.activity) {
      resolved[key] = searchIdFromResult(outputsByTool.get('search_activities'), 'activities');
    } else if (value === SEARCH_RESULT_ID_PLACEHOLDER.flight) {
      resolved[key] = searchIdFromResult(outputsByTool.get('search_flights'), 'flights');
    } else if (value === SEARCH_RESULT_ID_PLACEHOLDER.lastFlight) {
      resolved[key] = searchIdFromResult(outputsByTool.get('search_flights'), 'flights', true);
    } else if (value === SEARCH_RESULT_ID_PLACEHOLDER.stay) {
      resolved[key] = searchIdFromResult(outputsByTool.get('search_stays'), 'stays');
    }
    else resolved[key] = value;
  }
  return resolved;
}

/**
 * Runs a task's oracle against its fixture through the real tool surface.
 *
 * Any throw fails the test rather than being caught: an oracle that cannot
 * execute means the task describes something the domain will not do, which is
 * exactly the defect this suite exists to surface.
 */
async function runOracle(task: BenchmarkTask, oracle: readonly OracleCall[]): Promise<OracleOutcome> {
  const fixture = benchmarkFixture(task.fixture);
  const store = fixture.createStore();
  const tools = new Map<string, RuntimeTool>(
    createTravelTools(store).map((tool) => [tool.name, tool]),
  );

  const calledTools: string[] = [];
  const calls: OracleCallRecord[] = [];
  const outputsByTool = new Map<string, unknown>();
  let latestOutput: unknown = undefined;
  let writeCalls = 0;

  for (const call of oracle) {
    const tool = tools.get(call.tool);
    if (tool === undefined) {
      throw new Error(`${task.id} oracle calls a tool that is not registered: ${call.tool}`);
    }
    const input = resolveInput(call.input, latestOutput, outputsByTool);
    calledTools.push(call.tool);
    if (!tool.annotations.readOnlyHint) writeCalls += 1;
    const output = await tool.execute(input, {
      signal: undefined,
      expectedStateRevision: typeof input.expectedRevision === 'number'
        ? input.expectedRevision
        : undefined,
    });
    calls.push({ input, output, template: call.input, tool: call.tool });
    outputsByTool.set(call.tool, output);
    latestOutput = output;
  }

  return { calls, calledTools, writeCalls };
}

function sourceValues(output: unknown, path: string): readonly (number | string)[] {
  if (path === '$.revision') return [resultRevision(output)];
  const match = /^\$\.(activities|flights|items|stays)\[\*\]\.id$/.exec(path);
  if (match === null) throw new Error(`Unsupported oracle source path: ${path}`);
  const collectionName = match[1];
  if (collectionName === undefined) throw new Error(`Unsupported oracle source path: ${path}`);
  const collection = record(output)[collectionName];
  if (!Array.isArray(collection)) throw new Error(`Oracle result has no ${collectionName} array.`);
  return collection.map((entry) => stringId(record(entry).id, collectionName));
}

function consumerValue(input: JsonObject, path: string): number | string {
  const match = /^\$\.(expectedRevision|itemId|refId)$/.exec(path);
  if (match === null) throw new Error(`Unsupported oracle consumer path: ${path}`);
  const key = match[1];
  if (key === undefined) throw new Error(`Unsupported oracle consumer path: ${path}`);
  const value = input[key];
  if (typeof value !== 'number' && typeof value !== 'string') {
    throw new Error(`Oracle input has no scalar ${key} value.`);
  }
  return value;
}

describe('benchmark fixtures', () => {
  it('materialises every declared fixture id', () => {
    for (const task of BENCHMARK_CORPUS) {
      expect(() => benchmarkFixture(task.fixture), task.id).not.toThrow();
    }
  });

  it('builds seeded state through the domain write path, so it is reachable', () => {
    const store = benchmarkFixture('seeded_tokyo_and_kyoto').createStore();
    const state = store.getState();
    expect(state.items.length).toBeGreaterThan(0);
    expect(store.getBudgetSummary().overBudget).toBe(false);
  });

  it('seeds a Tokyo stay that the swap task can genuinely replace more cheaply', () => {
    const store = benchmarkFixture('seeded_tokyo_and_kyoto').createStore();
    const tokyoStay = store.getState().items.find((item) => (
      item.kind === 'stay' && item.cityId === 'tokyo'
    ));
    expect(tokyoStay).toMatchObject({ priceInr: 32_000 });
  });

  it('starts the empty fixture at revision 1 with the full budget', () => {
    const store = benchmarkFixture('empty_trip').createStore();
    expect(store.getState().revision).toBe(1);
    expect(store.getBudgetSummary().remainingInr).toBe(150_000);
  });

  it('advances the revision when the interrupting fixture edits mid-run', () => {
    const fixture = benchmarkFixture('human_edit_during_run');
    const store = fixture.createStore();
    const before = store.getState().revision;
    expect(fixture.interrupt).toBeDefined();
    fixture.interrupt?.(store);
    expect(store.getState().revision).toBeGreaterThan(before);
  });

  it('makes a plan built before that edit stale', () => {
    const fixture = benchmarkFixture('human_edit_during_run');
    const store = fixture.createStore();
    const plannedAgainst = store.getState().revision;
    fixture.interrupt?.(store);
    expect(() => store.addItem(plannedAgainst, {
      kind: 'activity',
      activityId: 'ac-kyo-tea',
      date: '2026-11-12',
    })).toThrow(/Itinerary changed since this plan was made/);
  });
});

describe('oracle coverage', () => {
  it('provides a reference solution for every task', () => {
    const missing = BENCHMARK_CORPUS.filter((task) => TASK_ORACLES[task.id] === undefined);
    expect(missing.map((task) => task.id)).toEqual([]);
  });

  it('has no oracle for a task that does not exist', () => {
    const taskIds = new Set(BENCHMARK_CORPUS.map((task) => task.id));
    const orphans = Object.keys(TASK_ORACLES).filter((id) => !taskIds.has(id));
    expect(orphans).toEqual([]);
  });
});

describe.each(BENCHMARK_CORPUS.map((task) => [task.id, task] as const))(
  'task %s is achievable',
  (_id, task) => {
    const oracle = TASK_ORACLES[task.id] ?? [];
    it('executes end to end and satisfies its real tool/output contract', async () => {
      const outcome = await runOracle(task, oracle);
      expect(outcome.calledTools.length).toBeGreaterThan(0);
      for (const required of task.expected.toolCalls.requiredToolNames) {
        expect(outcome.calledTools, `${task.id} must call ${required}`).toContain(required);
      }
      for (const forbidden of task.expected.toolCalls.forbiddenToolNames) {
        expect(outcome.calledTools, `${task.id} must not call ${forbidden}`).not.toContain(forbidden);
      }
      expect(outcome.calledTools.length).toBeGreaterThanOrEqual(task.expected.toolCalls.min);
      expect(outcome.calledTools.length).toBeLessThanOrEqual(task.expected.toolCalls.max);
      expect(outcome.writeCalls > 0).toBe(task.expected.approval !== 'none');
      for (const reuse of task.expected.identifierReuses) {
        const exposed = outcome.calls
          .filter((call) => call.tool === reuse.sourceTool)
          .flatMap((call) => sourceValues(call.output, reuse.sourceOutputPath));
        const consumers = outcome.calls
          .filter((call) => call.tool === reuse.consumerTool)
          .map((call) => ({
            actual: consumerValue(call.input, reuse.consumerInputPath),
            template: consumerValue(call.template, reuse.consumerInputPath),
          }));
        expect(exposed, `${task.id} must expose ${reuse.sourceOutputPath}`).not.toEqual([]);
        expect(consumers, `${task.id} must call ${reuse.consumerTool}`).not.toEqual([]);
        expect(
          consumers.some(({ actual, template }) => actual !== template && exposed.includes(actual)),
          `${task.id} must substitute an observed identifier instead of a static value`,
        ).toBe(true);
      }
    });
  },
);
