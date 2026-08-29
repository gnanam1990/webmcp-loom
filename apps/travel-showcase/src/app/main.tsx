import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { createTravelApplication } from './application.js';
import { installTravelWebMcpRegistration } from './webmcp-registration.js';
import './styles.css';

const mount = document.querySelector('#root');
if (mount === null) throw new Error('Missing #root mount point.');
const application = createTravelApplication();

createRoot(mount).render(
  <StrictMode>
    <App session={application.session} />
  </StrictMode>,
);

const disposeRegistration = installTravelWebMcpRegistration(application.tools);
if (import.meta.hot !== undefined) import.meta.hot.dispose(disposeRegistration);
