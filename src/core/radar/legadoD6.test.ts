// D-6 (Commercial Director 1.0, decisão fechada em 30/09/2026): a fila do dia legada e o resumo legado do Radar foram
// removidos fisicamente. A fila comercial é a Commercial Queue (CM1-A) e as medidas são as do snapshot canônico (CD-1).
// Esta guarda impede que os nomes voltem ao código de produção, aos scripts e às funções Netlify.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as indice from './index';
import * as pipeline from './pipeline';

const LEGADO = ['filaHoje', 'resumoRadar', 'ResumoRadar'] as const;
const PADRAO = /\b(filaHoje|resumoRadar|ResumoRadar)\b/;
const EXTENSOES = /\.(ts|tsx|mts|mjs|cjs|js)$/;
const RAIZES = ['src', 'scripts', 'netlify'];
// commercialDirector.ts é escopo protegido na D-6 e cita os nomes só no comentário de cabeçalho que registra a decisão.
const SO_COMENTARIO = new Set(['src/core/radar/commercialDirector.ts']);

function arquivos(dir: string): string[] {
  const saida: string[] = [];
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) { if (nome !== 'node_modules' && nome !== '__fixtures__') saida.push(...arquivos(caminho)); continue; }
    if (EXTENSOES.test(nome) && !/\.test\.tsx?$/.test(nome)) saida.push(caminho.replace(/\\/g, '/'));
  }
  return saida;
}
const semComentarios = (codigo: string) => codigo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
const FONTES = RAIZES.flatMap(arquivos);

describe('D-6 · legado removido', () => {
  it('a varredura cobre produção, scripts e funções Netlify', () => {
    expect(FONTES.length).toBeGreaterThan(100);
    for (const raiz of RAIZES) expect(FONTES.some((f) => f.startsWith(`${raiz}/`)), raiz).toBe(true);
    expect(FONTES).toContain('src/screens/radar/CommandCenter.tsx');
    expect(FONTES).toContain('scripts/radar-registrar-sinal-producao.mts');
  });

  it('zero ocorrência dos nomes legados fora de testes (o cabeçalho protegido do CD-1 só em comentário)', () => {
    const achados = FONTES.filter((f) => PADRAO.test(SO_COMENTARIO.has(f) ? semComentarios(readFileSync(f, 'utf8')) : readFileSync(f, 'utf8')));
    expect(achados).toEqual([]);
  });

  it('pipeline e o índice do Radar não exportam mais o legado; leitura por empresa segue disponível', () => {
    for (const nome of LEGADO) {
      expect(Object.keys(pipeline), nome).not.toContain(nome);
      expect(Object.keys(indice), nome).not.toContain(nome);
    }
    for (const mantido of ['lerEmpresa', 'recomendarAcao']) expect(Object.keys(pipeline), mantido).toContain(mantido);
  });

  it('o Command Center lê a Commercial Queue e o snapshot canônico, sem score nem ordenação própria', () => {
    const codigo = readFileSync('src/screens/radar/CommandCenter.tsx', 'utf8');
    expect(codigo).toContain('snapshotComercialCD(');
    expect(codigo).toContain('cd.commercialQueue.referencias');
    expect(codigo).not.toMatch(/\bpriorityScore\b|pipelinePonderado|ScorePill/);
    // topo (heróis e faixa) e aba Visão geral: nada de ordenação na tela; a ordem é a da Commercial Queue
    const inicio = codigo.indexOf('  return (');
    const fim = codigo.indexOf("{aba === 'alertas'");
    expect(inicio).toBeGreaterThan(0); expect(fim).toBeGreaterThan(inicio);
    expect(codigo.slice(inicio, fim)).not.toMatch(/\.sort\(|\.reverse\(|toSorted/);
  });
});
