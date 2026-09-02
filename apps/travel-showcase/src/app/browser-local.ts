import type { RuntimeModel } from '@webmcp-loom/runtime';

export const BROWSER_LOCAL_BACKEND = Object.freeze({
  id: 'webllm',
  kind: 'local' as const,
  label: 'Browser-local model',
  detail: 'Runs through WebGPU in this browser. Tool policy and approval remain in the shared runtime.',
});

export interface BrowserLocalApplicationOptions {
  model: string;
  onLoadProgress?: (progress: { progress: number; text: string }) => void;
}

/** Keeps adapter internals out of the interface while leaving the recovery action clear. */
export function describeBrowserLocalFailure(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  if (/cannot find model record|model id/i.test(detail)) {
    return 'That model is not available. Check the model ID and try again.';
  }
  if (/webgpu/i.test(detail)) {
    return 'WebGPU is unavailable in this browser. Try a supported browser or device.';
  }
  return 'The local model could not be loaded. Check browser support and try again.';
}

/** Loads an explicitly selected WebLLM artifact without creating a second app state. */
export async function loadBrowserLocalModel(
  options: BrowserLocalApplicationOptions,
): Promise<RuntimeModel> {
  // Keep the multi-megabyte inference engine out of the normal scripted demo.
  // The chunk is fetched only after an explicit `localModel` request.
  const { createWebLlmRuntimeModel } = await import('@webmcp-loom/model-adapters');
  return createWebLlmRuntimeModel({
    model: options.model,
    ...(options.onLoadProgress === undefined ? {} : { onLoadProgress: options.onLoadProgress }),
  });
}
