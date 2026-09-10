// Guarda local para o modo offline (IndexedDB, sem biblioteca): o ultimo dataset carregado do Supabase (cache para abrir
// sem rede) e as alteracoes pendentes de envio com a base que o usuario viu (para o diff ser so o que ele mudou).
import type { Dataset, Usuario } from '../core/types';

const BANCO = 'eiff-control'; const LOJA = 'kv';
export interface Pendente { usuarioId: string; base: Dataset; ds: Dataset; em: string }
export interface Cache { ds: Dataset; usuario: Usuario; em: string }

function abrir(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((res) => {
    try {
      const req = indexedDB.open(BANCO, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore(LOJA); };
      req.onsuccess = () => res(req.result);
      req.onerror = () => res(null);
    } catch { res(null); }
  });
}
async function ler<T>(chave: string): Promise<T | null> {
  const db = await abrir(); if (!db) return null;
  return new Promise((res) => { try { const req = db.transaction(LOJA, 'readonly').objectStore(LOJA).get(chave); req.onsuccess = () => res((req.result as T) ?? null); req.onerror = () => res(null); } catch { res(null); } });
}
async function gravar(chave: string, valor: unknown): Promise<boolean> {
  const db = await abrir(); if (!db) return false;
  return new Promise((res) => { try { const tx = db.transaction(LOJA, 'readwrite'); tx.objectStore(LOJA).put(valor, chave); tx.oncomplete = () => res(true); tx.onerror = () => res(false); } catch { res(false); } });
}
async function apagar(chave: string): Promise<void> {
  const db = await abrir(); if (!db) return;
  await new Promise<void>((res) => { try { const tx = db.transaction(LOJA, 'readwrite'); tx.objectStore(LOJA).delete(chave); tx.oncomplete = () => res(); tx.onerror = () => res(); } catch { res(); } });
}

export const guardarPendente = (p: Pendente) => gravar('pendente', p);
export const lerPendente = () => ler<Pendente>('pendente');
export const apagarPendente = () => apagar('pendente');
export const guardarCache = (c: Omit<Cache, 'em'>) => gravar('cache', { ...c, em: new Date().toISOString() });
export const lerCache = () => ler<Cache>('cache');
