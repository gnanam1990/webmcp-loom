import { describe, expect, it } from 'vitest';
import { createTravelTools } from '../apps/travel-showcase/src/tools.js';
import { benchmarkFixture } from './fixtures.js';
import { ITEM_ID_PLACEHOLDER, REVISION_PLACEHOLDER, TASK_ORACLES } from './oracles.js';
import { SMOKE_TASKS } from './smoke-tasks.js';
import { TRAVEL_TASKS } from './travel-tasks.js';
import type { JsonObject, RuntimeTool } from '@webmcp-loom/runtime';
import type { ItineraryItem } from '../apps/travel-showcase/src/types.js';
import type { BenchmarkTask } from './schema.js';
import type { OracleCall } from './oracles.js';
/** Every task the corpus ships, whichever suite it belongs to. */
const BENCHMARK_CORPUS = [...SMOKE_TASKS, ...TRAVEL_TASKS];


interface OracleOutcome {
  calledTools: string[];
  writeCalls: number;
  items: readonly ItineraryItem[];
}

function firstItemIdOfKind(items: readonly ItineraryItem[], kind: ItineraryItem['kind']): string {
  const found = items.find((item) => item.kind === kind);
  if (found === undefined) throw new Error(`Fixture has no staged ${kind} to reference.`);
  return found.id;
}

/** Resolves the placeholders an oracle cannot know until the fixture is live. */
function resolveInput(
  input: JsonObject,
  revision: number,
  items: readonly ItineraryItem[],
): JsonObject {
  const resolved: JsonObject = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === REVISION_PLACEHOLDER) resolved[key] = revision;
    else if (value === ITEM_ID_PLACEHOLDER.activity) resolved[key] = firstItemIdOfKind(items, 'activity');
    else if (value === ITEM_ID_PLACEHOLDER.flight) resolved[key] = firstItemIdOfKind(items, 'flight');
    else if (value === ITEM_ID_PLACEHOLDER.stay) resolved[key] = firstItemIdOfKind(items, 'stay');
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
function runOracle(task: BenchmarkTask, oracle: readonly OracleCall[]): OracleOutcome {
  const fixture = benchmarkFixture(task.fixture);
  const store = fixture.createStore();
  const tools = new Map<string, RuntimeTool>(
    createTravelTools(store).map((tool) => [tool.name, tool]),
  );

  const calledTools: string[] = [];
  let writeCalls = 0;

  for (const call of oracle) {
    const tool = tools.get(call.tool);
    if (tool === undefined) {
      throw new Error(`${task.id} oracle calls a tool that is not registered: ${call.tool}`);
    }
    const state = store.getState();
    const input = resolveInput(call.input, state.revision, state.items);
    calledTools.push(call.tool);
    if (!tool.annotations.readOnlyHint) writeCalls += 1;
    tool.execute(input, {
      signal: undefined,
      expectedStateRevision: typeof input.expectedRevision === 'number'
        ? input.expectedRevision
        : undefined,
    });
  }

  return { calledTools, writeCalls, items: store.getState().items };
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
    const outcome = runOracle(task, oracle);

    it('executes end to end against the real tool surface', () => {
      expect(outcome.calledTools.length).toBeGreaterThan(0);
    });

    it('calls every tool the task requires', () => {
      for (const required of task.expected.toolCalls.requiredToolNames) {
        expect(outcome.calledTools, `${task.id} must call ${required}`).toContain(required);
      }
    });

    it('calls no tool the task forbids', () => {
      for (const forbidden of task.expected.toolCalls.forbiddenToolNames) {
        expect(outcome.calledTools, `${task.id} must not call ${forbidden}`).not.toContain(forbidden);
      }
    });

    it('stays inside the declared call bounds', () => {
      expect(outcome.calledTools.length).toBeGreaterThanOrEqual(task.expected.toolCalls.min);
      expect(outcome.calledTools.length).toBeLessThanOrEqual(task.expected.toolCalls.max);
    });

    it('performs a write exactly when the task expects approval', () => {
      expect(outcome.writeCalls > 0).toBe(task.expected.approval !== 'none');
    });

    it('uses the tools its identifier-reuse assertions name', () => {
      for (const reuse of task.expected.identifierReuses) {
        expect(outcome.calledTools, `${task.id} source`).toContain(reuse.sourceTool);
        expect(outcome.calledTools, `${task.id} consumer`).toContain(reuse.consumerTool);
        expect(
          outcome.calledTools.indexOf(reuse.sourceTool),
          `${task.id} must read ${reuse.sourceTool} before ${reuse.consumerTool}`,
        ).toBeLessThan(outcome.calledTools.lastIndexOf(reuse.consumerTool));
      }
    });
  },
);
