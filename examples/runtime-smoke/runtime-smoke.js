import {
  createStaticToolProvider,
  runAgentRuntime,
} from '../../packages/runtime/dist/index.js';

const status = document.querySelector('#status');
const toolCount = document.querySelector('#tool-count');
const finalState = document.querySelector('#final-state');
const trace = document.querySelector('#trace');

try {
  const decisions = [
    JSON.stringify({ type: 'tool_call', tool: 'inspect', input: { id: 'browser-1' } }),
    JSON.stringify({ type: 'final', message: 'Browser smoke complete.' }),
  ];
  const result = await runAgentRuntime({
    goal: 'Run a deterministic browser smoke flow.',
    model: {
      generate: async () => decisions.shift() ?? JSON.stringify({ type: 'final', message: 'Done.' }),
    },
    toolProvider: createStaticToolProvider([{
      name: 'inspect',
      title: 'Inspect fixture',
      description: 'Read one deterministic browser fixture.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: ({ id }) => ({ id, ready: true }),
    }]),
  });
  if (result.status !== 'completed' || result.history.length !== 1) {
    throw new Error(`Unexpected result: ${JSON.stringify(result)}`);
  }
  status.textContent = 'Passed';
  status.dataset.state = 'passed';
  toolCount.textContent = String(result.history.length);
  finalState.textContent = result.status;
  trace.textContent = JSON.stringify(result.events, null, 2);
} catch (error) {
  status.textContent = 'Failed';
  status.dataset.state = 'failed';
  finalState.textContent = 'failed';
  trace.textContent = error instanceof Error ? error.stack ?? error.message : String(error);
}
