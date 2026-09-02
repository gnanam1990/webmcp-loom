import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { createTravelApplication } from './application.js';
import {
  BROWSER_LOCAL_BACKEND,
  describeBrowserLocalFailure,
  loadBrowserLocalModel,
} from './browser-local.js';
import { installTravelWebMcpRegistration } from './webmcp-registration.js';
import './styles.css';
import type { WebMcpStatus } from './App.js';

const mount = document.querySelector('#root');
if (mount === null) throw new Error('Missing #root mount point.');
const application = createTravelApplication();

const root = createRoot(mount);

/**
 * Registration resolves asynchronously, so the page renders immediately as
 * `unsupported` and re-renders once the real answer arrives. The status is
 * shown rather than only logged because a resolved `null` — the likeliest
 * outcome, since no shipping browser implements `document.modelContext` yet —
 * is the failure most easily missed: the in-app experience keeps working while
 * the external-agent surface never came up.
 */
function render(webmcp: WebMcpStatus): void {
  root.render(
    <StrictMode>
      <App
        session={application.session}
        webmcp={webmcp}
        {...(requestedLocalModel === null ? {} : { onRetryBackend: startBrowserLocalModel })}
      />
    </StrictMode>,
  );
}

const requestedLocalModel = new URLSearchParams(window.location.search).get('localModel')?.trim() || null;
function startBrowserLocalModel(): void {
  if (requestedLocalModel === null) return;
  application.session.configureBackend({ status: 'loading', backend: BROWSER_LOCAL_BACKEND });
  void loadBrowserLocalModel({ model: requestedLocalModel }).then(
    (model) => {
      application.session.configureBackend(
        { status: 'ready', backend: BROWSER_LOCAL_BACKEND },
        () => model,
      );
    },
    (error: unknown) => {
      application.session.configureBackend({
        status: 'failed',
        backend: BROWSER_LOCAL_BACKEND,
        error: describeBrowserLocalFailure(error),
      });
    },
  );
}

if (requestedLocalModel !== null) startBrowserLocalModel();

render('unsupported');

const disposeRegistration = installTravelWebMcpRegistration(application.tools, {
  onStatus: render,
});
if (import.meta.hot !== undefined) import.meta.hot.dispose(disposeRegistration);
