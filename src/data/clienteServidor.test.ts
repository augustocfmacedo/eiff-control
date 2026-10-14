// O cliente das funções Netlify precisa nascer no Node 20 sem WebSocket nativo (runtime das funções). Aqui o WebSocket
// global é escondido para simular o Node 20: o createClient puro recusa; o clienteServidor nasce e lê por HTTP.
import { readdirSync, readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { SemRealtime, clienteServidor } from './clienteServidor';

const g = globalThis as { WebSocket?: unknown };
let original: unknown;
beforeEach(() => { original = g.WebSocket; delete g.WebSocket; });
afterEach(() => { if (original !== undefined) g.WebSocket = original; });

describe('cliente do servidor sem WebSocket (Node 20)', () => {
  it('createClient puro recusa sem WebSocket nativo (o defeito que derrubou o widget)', () => {
    expect(() => createClient('https://exemplo.supabase.co', 'chave')).toThrow(/WebSocket/);
  });
  it('clienteServidor nasce e monta consultas por HTTP', () => {
    const c = clienteServidor('https://exemplo.supabase.co', 'chave');
    expect(typeof c.from('profile').select).toBe('function');
    expect(typeof c.rpc).toBe('function');
  });
  it('conectar realtime é erro explícito', () => {
    expect(() => new SemRealtime()).toThrow(/realtime não é usado/);
  });
  it('nenhuma função Netlify cria cliente Supabase direto (todas passam por clienteServidor)', () => {
    for (const f of readdirSync('netlify/functions').filter((x) => x.endsWith('.ts'))) {
      expect(readFileSync(`netlify/functions/${f}`, 'utf8'), f).not.toMatch(/\bcreateClient\s*\(/);
    }
  });
});
