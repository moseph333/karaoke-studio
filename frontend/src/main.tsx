import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Global API interceptor to attach shared passphrase and intercept 401s
const originalFetch = window.fetch;
window.fetch = async (input, init) => {
  const token = localStorage.getItem('karaoke_auth_token');
  if (token && typeof input === 'string' && input.startsWith('/api/')) {
    init = init || {};
    const headers = new Headers(init.headers || {});
    if (!headers.has('X-App-Password')) {
      headers.set('X-App-Password', token);
    }
    init.headers = headers;
  }
  const response = await originalFetch(input, init);
  if (response.status === 401 && typeof input === 'string' && !input.startsWith('/api/auth/')) {
    window.dispatchEvent(new CustomEvent('karaoke_unauthorized'));
  }
  return response;
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
