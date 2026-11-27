/**
 * Frontend Application Root Entry Point
 *
 * Mounts the React application tree with StrictMode, top-level ErrorBoundary,
 * and ToastProvider into the root DOM element. Starts listening for
 * the browser's install offer and registers the offline service worker (production builds).
 * The studio, dialogs and command palette are separate chunks, fetched once the first screen
 * is idle (deferredScreens.ts).
 *
 * `/?stage=1` is a stage window (the stage alone, for a second screen): it mounts
 * `StageWindow` in place of the app, which would otherwise sign in, poll, offer updates and
 * save stage settings from a window that only shows what the studio's window sends it.
 * `/?show=1` is a show's host screen (the queue of a karaoke night): it mounts `ShowApp`,
 * which signs in and has no library to edit.
 */

import React, { Suspense, lazy } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastProvider } from './hooks/useToast';
import { startInstallPromptCapture } from './utils/installPrompt';
import { registerServiceWorker } from './utils/serviceWorker';
import { isShowUrl, isStageWindowUrl } from './utils/stageLink';
import { preloadDeferredScreens } from './deferredScreens';
import './fonts.css';
import './index.css';

const isStageWindow = isStageWindowUrl(window.location.search);
// A show's host screen: the queue of a karaoke night, in place of the library and studio
const isShow = !isStageWindow && isShowUrl(window.location.search);
const StageWindow = lazy(() =>
  import('./components/stage-window/StageWindow').then((m) => ({ default: m.StageWindow }))
);
const ShowApp = lazy(() =>
  import('./components/show/ShowApp').then((m) => ({ default: m.ShowApp }))
);

// Before React mounts: the browser can offer installation as soon as the page loads
if (!isStageWindow) startInstallPromptCapture();
registerServiceWorker();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <ToastProvider>
        {isStageWindow ? (
          <Suspense fallback={null}>
            <StageWindow />
          </Suspense>
        ) : isShow ? (
          <Suspense fallback={null}>
            <ShowApp />
          </Suspense>
        ) : (
          <App />
        )}
      </ToastProvider>
    </ErrorBoundary>
  </React.StrictMode>
);

// After the first render is under way: nothing on the first screen waits for these
if (!isStageWindow && !isShow) preloadDeferredScreens();
