// CD-D3/E5 — Metas e resultados no Command Center: a tela só apresenta o bloco metaComercial do snapshot CD-1.3.
//
// Prova: paridade tela × snapshot (cada número é o da medida, "—" com o motivo quando indisponível, nunca 0), os 11
// estados da tela, mês e instante em São Paulo, permissões de leitura/escrita, render estático dos estados principais
// e guardas estáticas (a tela não calcula, não escreve no banco e só muda meta pela ação canônica confirmada).
import fs from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { snapshotComercialCD, type BlocoMetaComercialCD, type OpcoesSnapshotCD } from '../../core/radar/commercialDirector';
import type { RadarDataset } from '../../core/radar/types';
import type { Usuario } from '../../core/types';
import { AGORA_CD13, DESFECHOS_CD13, HOJE_CD13, METAS_CD13, ganho, meta, mundoCD13 } from '../../core/radar/__fixtures__/cdMetaComercial';
import { ESTADOS_TELA_META, edicaoMeta, estadoTelaMeta, mesesDoSeletor, rotuloInstante, rotuloMes, visaoMetaComercial, type EstadoTelaMeta } from './metaResultadoVisao';
import { PainelMetaComercial } from './MetasResultados';

const bloco = (r: RadarDataset = mundoCD13(), o: OpcoesSnapshotCD = {}): BlocoMetaComercialCD =>
  snapshotComercialCD(r, HOJE_CD13, { agoraIso: AGORA_CD13, ...o }).metaComercial;
const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const PCT = new Intl.NumberFormat('pt-BR', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 });
const usuario = (papel: Usuario['papel']): Usuario => ({ id: `u-${papel}`, nome: papel, email: 'x@eiff.test', papel, obras: '*', ativo: true });
const semComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const CODIGO_VISAO = semComentarios(fs.readFileSync('src/screens/radar/metaResultadoVisao.ts', 'utf8'));
const CODIGO_PAINEL = semComentarios(fs.readFileSync('src/screens/radar/MetasResultados.tsx', 'utf8'));
const CODIGO_CC = semComentarios(fs.readFileSync('src/screens/radar/CommandCenter.tsx', 'utf8'));

/** Um mundo por estado da tela (fictício; nunca números de produção). */
const ESTADOS: Record<EstadoTelaMeta, () => BlocoMetaComercialCD> = {
  SEM_INSTANTE: () => snapshotComercialCD(mundoCD13(), HOJE_CD13, {}).metaComercial,
  METAS_INDISPONIVEIS: () => bloco({ ...mundoCD13(), metasComerciais: undefined }),
  LIVRO_INDISPONIVEL: () => bloco({ ...mundoCD13(), desfechos: undefined }),
  MES_FUTURO: () => bloco(mundoCD13(), { mesComercial: '2026-11' }),
  SEM_META: () => bloco(mundoCD13(), { mesComercial: '2026-08' }),
  META_RETIRADA: () => bloco({ ...mundoCD13(), metasComerciais: [...METAS_CD13, meta('MO3', '2026-10', null, 3, '2026-10-13T12:00:00.000Z')] }),
  META_INVALIDA: () => bloco({ ...mundoCD13(), metasComerciais: [meta('MOX', '2026-10', '-5', 1, '2026-10-01T12:00:00.000Z')] }),
  VALOR_INCOMPLETO: () => bloco({ ...mundoCD13(), desfechos: [...DESFECHOS_CD13, ganho('G6', 'O1', 'E6', '2026-10-09T12:00:00.000000+00:00')] }),
  SEM_VENDAS: () => bloco({ ...mundoCD13(), desfechos: [] }),
  PARCIAL: () => bloco(),
  ATINGIDA: () => bloco(mundoCD13(), { mesComercial: '2026-09' }),
};

