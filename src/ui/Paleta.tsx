// Paleta de comandos (Ctrl+K / Cmd+K): navega para qualquer tela, executa acoes do sistema e busca obras, lancamentos,
// empresas e contatos do Radar e orcamentos. Teclado: setas, Enter, Esc. Recentes lembrados por navegador.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../data/store';
import { buscar } from './busca';
import { Icon, type IconName } from './icons';
import { navegar } from './router';
import { registrarAcao } from '../data/telemetria';

export interface AcaoPaleta { id: string; rotulo: string; sub?: string; icone?: IconName; executar: () => void }
interface Item { id: string; grupo: string; rotulo: string; sub?: string; icone: IconName; rota?: string; chaveBusca: string; executar: () => void }

/** Telas do sistema (mesma lista da barra lateral; manter alinhada ao App). */
export const ROTAS_NAV: { to: string; rotulo: string; grupo: string; icone: IconName; permissao?: string }[] = [
  { to: '/', rotulo: 'Painel executivo', grupo: 'Início', icone: 'painel' }, { to: '/inbox', rotulo: 'Minha caixa de entrada', grupo: 'Início', icone: 'inbox' }, { to: '/capacitacao', rotulo: 'Capacitação', grupo: 'Início', icone: 'capacitacao' },
  { to: '/central', rotulo: 'Central de obras', grupo: 'Obras', icone: 'central' }, { to: '/obras', rotulo: 'Obras e contratos', grupo: 'Obras', icone: 'obras' }, { to: '/orcamentos', rotulo: 'Orçamentos e composições', grupo: 'Obras', icone: 'orcamento' },
  { to: '/producao', rotulo: 'Fábrica e montagem', grupo: 'Obras', icone: 'fabrica' }, { to: '/estoque', rotulo: 'Estoque de aço', grupo: 'Obras', icone: 'estoque' }, { to: '/equipe', rotulo: 'Equipe e produtividade', grupo: 'Obras', icone: 'equipe' }, { to: '/campo', rotulo: 'Modo campo (celular)', grupo: 'Obras', icone: 'campo' },
  { to: '/radar', rotulo: 'Radar · Command Center', grupo: 'Comercial', icone: 'radar' }, { to: '/radar/hoje', rotulo: 'Radar · Hoje', grupo: 'Comercial', icone: 'hoje' }, { to: '/radar/empresas', rotulo: 'Radar · Empresas', grupo: 'Comercial', icone: 'empresas' },
  { to: '/compras', rotulo: 'Compras e pedidos', grupo: 'Financeiro', icone: 'compras' }, { to: '/pagar', rotulo: 'Contas a pagar', grupo: 'Financeiro', icone: 'pagar' }, { to: '/receber', rotulo: 'Contas a receber', grupo: 'Financeiro', icone: 'receber' }, { to: '/lancamentos', rotulo: 'Lançamentos', grupo: 'Financeiro', icone: 'lancamentos' }, { to: '/aprovacoes', rotulo: 'Central de aprovações', grupo: 'Financeiro', icone: 'aprovacoes' },
  { to: '/posicao', rotulo: 'Posição diária', grupo: 'Tesouraria', icone: 'banco', permissao: 'ver_bancos' }, { to: '/fluxo13', rotulo: 'Fluxo 13 semanas', grupo: 'Tesouraria', icone: 'fluxo' }, { to: '/fluxo24', rotulo: 'Fluxo 24 meses', grupo: 'Tesouraria', icone: 'calendario' }, { to: '/conciliacao', rotulo: 'Bancos e conciliação', grupo: 'Tesouraria', icone: 'conciliacao', permissao: 'ver_bancos' }, { to: '/dividas', rotulo: 'Dívidas', grupo: 'Tesouraria', icone: 'dividas', permissao: 'ver_bancos' },
  { to: '/dre', rotulo: 'DRE gerencial', grupo: 'Controladoria', icone: 'dre' }, { to: '/checks', rotulo: 'Checks e fechamento', grupo: 'Controladoria', icone: 'checks' },
  { to: '/cadastros', rotulo: 'Cadastros e parâmetros', grupo: 'Administração', icone: 'cadastros' }, { to: '/auditoria', rotulo: 'Auditoria', grupo: 'Administração', icone: 'auditoria', permissao: 'ver_auditoria' },
];

