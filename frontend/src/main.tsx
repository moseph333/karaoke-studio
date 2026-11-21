/**
 * Frontend Application Root Entry Point
 *
 * Mounts the React application tree with StrictMode, top-level ErrorBoundary,
 * and ToastProvider into the root DOM element. Starts listening for
 * the browser's install offer and registers the offline service worker (production builds).
 * The studio, dialogs and command palette are separate chunks, fetched once the first screen
 * is idle (deferredScreens.ts).
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastProvider } from './hooks/useToast';
import { startInstallPromptCapture } from './utils/installPrompt';
import { registerServiceWorker } from './utils/serviceWorker';
import { preloadDeferredScreens } from './deferredScreens';
import './fonts.css';
import './index.css';

// Before React mounts: the browser can offer installation as soon as the page loads
startInstallPromptCapture();
registerServiceWorker();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <ToastProvider>
        <App />
      </ToastProvider>
    </ErrorBoundary>
  </React.StrictMode>
);

// After the first render is under way: nothing on the first screen waits for these
preloadDeferredScreens();
