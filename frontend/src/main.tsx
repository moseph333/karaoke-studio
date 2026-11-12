/**
 * Frontend Application Root Entry Point
 *
 * Mounts the React application tree with StrictMode, top-level ErrorBoundary,
 * ToastProvider, and AppThemeProvider contexts into the root DOM element. Starts listening for
 * the browser's install offer and registers the offline service worker (production builds).
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastProvider } from './hooks/useToast';
import { AppThemeProvider } from './context/AppThemeContext';
import { startInstallPromptCapture } from './utils/installPrompt';
import { registerServiceWorker } from './utils/serviceWorker';
import './index.css';

// Before React mounts: the browser can offer installation as soon as the page loads
startInstallPromptCapture();
registerServiceWorker();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <ToastProvider>
        <AppThemeProvider>
          <App />
        </AppThemeProvider>
      </ToastProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
