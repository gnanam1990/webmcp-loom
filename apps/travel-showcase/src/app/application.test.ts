import { afterEach, describe, expect, it, vi } from 'vitest';
import { installDocumentRuntimeTools } from '@webmcp-loom/runtime';
import { createTravelApplication } from './application.js';
import type {
  JsonObject,
  RegisteredWebMcpTool,
  WebMcpModelContext,
  WebMcpToolDefinition,
} from '@webmcp-loom/runtime';

interface FakeWebMcp {
  readonly context: WebMcpModelContext;
  readonly definitions: Map<string, WebMcpToolDefinition>;
  readonly registrationSignals: AbortSignal[];
}

function createFakeWebMcp(): FakeWebMcp {
  const definitions = new Map<string, WebMcpToolDefinition>();
  const registrationSignals: AbortSignal[] = [];
  const registeredTools = (): RegisteredWebMcpTool[] => [...definitions.values()].map((tool) => ({
    name: tool.name,
    description: tool.description,
    ...(tool.title === undefined ? {} : { title: tool.title }),
    ...(tool.inputSchema === undefined ? {} : { inputSchema: tool.inputSchema }),
    ...(tool.annotations === undefined ? {} : { annotations: tool.annotations }),
  }));

  const context: WebMcpModelContext = {
    registerTool: (tool, options) => {
      definitions.set(tool.name, tool);
      if (options?.signal !== undefined) registrationSignals.push(options.signal);
      return Promise.resolve();
    },
    getTools: () => Promise.resolve(registeredTools()),
    executeTool: async (tool, input: JsonObject = {}, options = {}) => {
      const definition = definitions.get(tool.name);
      if (definition === undefined) throw new Error(`Tool is not registered: ${tool.name}`);
      const output = await definition.execute(input, { signal: options.signal });
      return JSON.stringify(output) ?? 'null';
    },
  };

  return { context, definitions, registrationSignals };
}

afterEach(() => vi.unstubAllGlobals());

describe('travel application WebMCP integration', () => {
  it('uses an injected ready backend through the same session runtime', async () => {
    const createModel = vi.fn(() => ({
      generate: async () => JSON.stringify({ type: 'final', message: 'Local model completed.' }),
    }));
    const application = createTravelApplication(undefined, {
      backend: {
        status: 'ready',
        backend: { id: 'local-test', kind: 'local', label: 'Local test', detail: 'Test-only local adapter.' },
      },
      createModel,
    });

    await application.session.run('Check the local model seam.');

    expect(createModel).toHaveBeenCalledOnce();
    expect(application.session.getSnapshot()).toMatchObject({
      backend: { status: 'ready', backend: { id: 'local-test', kind: 'local' } },
      note: 'Local model completed.',
      status: 'completed',
    });
  });

  it('registers the canonical tools and reflects an external write in the UI session', async () => {
    const webmcp = createFakeWebMcp();
    vi.stubGlobal('document', { modelContext: webmcp.context });
    const application = createTravelApplication();
    let notifications = 0;
    application.session.subscribe(() => { notifications += 1; });

    const registration = await installDocumentRuntimeTools(application.tools);
    expect(registration).not.toBeNull();
    expect([...webmcp.definitions.keys()].sort()).toEqual([
      'add_itinerary_item',
      'get_budget_summary',
      'get_itinerary',
      'get_trip_constraints',
      'list_destinations',
      'move_itinerary_item',
      'remove_itinerary_item',
      'search_activities',
      'search_flights',
      'search_stays',
    ]);

    const addTool = (await webmcp.context.getTools()).find(
      (tool) => tool.name === 'add_itinerary_item',
    );
    if (addTool === undefined) throw new Error('Expected the add tool to be registered.');
    const result = JSON.parse(await webmcp.context.executeTool(addTool, {
      expectedRevision: 1,
      kind: 'activity',
      refId: 'ac-tok-teamlab',
      date: '2026-11-06',
    })) as { revision: number };

    expect(result.revision).toBe(2);
    expect(application.session.getSnapshot().trip).toMatchObject({
      revision: 2,
      items: [{ activityId: 'ac-tok-teamlab', kind: 'activity' }],
    });
    expect(notifications).toBe(1);

    registration?.dispose();
    expect(webmcp.registrationSignals).toHaveLength(10);
    expect(webmcp.registrationSignals.every((signal) => signal.aborted)).toBe(true);
  });

  it('rejects a pending in-app write after an external WebMCP write advances the revision', async () => {
    const webmcp = createFakeWebMcp();
    vi.stubGlobal('document', { modelContext: webmcp.context });
    const application = createTravelApplication();
    await installDocumentRuntimeTools(application.tools);

    let resolveAwaiting: (() => void) | undefined;
    const awaitingApproval = new Promise<void>((resolve) => { resolveAwaiting = resolve; });
    application.session.subscribe(() => {
      if (application.session.getSnapshot().status === 'awaiting_approval') {
        resolveAwaiting?.();
        resolveAwaiting = undefined;
      }
    });

    const run = application.session.run('Prepare the trip.');
    await awaitingApproval;
    const addTool = (await webmcp.context.getTools()).find(
      (tool) => tool.name === 'add_itinerary_item',
    );
    if (addTool === undefined) throw new Error('Expected the add tool to be registered.');
    await webmcp.context.executeTool(addTool, {
      expectedRevision: 1,
      kind: 'activity',
      refId: 'ac-tok-teamlab',
      date: '2026-11-06',
    });

    expect(application.session.getSnapshot().trip.revision).toBe(2);
    application.session.approve();
    await run;

    expect(application.session.getSnapshot()).toMatchObject({
      status: 'stale',
      trip: {
        revision: 2,
        items: [{ activityId: 'ac-tok-teamlab', kind: 'activity' }],
      },
    });
  });
});
