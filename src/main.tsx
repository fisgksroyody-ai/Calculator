import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import { initializeSecurityConfig } from './utils.js';

// 1. Initialize safe configuration and log startup diagnostics immediately before React render
initializeSecurityConfig();

import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import App from './App.tsx';
import './index.css';

// Register Service Worker for offline-first support
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js')
      .then((reg) => {
        console.log('ServiceWorker registered with scope: ', reg.scope);
      })
      .catch((err) => {
        console.error('ServiceWorker registration failed: ', err);
      });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);


