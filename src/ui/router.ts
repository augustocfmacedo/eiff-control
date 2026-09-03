import { useEffect, useState } from 'react';

export interface Rota {
  path: string; // ex.: /obras/OB-SF-CL-01
  partes: string[];
  query: URLSearchParams;
}

function parse(): Rota {
  const hash = window.location.hash.replace(/^#/, '') || '/';
  const [p, q] = hash.split('?');
  const path = p.startsWith('/') ? p : `/${p}`;
  return { path, partes: path.split('/').filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(q ?? '') };
}

export function useRota(): Rota {
  const [rota, setRota] = useState<Rota>(parse);
  useEffect(() => {
    const on = () => setRota(parse());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return rota;
}

export function navegar(path: string) {
  window.location.hash = path;
}

export const href = (path: string) => `#${path}`;
