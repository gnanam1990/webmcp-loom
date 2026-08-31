import { installDocumentRuntimeTools } from '@webmcp-loom/runtime';
import type { RuntimeTool } from '@webmcp-loom/runtime';

type PageLifecycle = Pick<Window, 'addEventListener' | 'removeEventListener'>;

/**
 * Publishes the travel capabilities for the lifetime of this page instance.
 *
 * A page entering the back-forward cache remains alive, so its registration
 * must remain alive too. A terminal pagehide and Vite HMR both call the
 * returned disposer, which aborts any in-flight registration and unregisters
 * tools that already finished installing.
 */
export function installTravelWebMcpRegistration(
  tools: readonly RuntimeTool[],
  lifecycle: PageLifecycle = window,
): () => void {
  const controller = new AbortController();
  const registration = installDocumentRuntimeTools(tools, { signal: controller.signal });
  let disposed = false;

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    lifecycle.removeEventListener('pagehide', onPageHide);
    controller.abort();
    void registration.then((installed) => installed?.dispose(), () => undefined);
  };

  const onPageHide = (event: PageTransitionEvent): void => {
    if (!event.persisted) dispose();
  };

  lifecycle.addEventListener('pagehide', onPageHide);
  void registration.then((installed) => {
    if (installed === null && import.meta.env.DEV) {
      console.info('WebMCP is unavailable in this browser; travel tools were not published.');
    }
  }).catch((error: unknown) => {
    if (!controller.signal.aborted) {
      console.error('WebMCP travel-tool registration failed.', error);
    }
  });

  return dispose;
}