describe('E5 · estados da tela', () => {
  for (const e of ESTADOS_TELA_META) {
    it(`${e}: o modelo reconhece o estado`, () => expect(estadoTelaMeta(ESTADOS[e]())).toBe(e));
  }

  it('indisponível nunca vira zero: cada valor "—" carrega o motivo da medida', () => {
    const afetados = { SEM_INSTANTE: (v: ReturnType<typeof visaoMetaComercial>) => [v.meta, v.receitaLiquida, v.atingimento, v.diferenca.valor, v.ganhos, v.estornos],
      METAS_INDISPONIVEIS: (v: ReturnType<typeof visaoMetaComercial>) => [v.meta, v.atingimento, v.diferenca.valor],
      LIVRO_INDISPONIVEL: (v: ReturnType<typeof visaoMetaComercial>) => [v.receitaLiquida, v.atingimento, v.diferenca.valor, v.ganhos, v.estornos, v.ganhosSemValor] };
    for (const e of ['SEM_INSTANTE', 'METAS_INDISPONIVEIS', 'LIVRO_INDISPONIVEL'] as const) {
      const v = visaoMetaComercial(ESTADOS[e]());
      for (const x of afetados[e](v)) {
        expect(x.texto, `${e} ${x.medidaId}`).toBe('—');
        expect(x.motivo, `${e} ${x.medidaId}`).toBeTruthy();
      }
    }
    expect(visaoMetaComercial(ESTADOS.LIVRO_INDISPONIVEL()).meta.texto).toBe(BRL.format(250000)); // a meta continua
    expect(visaoMetaComercial(ESTADOS.METAS_INDISPONIVEIS()).receitaLiquida.texto).toBe(BRL.format(114999.6)); // o realizado continua
    expect(visaoMetaComercial(ESTADOS.SEM_META()).meta).toMatchObject({ texto: '—', motivo: 'sem meta definida para o mês' });
  });

  it('meta vigente e nenhuma venda: zero de verdade (livro carregado e vazio)', () => {
    const v = visaoMetaComercial(ESTADOS.SEM_VENDAS());
    expect([v.receitaLiquida.texto, v.ganhos.texto, v.atingimento.texto, v.diferenca.rotulo, v.diferenca.valor.texto]).toEqual([BRL.format(0), '0', PCT.format(0), 'Falta para a meta', BRL.format(250000)]);
  });

  it('ganhos com valor incompleto: líquido "—" com motivo e o piso conhecido à parte', () => {
    const v = visaoMetaComercial(ESTADOS.VALOR_INCOMPLETO());
    expect(v.receitaLiquida.texto).toBe('—');
    expect(v.receitaLiquida.motivo).toMatch(/realizado incompleto/);
    expect(v.pisoConhecido?.texto).toBe(BRL.format(114999.6));
    expect(v.ganhosSemValor.texto).toBe('1');
  });

  it('atingida mostra o excedente; parcial mostra a falta', () => {
    expect(visaoMetaComercial(ESTADOS.ATINGIDA()).diferenca).toMatchObject({ rotulo: 'Excedente', valor: { texto: BRL.format(55000.75) } });
    expect(visaoMetaComercial(ESTADOS.PARCIAL()).diferenca).toMatchObject({ rotulo: 'Falta para a meta', valor: { texto: BRL.format(135000.4) } });
  });
});

