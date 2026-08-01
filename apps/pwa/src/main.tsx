import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

// R1: el service worker se registra solo en producción (cache-first del
// shell); en tests se omite a propósito.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => undefined);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
