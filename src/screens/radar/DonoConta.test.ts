// CD-D5.1 — campo "Dono da conta" na ficha e filtro da carteira. Renderização estática (sem DOM) e guardas de fonte:
// a tela só projeta o estado de donoConta.ts e grava pela ação única do store; nenhuma regra paralela.
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AJUDA_DONO_CONTA, DonoConta, type UsuarioOpcaoDono } from './DonoConta';
import { FILTRO_SEM_DONO, correspondeFiltroDono } from '../../core/radar/donoConta';

const USUARIOS: UsuarioOpcaoDono[] = [
  { id: 'u-ana', nome: 'Ana Fictícia', ativo: true },
  { id: 'u-beto', nome: 'Beto Fictício', ativo: true },
  { id: 'u-ivo', nome: 'Ivo Inativo', ativo: false },
];
const html = (p: Partial<Parameters<typeof DonoConta>[0]> & { empresa: Parameters<typeof DonoConta>[0]['empresa'] }) =>
  renderToStaticMarkup(React.createElement(DonoConta, { usuarios: USUARIOS, podeEditar: true, onDefinir: () => {}, ...p }));
const opcoesDoSelect = (h: string) => [...h.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]);

describe('CD-D5.1 · campo Dono da conta (ficha da empresa)', () => {
  it('SEM_DONO: mostra "sem dono" e oferece só usuários ativos para definir', () => {
    const h = html({ empresa: { id: 'e1' } });
    expect(h).toContain('data-estado="SEM_DONO"');
    expect(h).toContain('sem dono');
    expect(h).toContain('Definir dono…');
    expect(opcoesDoSelect(h)).toEqual(['', 'u-ana', 'u-beto']); // Ivo inativo nunca é oferecido
    expect(h).not.toContain('Remover');
    expect(h).toContain(AJUDA_DONO_CONTA); // dono ≠ responsável de tarefa/oportunidade, dito na tela
  });

  it('COM_DONO: mostra o nome, oferece a troca (sem o dono atual) e a remoção', () => {
    const h = html({ empresa: { id: 'e1', commercialOwnerId: 'u-ana' } });
    expect(h).toContain('data-estado="COM_DONO"');
    expect(h).toContain('Ana Fictícia');
    expect(h).toContain('Trocar por…');
    expect(opcoesDoSelect(h)).toEqual(['', 'u-beto']);
    expect(h).toContain('>Remover</button>');
  });

  it('DONO_INATIVO: mostra o nome com a marca "inativo" e permite trocar ou remover', () => {
    const h = html({ empresa: { id: 'e1', commercialOwnerId: 'u-ivo' } });
    expect(h).toContain('data-estado="DONO_INATIVO"');
    expect(h).toContain('Ivo Inativo');
    expect(h).toContain('>inativo</span>');
    expect(opcoesDoSelect(h)).toEqual(['', 'u-ana', 'u-beto']);
    expect(h).toContain('>Remover</button>');
  });

  it('sem a permissão radar: só leitura, nenhum controle de escrita', () => {
    const h = html({ empresa: { id: 'e1', commercialOwnerId: 'u-ana' }, podeEditar: false });
    expect(h).toContain('Ana Fictícia');
    expect(h).not.toContain('<select');
    expect(h).not.toContain('<button');
  });

  it('conta mesclada: não oferece edição e aponta para a conta canônica', () => {
    const h = html({ empresa: { id: 'e2', commercialOwnerId: 'u-ana', mescladaEm: 'e1' } });
    expect(h).toContain('conta mesclada');
    expect(h).toContain('#/radar/empresas/e1');
    expect(h).not.toContain('<select');
    expect(h).not.toContain('<button');
  });
});

describe('CD-D5.1 · filtro da carteira por dono', () => {
  const contas = [
    { id: 'sem' },
    { id: 'ana', commercialOwnerId: 'u-ana' },
    { id: 'ivo', commercialOwnerId: 'u-ivo' },
    { id: 'fora', commercialOwnerId: 'u-de-outra-org' },
  ];
  const filtrar = (f: string) => contas.filter((c) => correspondeFiltroDono(c, f, USUARIOS)).map((c) => c.id);

  it('vazio = todas; "sem dono" = SEM_DONO e DONO_INATIVO; usuário = dono gravado (inclusive inativo)', () => {
    expect(filtrar('')).toEqual(['sem', 'ana', 'ivo', 'fora']);
    expect(filtrar(FILTRO_SEM_DONO)).toEqual(['sem', 'ivo', 'fora']);
    expect(filtrar('u-ana')).toEqual(['ana']);
    expect(filtrar('u-ivo')).toEqual(['ivo']); // a conta aparece para ser redistribuída
    expect(filtrar('u-beto')).toEqual([]);
  });
});

describe('CD-D5.1 · a tela não tem lógica paralela', () => {
  const semComentarios = (s: string) => s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*\*)/.test(l)).join('\n');
  const componente = semComentarios(readFileSync('src/screens/radar/DonoConta.tsx', 'utf8'));
  const ficha = readFileSync('src/screens/radar/Empresa.tsx', 'utf8');
  const carteira = readFileSync('src/screens/radar/Empresas.tsx', 'utf8');

  it('o componente só projeta: não lê o store, não grava, não reimplementa a validação', () => {
    for (const proibido of ['useStore', '../../data/store', 'actions.', 'motivosRecusaDono', 'commercial_owner_id']) expect(componente, proibido).not.toContain(proibido);
    expect(componente).toContain('estadoDonoConta(');
  });

  it('a ficha grava só pela ação única do store; a carteira filtra e conta pelo módulo do dono', () => {
    expect(ficha).toContain('actions.definirDonoContaRadar(e.id, usuarioId)');
    expect(ficha.match(/commercialOwnerId\s*[:=]/g) ?? []).toEqual([]); // nada escreve o campo direto
    expect(carteira).toContain('correspondeFiltroDono(e, dono, ds.usuarios)');
    expect(carteira).toContain('contasSemDonoValido(');
    expect(carteira).not.toContain('definirDonoContaRadar'); // a carteira é leitura
  });
});
