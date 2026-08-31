import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './styles.css';

const mount = document.querySelector('#root');
if (mount === null) throw new Error('Missing #root mount point.');

createRoot(mount).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
