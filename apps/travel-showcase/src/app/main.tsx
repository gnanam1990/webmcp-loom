import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { installDocumentRuntimeTools } from '@webmcp-loom/runtime';
import { App } from './App.js';
import { createTravelApplication } from './application.js';
import './styles.css';

const mount = document.querySelector('#root');
if (mount === null) throw new Error('Missing #root mount point.');
const application = createTravelApplication();

createRoot(mount).render(
  <StrictMode>
    <App session={application.session} />
  </StrictMode>,
);

const registrationController = new AbortController();
const registration = installDocumentRuntimeTools(application.tools, {
  signal: registrationController.signal,
});
void registration.catch((error: unknown) => {
  if (!registrationController.signal.aborted) {
    console.error('WebMCP travel-tool registration failed.', error);
  }
});

const disposeRegistration = (): void => {
  window.removeEventListener('pagehide', disposeRegistration);
  registrationController.abort();
  void registration.then((installed) => installed?.dispose(), () => undefined);
};
window.addEventListener('pagehide', disposeRegistration, { once: true });
if (import.meta.hot !== undefined) import.meta.hot.dispose(disposeRegistration);
