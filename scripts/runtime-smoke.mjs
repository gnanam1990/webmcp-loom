import {
  createStaticToolProvider,
  runAgentRuntime,
} from '../packages/runtime/dist/index.js';

const decisions = [
  JSON.stringify({ type: 'tool_call', tool: 'inspect', input: { id: 'smoke-1' } }),
  JSON.stringify({ type: 'final', message: 'Smoke run complete.' }),
];

const result = await runAgentRuntime({
  goal: 'Run the built runtime smoke flow.',
  model: {
    generate: async () => decisions.shift() ?? JSON.stringify({ type: 'final', message: 'Done.' }),
  },
  toolProvider: createStaticToolProvider([
    {
      name: 'inspect',
      title: 'Inspect fixture',
      description: 'Read one deterministic smoke fixture.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: ({ id }) => ({ id, ready: true }),
    },
  ]),
});

if (result.status !== 'completed' || result.history.length !== 1) {
  throw new Error(`Runtime smoke failed: ${JSON.stringify(result)}`);
}

process.stdout.write('Built runtime smoke passed.\n');