describe('E5 · paridade tela × snapshot CD-1.3', () => {
  it('cada número da tela é exatamente a medida do bloco (formatada), em todos os estados', () => {
    for (const e of ESTADOS_TELA_META) {
      const b = ESTADOS[e](); const v = visaoMetaComercial(b); const m = b.medidas;
      const confere = (x: { texto: string; disponivel: boolean; motivo?: string; medidaId: string }, med: typeof m.meta, fmt: (n: number) => string) => {
        expect(x.medidaId, e).toBe(med.id);
        if (med.estado === 'DISPONIVEL') expect([x.texto, x.disponivel], `${e} ${med.id}`).toEqual([fmt(med.valor!), true]);
        else expect([x.texto, x.disponivel, x.motivo], `${e} ${med.id}`).toEqual(['—', false, med.motivoInsuficiencia]);
      };
      confere(v.meta, m.meta, BRL.format); confere(v.receitaLiquida, m.realizado, BRL.format); confere(v.atingimento, m.atingimento, PCT.format);
      confere(v.ganhos, m.ganhos, String); confere(v.ganhosSemValor, m.ganhosSemValor, String); confere(v.estornos, m.estornos, String);
      confere(v.valorEstornos, m.valorEstornos, BRL.format); confere(v.receitaGanha, m.valorGanhos, BRL.format);
      confere(v.retificacoes, m.retificacoes, String); confere(v.eventosInconsistentes, m.eventosInconsistentes, String);
      confere(v.diferenca.valor, v.diferenca.rotulo === 'Excedente' ? m.excedente : m.faltaParaMeta, BRL.format);
      if (v.barra !== undefined) expect(v.barra).toBe(Math.max(0, Math.min(1, m.atingimento.valor!)));
      else expect(m.atingimento.estado).not.toBe('DISPONIVEL');
    }
  });

  it('a tela não calcula: o modelo e o painel não importam o motor nem fazem conta de dinheiro', () => {
    for (const proibido of ['apurarMetaComercial', 'lerLivroDesfechos', 'centavosDoGanho', 'metaVigenteDoMes', 'lerValor', '.reduce(', 'radar.desfechos', 'metasComerciais'])
      expect(CODIGO_VISAO + CODIGO_PAINEL, proibido).not.toContain(proibido);
    expect(CODIGO_PAINEL).not.toMatch(/supabase|\.rpc\(|from\('radar_commercial_goal'\)|persistir/);
  });
});

describe('E5 · referência temporal (America/Sao_Paulo)', () => {
  it('o instante aparece no fuso comercial, nunca no da máquina', () => {
    expect(rotuloInstante('2026-10-14T18:00:00Z')).toBe('14/10/2026 15:00 (horário de São Paulo)');
    expect(rotuloInstante('2026-11-01T02:30:00Z')).toBe('31/10/2026 23:30 (horário de São Paulo)');
    expect(rotuloInstante('ontem')).toBe('—');
  });

  it('o seletor parte do mês do instante em São Paulo, com 3 futuros e 12 passados, inclusive na virada de ano', () => {
    const m = mesesDoSeletor('2026-11-01T02:00:00Z'); // 31/10 23h em SP
    expect([m.length, m[0], m[3], m[m.length - 1]]).toEqual([16, '2027-01', '2026-10', '2025-10']);
    expect(mesesDoSeletor('2027-01-01T02:59:59Z')).toContain('2026-12');
    expect(mesesDoSeletor('2027-01-01T03:00:00Z')[3]).toBe('2027-01');
    expect(rotuloMes('2026-10')).toBe('outubro de 2026');
  });

  it('a tela captura UM instante e passa o mesmo agoraIso e o mês escolhido ao snapshot', () => {
    expect(CODIGO_CC).toMatch(/useState\(\(\) => new Date\(\)\.toISOString\(\)\)/);
    expect(CODIGO_CC).toMatch(/snapshotComercialCD\(r, hoje, \{ limiteReferencias: 5, agoraIso, \.\.\.\(mesMeta \? \{ mesComercial: mesMeta \} : \{\}\) \}\)/);
    expect(CODIGO_CC.match(/snapshotComercialCD\(/g)?.length).toBe(1);
  });
});

describe('E5 · permissões e edição', () => {
  const corrente = bloco(); const encerrado = bloco(mundoCD13(), { mesComercial: '2026-09' });
  it('Administrador e Diretoria editam o mês corrente; retirar só com meta vigente', () => {
    for (const p of ['Administrador', 'Diretoria'] as const) expect(edicaoMeta(usuario(p), corrente)).toEqual({ podeVer: true, podeEditar: true, podeRetirar: true });
    expect(edicaoMeta(usuario('Administrador'), ESTADOS.SEM_META()).podeEditar).toBe(false); // agosto é encerrado
    expect(edicaoMeta(usuario('Administrador'), ESTADOS.META_RETIRADA())).toEqual({ podeVer: true, podeEditar: true, podeRetirar: false });
    expect(edicaoMeta(usuario('Administrador'), ESTADOS.MES_FUTURO())).toEqual({ podeVer: true, podeEditar: true, podeRetirar: true });
  });
  it('mês encerrado, metas ou instante indisponíveis: ninguém edita', () => {
    expect(edicaoMeta(usuario('Administrador'), encerrado)).toMatchObject({ podeEditar: false, motivo: 'Mês encerrado: a meta não muda mais.' });
    expect(edicaoMeta(usuario('Administrador'), ESTADOS.METAS_INDISPONIVEIS()).podeEditar).toBe(false);
    expect(edicaoMeta(usuario('Administrador'), ESTADOS.SEM_INSTANTE()).podeEditar).toBe(false);
  });
  it('demais papéis do Radar só leem', () => {
    for (const p of ['Financeiro', 'Gestor de obra', 'Engenharia', 'Compras'] as const) {
      const e = edicaoMeta(usuario(p), corrente);
      expect([e.podeEditar, e.podeRetirar, e.motivo]).toEqual([false, false, 'Somente Administrador e Diretoria definem metas.']);
    }
  });
  it('a mudança de meta passa SÓ pela ação canônica confirmada', () => {
    expect(CODIGO_CC).toContain('actions.definirMetaComercialConfirmada(blocoMeta.mes!, valor, motivo)');
    expect(CODIGO_CC).not.toMatch(/definirMetaComercialRadar|radar_definir_meta_comercial|radar_commercial_goal/);
  });
});

describe('E5 · render dos estados principais', () => {
  const html = (e: EstadoTelaMeta, p: Usuario['papel'] = 'Administrador', aviso?: { tom: 'ok' | 'warn' | 'bad'; texto: string }) => {
    const b = ESTADOS[e]();
    return renderToStaticMarkup(React.createElement(PainelMetaComercial, { bloco: b, versoes: [], meses: mesesDoSeletor(AGORA_CD13), agoraIso: AGORA_CD13, edicao: edicaoMeta(usuario(p), b), aviso, onMes: () => undefined, onAtualizar: () => undefined, onDefinir: () => undefined, onRetirar: () => undefined }));
  };
  it('parcial: valores do snapshot, instante visível e ações do Administrador', () => {
    const h = html('PARCIAL');
    for (const t of ['Metas e resultados', 'Meta parcialmente atingida', 'Retrato de 14/10/2026 15:00 (horário de São Paulo)', 'Receita ganha líquida', 'Revisar meta', 'Retirar meta', 'Detalhes']) expect(h).toContain(t);
    for (const t of ['114.999,60', '250.000,00', '135.000,40']) expect(h).toContain(t); // líquido, meta e falta do snapshot
  });
  it('livro indisponível e sem permissão: "—", motivo, e nada de botão de edição', () => {
    const h = html('LIVRO_INDISPONIVEL', 'Compras');
    expect(h).toContain('Livro de desfechos indisponível');
    expect(h).toContain('livro de desfechos não carregado');
    expect(h).toContain('Somente Administrador e Diretoria definem metas.');
    expect(h).not.toContain('Revisar meta');
    expect(h).not.toMatch(/R\$(\s|&nbsp;)0,00/);
  });
  it('sem meta e erro de persistência: aviso em alerta, sem falso sucesso', () => {
    const h = html('SEM_VENDAS', 'Administrador', { tom: 'bad', texto: 'O banco não confirmou a meta; nada foi gravado.' });
    expect(h).toContain('role="alert"');
    expect(h).toContain('O banco não confirmou a meta; nada foi gravado.');
    expect(html('SEM_META')).toContain('Sem meta definida');
  });
  it('estilos responsivos do painel existem (celular e iPad)', () => {
    const css = fs.readFileSync('src/styles.css', 'utf8');
    expect(css).toMatch(/\.meta-detalhes-corpo \{[^}]*auto-fit/);
    expect(css).toMatch(/@media \(max-width: 640px\) \{\s*\.meta-cabecalho select/);
  });
});
