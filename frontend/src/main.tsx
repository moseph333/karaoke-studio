/**
 * Frontend Application Root Entry Point
 *
 * Mounts the React application tree with StrictMode, top-level ErrorBoundary,
 * ToastProvider, and AppThemeProvider contexts into the root DOM element.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastProvider } from './hooks/useToast';
import { AppThemeProvider } from './context/AppThemeContext';
import './index.css';

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
