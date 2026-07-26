import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';

const contenedor = document.getElementById('root');

if (contenedor === null) {
  throw new Error('No se encontró el contenedor #root en el documento.');
}

createRoot(contenedor).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