const RECENTES = 'eiff-control:paleta-recentes';
const lerRecentes = (): string[] => { try { return JSON.parse(localStorage.getItem(RECENTES) ?? '[]') as string[]; } catch { return []; } };
const gravarRecente = (id: string) => { try { localStorage.setItem(RECENTES, JSON.stringify([id, ...lerRecentes().filter((x) => x !== id)].slice(0, 6))); } catch { /* ignore */ } };

export function Paleta({ aberta, onFechar, acoes, permite }: { aberta: boolean; onFechar: () => void; acoes: AcaoPaleta[]; permite: (p: string) => boolean }) {
  const { ds } = useStore();
  const [q, setQ] = useState(''); const [idx, setIdx] = useState(0);
  const input = useRef<HTMLInputElement>(null); const lista = useRef<HTMLDivElement>(null);
  const fechar = () => { onFechar(); setQ(''); setIdx(0); };
  const executar = (it: Item) => { gravarRecente(it.id); registrarAcao(`paleta:${it.grupo === 'Ações' ? it.id : it.grupo.toLowerCase()}`); fechar(); it.executar(); };
  const base = useMemo<Item[]>(() => {
    const nav: Item[] = ROTAS_NAV.filter((r) => !r.permissao || permite(r.permissao)).map((r) => ({ id: `nav:${r.to}`, grupo: 'Navegação', rotulo: r.rotulo, sub: r.grupo, icone: r.icone, rota: r.to, chaveBusca: `${r.rotulo} ${r.grupo}`, executar: () => navegar(r.to) }));
    const acs: Item[] = acoes.map((a) => ({ id: `acao:${a.id}`, grupo: 'Ações', rotulo: a.rotulo, sub: a.sub, icone: a.icone ?? 'checks', chaveBusca: `${a.rotulo} ${a.sub ?? ''}`, executar: a.executar }));
    const obras: Item[] = ds.obras.map((o) => ({ id: `obra:${o.codigo}`, grupo: 'Obras', rotulo: `${o.codigo} · ${o.nome}`, sub: `${o.cliente} · ${o.status}`, icone: 'obras', rota: `/obras/${o.codigo}`, chaveBusca: `${o.codigo} ${o.nome} ${o.cliente} ${o.cidadeUf}`, executar: () => navegar(`/obras/${o.codigo}`) }));
    const lancs: Item[] = ds.lancamentos.filter((l) => l.status !== 'Cancelado').map((l) => ({ id: `lanc:${l.id}`, grupo: 'Lançamentos', rotulo: `${l.id} · ${l.descricao || l.categoria}`, sub: `${l.contraparte}${l.codigoObra ? ` · ${l.codigoObra}` : ''} · venc. ${l.vencimento.split('-').reverse().join('/')}`, icone: 'lancamentos', rota: `/lancamentos/${l.id}`, chaveBusca: `${l.id} ${l.descricao} ${l.contraparte} ${l.documento} ${l.categoria} ${l.codigoObra}`, executar: () => navegar(`/lancamentos/${l.id}`) }));
    const r = ds.radar;
    const empresas: Item[] = (r?.empresas ?? []).filter((e) => e.ativo).map((e) => ({ id: `emp:${e.id}`, grupo: 'Radar', rotulo: e.nomeFantasia ?? e.razaoSocial, sub: `${[e.cidade, e.uf].filter(Boolean).join('/')}${e.setor ? ` · ${e.setor}` : ''}`, icone: 'empresas', rota: `/radar/empresas/${e.id}`, chaveBusca: `${e.razaoSocial} ${e.nomeFantasia ?? ''} ${e.cnpj ?? ''} ${e.cidade ?? ''} ${e.setor ?? ''}`, executar: () => navegar(`/radar/empresas/${e.id}`) }));
    const contatos: Item[] = (r?.contatos ?? []).filter((c) => c.ativo).map((c) => { const e = r?.empresas.find((x) => x.id === c.empresaId); return { id: `con:${c.id}`, grupo: 'Radar', rotulo: c.nome, sub: `${c.cargo ?? ''}${e ? ` · ${e.nomeFantasia ?? e.razaoSocial}` : ''}`, icone: 'equipe', rota: `/radar/empresas/${c.empresaId}`, chaveBusca: `${c.nome} ${c.cargo ?? ''} ${e?.razaoSocial ?? ''}`, executar: () => navegar(`/radar/empresas/${c.empresaId}`) }; });
    const orcs: Item[] = ds.orcamentos.map((o) => ({ id: `orc:${o.id}`, grupo: 'Orçamentos', rotulo: `${o.codigo} · ${o.titulo}`, sub: `${o.cliente} · ${o.status}`, icone: 'orcamento', rota: `/orcamentos/${o.id}`, chaveBusca: `${o.codigo} ${o.titulo} ${o.cliente}`, executar: () => navegar(`/orcamentos/${o.id}`) }));
    return [...nav, ...acs, ...obras, ...lancs, ...empresas, ...contatos, ...orcs];
  }, [ds, acoes, permite]);
  const resultados = useMemo<Item[]>(() => {
    const termo = q.trim();
    if (!termo) {
      const rec = lerRecentes().map((id) => base.find((b) => b.id === id)).filter((x): x is Item => !!x).map((x) => ({ ...x, grupo: 'Recentes' }));
      return [...rec, ...base.filter((b) => b.grupo === 'Navegação' || b.grupo === 'Ações').slice(0, 12)];
    }
    const grupos = ['Navegação', 'Ações', 'Obras', 'Lançamentos', 'Radar', 'Orçamentos'];
    return grupos.flatMap((g) => buscar(base.filter((b) => b.grupo === g), termo, g === 'Navegação' || g === 'Ações' ? 6 : termo.length >= 2 ? 5 : 0));
  }, [q, base]);
  useEffect(() => { if (aberta) { setTimeout(() => input.current?.focus(), 0); } }, [aberta]);
  useEffect(() => { setIdx(0); }, [q]);
  useEffect(() => { lista.current?.querySelector<HTMLElement>('.item.ativo')?.scrollIntoView({ block: 'nearest' }); }, [idx, resultados]);
  if (!aberta) return null;
  const tecla = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(resultados.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); const it = resultados[idx]; if (it) executar(it); }
    else if (e.key === 'Escape') { e.preventDefault(); fechar(); }
  };
  let grupoAnterior = '';
  return (
    <div className="paleta-bg" onMouseDown={fechar} role="dialog" aria-label="Paleta de comandos">
      <div className="paleta" onMouseDown={(e) => e.stopPropagation()} onKeyDown={tecla}>
        <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ir para uma tela, executar uma ação ou buscar obra, lançamento, empresa, contato…" aria-label="Buscar" autoComplete="off" spellCheck={false} />
        <div className="lista" ref={lista} role="listbox">
          {resultados.length === 0 && <div className="grupo">Nada encontrado para "{q}"</div>}
          {resultados.map((it, i) => {
            const cab = it.grupo !== grupoAnterior ? <div className="grupo" key={`g-${it.grupo}-${i}`}>{it.grupo}</div> : null; grupoAnterior = it.grupo;
            return (
              <React.Fragment key={it.id + i}>
                {cab}
                <div className={`item ${i === idx ? 'ativo' : ''}`} role="option" aria-selected={i === idx} onMouseEnter={() => setIdx(i)} onClick={() => executar(it)}>
                  <span className="ico"><Icon name={it.icone} size={15} /></span>
                  <span className="txt">{it.rotulo}{it.sub && <span className="sub">{it.sub}</span>}</span>
                  {it.rota && <span className="rota">{it.rota}</span>}
                </div>
              </React.Fragment>
            );
          })}
        </div>
        <div className="rodape"><span><kbd>↑</kbd> <kbd>↓</kbd> navegar</span><span><kbd>Enter</kbd> abrir</span><span><kbd>Esc</kbd> fechar</span><span style={{ marginLeft: 'auto' }}>{base.length.toLocaleString('pt-BR')} itens indexados</span></div>
      </div>
    </div>
  );
}
