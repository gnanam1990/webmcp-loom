import { beforeEach, describe, expect, it, vi } from 'vitest';

const createWebLlmRuntimeModel = vi.fn();

vi.mock('@webmcp-loom/model-adapters', () => ({
  createWebLlmRuntimeModel,
}));

import {
  BROWSER_LOCAL_BACKEND,
  describeBrowserLocalFailure,
  loadBrowserLocalModel,
} from './browser-local.js';

describe('browser-local model loader', () => {
  beforeEach(() => {
    createWebLlmRuntimeModel.mockReset();
  });

  it('describes the backend as local and policy-preserving', () => {
    expect(BROWSER_LOCAL_BACKEND).toMatchObject({
      id: 'webllm',
      kind: 'local',
      label: 'Browser-local model',
    });
    expect(BROWSER_LOCAL_BACKEND.detail).toContain('shared runtime');
  });

  it('forwards the explicit model and progress listener to the WebLLM adapter', async () => {
    const runtimeModel = { generate: vi.fn() };
    const onLoadProgress = vi.fn();
    createWebLlmRuntimeModel.mockResolvedValue(runtimeModel);

    await expect(loadBrowserLocalModel({
      model: 'fixture-model',
      onLoadProgress,
    })).resolves.toBe(runtimeModel);

    expect(createWebLlmRuntimeModel).toHaveBeenCalledOnce();
    expect(createWebLlmRuntimeModel).toHaveBeenCalledWith({
      model: 'fixture-model',
      onLoadProgress,
    });
  });

  it('omits an absent progress listener instead of forwarding undefined', async () => {
    createWebLlmRuntimeModel.mockResolvedValue({ generate: vi.fn() });

    await loadBrowserLocalModel({ model: 'fixture-model' });

    expect(createWebLlmRuntimeModel).toHaveBeenCalledWith({ model: 'fixture-model' });
  });

  it('turns adapter failures into concise recovery guidance', () => {
    expect(describeBrowserLocalFailure(
      new Error('Cannot find model record in appConfig for fixture-model.'),
    )).toBe('That model is not available. Check the model ID and try again.');
    expect(describeBrowserLocalFailure(new Error('WebGPU API is not available')))
      .toBe('WebGPU is unavailable in this browser. Try a supported browser or device.');
    expect(describeBrowserLocalFailure(new Error('opaque adapter failure')))
      .toBe('The local model could not be loaded. Check browser support and try again.');
  });
});
