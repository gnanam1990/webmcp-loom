import { describe, expect, it } from 'vitest';

import { getAgentDecisionSchema } from './prompt.js';
import type { RuntimeTool } from './types.js';

function tool(): RuntimeTool {
  return {
    name: 'inspect',
    title: 'Inspect',
    description: 'Inspect a fixture.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    execute: () => ({ ok: true }),
  };
}

describe('getAgentDecisionSchema', () => {
  it('does not share final-decision schema objects across selected-tool requests', () => {
    const first = getAgentDecisionSchema([tool()]);
    const firstOneOf = first.oneOf as Array<Record<string, unknown>>;
    const finalProperties = firstOneOf[0]?.properties as Record<string, unknown>;
    finalProperties.message = { const: 'mutated' };

    const second = getAgentDecisionSchema([tool()]);
    const secondOneOf = second.oneOf as Array<Record<string, unknown>>;
    const secondProperties = secondOneOf[0]?.properties as Record<string, unknown>;

    expect(secondProperties.message).toEqual({ type: 'string' });
  });
});
