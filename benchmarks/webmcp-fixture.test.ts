import { describe, expect, it, vi } from 'vitest';

import {
  createWebMcpToolProvider,
  registerRuntimeTools,
  runAgentRuntime,
} from '../packages/runtime/src/index.js';
import type {
  RegisteredWebMcpTool,
  RuntimeModel,
  RuntimeTool,
  WebMcpModelContext,
  WebMcpToolDefinition,
} from '../packages/runtime/src/index.js';

const ORIGIN = 'https://travel.fixture.test';

function createWebMcpTravelFixture(): {
  context: WebMcpModelContext;
  getRevision(): number;
  stageFlight(expectedRevision: unknown, flightId: unknown): { revision: number; staged: { id: string; flightId: string } };
} {
  let revision = 1;
  const stagedFlightIds: string[] = [];
  const registered = new Map<string, WebMcpToolDefinition>();
  const context: WebMcpModelContext = {
    registerTool: async (tool) => {
      registered.set(tool.name, tool);
    },
    getTools: async () => [...registered.values()].map((tool): RegisteredWebMcpTool => ({
      name: tool.name,
      description: tool.description,
      ...(tool.title === undefined ? {} : { title: tool.title }),
      ...(tool.inputSchema === undefined ? {} : { inputSchema: tool.inputSchema }),
      ...(tool.annotations === undefined ? {} : { annotations: tool.annotations }),
      origin: ORIGIN,
    })),
    executeTool: async (tool, input, options) => {
      const definition = registered.get(tool.name);
      if (definition === undefined) throw new Error(`Unknown fixture tool: ${tool.name}`);
      return JSON.stringify(await definition.execute(input ?? {}, { signal: options?.signal }));
    },
  };
  return {
    context,
    getRevision: () => revision,
    stageFlight: (expectedRevision, flightId) => {
      if (expectedRevision !== revision) throw new Error('stale revision');
      if (flightId !== 'fl-day') throw new Error('unknown flight');
      stagedFlightIds.push('fl-day');
      revision += 1;
      return { revision, staged: { id: `it-${stagedFlightIds.length}`, flightId: 'fl-day' } };
    },
  };
}

function travelTools(fixture: ReturnType<typeof createWebMcpTravelFixture>): RuntimeTool[] {
  return [
    {
      name: 'get_trip_constraints', title: 'Get trip constraints',
      description: 'Read current trip constraints.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      execute: () => ({ revision: fixture.getRevision(), constraints: { originCode: 'BLR', avoidRedEyeFlights: true } }),
    },
    {
      name: 'search_flights', title: 'Search flights',
      description: 'Read non-red-eye flights.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      execute: () => ({ revision: fixture.getRevision(), flights: [{ id: 'fl-day', redEye: false, departureDate: '2026-11-02' }] }),
    },
    {
      name: 'add_itinerary_item', title: 'Stage itinerary item',
      description: 'Stage a flight using a returned revision and flight id.',
      inputSchema: {
        type: 'object',
        properties: {
          expectedRevision: { type: 'integer' },
          kind: { type: 'string', enum: ['flight'] },
          refId: { type: 'string' },
          date: { type: 'string' },
        },
        required: ['expectedRevision', 'kind', 'refId', 'date'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false },
      execute: (input) => fixture.stageFlight(input.expectedRevision, input.refId),
    },
  ];
}

function model(...decisions: object[]): RuntimeModel {
  const queue = decisions.map((decision) => JSON.stringify(decision));
  return { generate: async () => queue.shift() ?? JSON.stringify({ type: 'final', message: 'complete' }) };
}

describe('WebMCP deployment-parity fixture', () => {
  it('discovers, approves and executes a staged flight through the WebMCP bridge', async () => {
    const fixture = createWebMcpTravelFixture();
    const tools = travelTools(fixture);
    await registerRuntimeTools(fixture.context, tools);
    const provider = createWebMcpToolProvider(fixture.context, {
      trustedReadOnlyOrigins: [ORIGIN],
    });
    const approve = vi.fn(() => true);
    const result = await runAgentRuntime({
      goal: 'Stage the non-red-eye flight.',
      model: model(
        { type: 'tool_call', tool: 'get_trip_constraints', input: {} },
        { type: 'tool_call', tool: 'search_flights', input: {} },
        { type: 'tool_call', tool: 'add_itinerary_item', input: {
          expectedRevision: 1, kind: 'flight', refId: 'fl-day', date: '2026-11-02',
        } },
        { type: 'final', message: 'Staged the non-red-eye flight.' },
      ),
      toolProvider: provider,
      approve,
      getStateRevision: fixture.getRevision,
    });

    expect(result).toMatchObject({ status: 'completed' });
    expect(result.history.map(({ tool }) => tool)).toEqual([
      'get_trip_constraints', 'search_flights', 'add_itinerary_item',
    ]);
    expect(approve).toHaveBeenCalledOnce();
    expect(approve).toHaveBeenCalledWith(expect.objectContaining({
      tool: expect.objectContaining({ name: 'add_itinerary_item' }),
    }));
    expect(result.events).toContainEqual({
      type: 'approval_required', step: 3, toolName: 'add_itinerary_item',
    });
    expect(fixture.getRevision()).toBe(2);
  });
});
