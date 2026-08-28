/**
 * A deterministic stand-in for a real inference backend.
 *
 * The runtime is model-neutral, so the collaborative slice can be built and
 * demonstrated before a local model adapter exists. This model reads the
 * current state revision out of the prompt the runtime built and substitutes it
 * into its scripted writes, which means it exercises the same identifier-reuse
 * path a real model would: a write only succeeds if it carries the revision the
 * run was planned against.
 *
 * It is not a simulation of model behaviour and makes no claim to be. It exists
 * so the UI, the approval pause and the stale-state turn are reproducible for
 * visual verification. Anandh's adapter replaces it behind `RuntimeModel`
 * without any change to this application.
 */

import type { RuntimeModel, RuntimeModelRequest } from '@webmcp-loom/runtime';

export interface ScriptedStep {
  /** Tool to call, or `null` to finish the run with `message`. */
  tool: string | null;
  /** Input template. The string `"$revision"` is replaced with the live revision. */
  input?: Record<string, unknown>;
  message?: string;
}

export const REVISION_PLACEHOLDER = '$revision';

/**
 * The hero plan: read the constraints, find a non-red-eye outbound, stage it,
 * find a Kyoto stay within budget, stage that, then report.
 *
 * Six steps is the runtime's default ceiling, and the product direction targets
 * two-to-six call workflows, so this deliberately sits at the top of that range
 * rather than below it.
 */
export const HERO_SCRIPT: readonly ScriptedStep[] = Object.freeze([
  { tool: 'get_trip_constraints', input: {} },
  { tool: 'search_flights', input: { originCode: 'BLR', excludeRedEye: true } },
  {
    tool: 'add_itinerary_item',
    input: {
      expectedRevision: REVISION_PLACEHOLDER,
      kind: 'flight',
      refId: 'fl-blr-nrt-day',
      date: '2026-11-05',
    },
  },
  { tool: 'search_stays', input: { cityId: 'kyoto', maxPricePerNightInr: 6_000 } },
  {
    tool: 'add_itinerary_item',
    input: {
      expectedRevision: REVISION_PLACEHOLDER,
      kind: 'stay',
      refId: 'st-kyo-mid',
      date: '2026-11-10',
      nights: 4,
    },
  },
  { tool: null, message: 'Outbound flight and Kyoto stay are staged, and nothing is booked.' },
]);

/** The follow-up turn: read what the person changed, then repair around it. */
export const REPAIR_SCRIPT: readonly ScriptedStep[] = Object.freeze([
  { tool: 'get_itinerary', input: {} },
  { tool: 'search_stays', input: { cityId: 'tokyo', maxPricePerNightInr: 6_000 } },
  {
    tool: 'add_itinerary_item',
    input: {
      expectedRevision: REVISION_PLACEHOLDER,
      kind: 'stay',
      refId: 'st-tok-mid',
      date: '2026-11-06',
      nights: 3,
    },
  },
  { tool: null, message: 'Replaced the removed nights with a Tokyo stay inside the same budget.' },
]);

const REVISION_IN_PROMPT = /Current state revision:\s*(\d+)/;

/** Reads the revision the runtime captured for this step out of its own prompt. */
function currentRevision(prompt: string): number | null {
  const matched = REVISION_IN_PROMPT.exec(prompt);
  if (matched === null) return null;
  const parsed = Number(matched[1]);
  return Number.isInteger(parsed) ? parsed : null;
}

function resolveInput(
  template: Record<string, unknown>,
  revision: number | null,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(template)) {
    if (value === REVISION_PLACEHOLDER) {
      if (revision === null) {
        throw new Error('The scripted model needs a state revision the prompt did not carry.');
      }
      resolved[key] = revision;
    } else {
      resolved[key] = value;
    }
  }
  return resolved;
}

/**
 * Builds a model that walks `script` one step per call. Running past the end
 * finishes rather than repeating, so a script that is shorter than the step
 * limit cannot loop.
 */
export function createScriptedModel(script: readonly ScriptedStep[]): RuntimeModel {
  let index = 0;
  return {
    generate: (request: RuntimeModelRequest): Promise<string> => {
      const step = script[index];
      index += 1;
      if (step === undefined || step.tool === null) {
        return Promise.resolve(JSON.stringify({
          type: 'final',
          message: step?.message ?? 'Finished.',
        }));
      }
      return Promise.resolve(JSON.stringify({
        type: 'tool_call',
        tool: step.tool,
        input: resolveInput(step.input ?? {}, currentRevision(request.prompt)),
      }));
    },
  };
}
