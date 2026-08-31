import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WebMcpModelContext } from '@webmcp-loom/runtime';
import { createTravelApplication } from './application.js';
import { installTravelWebMcpRegistration } from './webmcp-registration.js';

function pageTransition(persisted: boolean): Event {
  const event = new Event('pagehide');
  Object.defineProperty(event, 'persisted', { value: persisted });
  return event;
}

afterEach(() => vi.unstubAllGlobals());

describe('travel WebMCP registration lifecycle', () => {
  it('retains registrations in the back-forward cache and disposes on terminal pagehide', async () => {
    const signals: AbortSignal[] = [];
    const context: WebMcpModelContext = {
      registerTool: (_tool, options) => {
        if (options?.signal !== undefined) signals.push(options.signal);
        return Promise.resolve();
      },
      getTools: () => Promise.resolve([]),
      executeTool: () => Promise.resolve('{}'),
    };
    vi.stubGlobal('document', { modelContext: context });
    const lifecycle = new EventTarget();
    const application = createTravelApplication();

    const dispose = installTravelWebMcpRegistration(application.tools, {
      lifecycle: lifecycle as unknown as Pick<Window, 'addEventListener' | 'removeEventListener'>,
    });
    await Promise.resolve();
    expect(signals).toHaveLength(10);

    lifecycle.dispatchEvent(pageTransition(true));
    expect(signals.every((signal) => !signal.aborted)).toBe(true);

    lifecycle.dispatchEvent(pageTransition(false));
    expect(signals.every((signal) => signal.aborted)).toBe(true);

    // The disposer is idempotent when HMR cleanup follows terminal unload.
    expect(() => dispose()).not.toThrow();
  });
});
