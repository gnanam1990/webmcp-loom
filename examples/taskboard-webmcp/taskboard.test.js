import { describe, expect, it } from 'vitest';

import {
  createWebMcpToolProvider,
  registerRuntimeTools,
  runAgentRuntime,
} from '@webmcp-loom/runtime';
import { createMemoryModelContext } from './memory-model-context.js';
import { createTaskBoard, createTaskBoardTools } from './taskboard.js';

function decisionScript(decisions) {
  let index = 0;
  return {
    generate: async (request) => {
      const next = decisions[index];
      index += 1;
      if (next === undefined) return JSON.stringify({ type: 'final', message: 'Done.' });
      if (next.type !== 'tool_call') return JSON.stringify(next);
      const revision = Number(/^Current state revision:\s*(\d+)$/m.exec(request.prompt)?.[1]);
      return JSON.stringify({
        ...next,
        input: Object.fromEntries(Object.entries(next.input).map(([key, value]) => [
          key,
          value === '$revision' ? revision : value,
        ])),
      });
    },
  };
}

async function taskBoardRuntime(board, model, { approve = undefined, onEvent = undefined } = {}) {
  const context = createMemoryModelContext();
  const registration = await registerRuntimeTools(context, createTaskBoardTools(board));
  const result = await runAgentRuntime({
    goal: 'Read the board and stage one task.',
    model,
    toolProvider: createWebMcpToolProvider(context, {
      fromOrigins: ['https://taskboard.example.test'],
      trustedReadOnlyOrigins: ['https://taskboard.example.test'],
    }),
    getStateRevision: () => board.getSnapshot().revision,
    ...(approve === undefined ? {} : { approve }),
    ...(onEvent === undefined ? {} : { onEvent }),
  });
  return { context, registration, result };
}

describe('non-travel task-board WebMCP fixture', () => {
  it('uses the same Unicode character limit as its tool schema', () => {
    const board = createTaskBoard();

    expect(board.addAsHuman('😀'.repeat(80)).task.title).toHaveLength(160);
    expect(() => board.addAsHuman('😀'.repeat(81))).toThrow('title must contain 1-80 characters.');
  });

  it('rejects malformed direct calls before they reach board state', async () => {
    const board = createTaskBoard();
    const [read, stage] = createTaskBoardTools(board);

    expect(() => read.execute({ unexpected: true })).toThrow('Tool input does not match its schema.');
    expect(() => stage.execute(
      { expectedRevision: 1, title: 'Malformed', unexpected: true },
      {},
    )).toThrow('Tool input does not match its schema.');
    expect(board.getSnapshot()).toEqual({ revision: 1, tasks: [] });
  });

  it('uses one registered tool surface for WebMCP discovery and an approval handoff', async () => {
    const board = createTaskBoard();
    const { context, registration, result } = await taskBoardRuntime(board, decisionScript([
      { type: 'tool_call', tool: 'get_task_board', input: {} },
      { type: 'tool_call', tool: 'stage_task', input: { expectedRevision: '$revision', title: 'Review WebMCP trace' } },
      { type: 'final', message: 'Task staged.' },
    ]));

    expect(result.status).toBe('approval_required');
    expect(context.registeredNames()).toEqual(['get_task_board', 'stage_task']);
    expect(result.pendingApproval.tool.name).toBe('stage_task');
    expect(result.history).toHaveLength(1);
    // Prompt and pre-execute refreshes both consult the document-facing surface.
    expect(context.getToolsCallCount()).toBeGreaterThanOrEqual(3);
    expect(board.getSnapshot()).toEqual({ revision: 1, tasks: [] });
    registration.dispose();
  });

  it('executes an approved write through the registered WebMCP tool', async () => {
    const board = createTaskBoard();
    const { registration, result } = await taskBoardRuntime(board, decisionScript([
      { type: 'tool_call', tool: 'get_task_board', input: {} },
      { type: 'tool_call', tool: 'stage_task', input: { expectedRevision: '$revision', title: 'Review WebMCP trace' } },
      { type: 'final', message: 'Task staged.' },
    ]), { approve: () => true });

    expect(result.status).toBe('completed');
    expect(result.history.map((entry) => entry.tool)).toEqual(['get_task_board', 'stage_task']);
    expect(board.getSnapshot()).toEqual({
      revision: 2,
      tasks: [{ id: 'task-1', title: 'Review WebMCP trace' }],
    });
    registration.dispose();
  });

  it('stops before a stale write when a human changes the same board', async () => {
    const board = createTaskBoard();
    let edited = false;
    const { registration, result } = await taskBoardRuntime(board, decisionScript([
      { type: 'tool_call', tool: 'get_task_board', input: {} },
      { type: 'tool_call', tool: 'stage_task', input: { expectedRevision: '$revision', title: 'Agent task' } },
    ]), { onEvent: (event) => {
      if (!edited && event.type === 'tools_refreshed' && event.step === 2 && event.phase === 'pre_execute') {
        edited = true;
        board.addAsHuman('Human changed the board');
      }
    } });

    expect(result.status).toBe('stale_state');
    expect(result.history.map((entry) => entry.tool)).toEqual(['get_task_board']);
    expect(board.getSnapshot()).toEqual({
      revision: 2,
      tasks: [{ id: 'task-1', title: 'Human changed the board' }],
    });
    registration.dispose();
  });
});
