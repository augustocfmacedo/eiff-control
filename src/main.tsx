import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

// casca do aplicativo disponivel sem rede (modo campo); dados continuam vindo do Supabase, com fila offline no store
if (import.meta.env.PROD && 'serviceWorker' in navigator) window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => undefined); });

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
