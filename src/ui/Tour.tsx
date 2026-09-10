// Tour guiado por tela: destaca (spotlight) os blocos da tela na ordem em que se le, com um texto curto por bloco. Os passos
// vem de um mapa por rota e, quando a rota nao tem passos proprios, da estrutura da pagina (cabecalho, indicadores, faixa,
// abas, tabela). A licao da Capacitacao da mesma rota entra como primeiro passo, com link. Abre uma vez por tela por navegador
// (chave eiff-control:tour:<rota>), pelo "?" da barra ou pela paleta. Setas e Esc no teclado; respeita prefers-reduced-motion.
import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { LICOES } from '../core/capacitacao';
import { navegar } from './router';

export interface PassoTour { seletor: string; titulo: string; texto: string }
const GERAL: PassoTour[] = [
  { seletor: '.content .page-head', titulo: 'Cabeçalho da tela', texto: 'Título, o que a tela faz e as ações principais à direita. Imprimir gera um relatório limpo.' },
  { seletor: '.content .hero-grid', titulo: 'Indicadores principais', texto: 'Os números que resumem a tela. Clique num cartão para ir à origem do número.' },
  { seletor: '.content .strip', titulo: 'Métricas de apoio', texto: 'Contexto rápido: cada item leva à lista que o explica.' },
  { seletor: '.content .filters, .content .row', titulo: 'Filtros', texto: 'Refine a lista. Salve combinações úteis como vistas para voltar a elas com um clique.' },
  { seletor: '.content .tabs', titulo: 'Abas', texto: 'A mesma entidade vista por ângulos diferentes: resumo, cronograma, serviços, materiais, produção, financeiro.' },
  { seletor: '.content .tabela, .content .table-wrap', titulo: 'Tabela', texto: 'Clique no cabeçalho para ordenar; linhas clicáveis abrem o detalhe; setas e Enter funcionam no teclado.' },
  { seletor: '.topbar .busca', titulo: 'Buscar ou ir para', texto: 'Ctrl+K abre a paleta: qualquer tela, ação ou registro (obra, lançamento, empresa, contato, orçamento) em poucas letras.' },
  { seletor: '.sidebar .nav', titulo: 'Menu', texto: 'Grupos recolhem ao clicar no título; a estrela fixa um item em Favoritos, no topo.' },
];
const POR_ROTA: Record<string, PassoTour[]> = {
  '/': [
    { seletor: '.content .page-head', titulo: 'Painel executivo', texto: 'A leitura de 1 minuto: caixa, carteira, compromissos e alertas na data-base. "Apresentar" abre o modo para reunião.' },
    { seletor: '.content .hero-grid .kpi:first-child', titulo: 'Caixa', texto: 'Saldo bancário hoje (só extrato) e a projeção de 13 semanas com a reserva mínima tracejada.' },
    { seletor: '.content .hero-grid .kpi:last-child', titulo: 'Carteira de obras', texto: 'Margem projetada da carteira; cada barra é a execução física de uma obra e o valor é a margem projetada.' },
    { seletor: '.content .strip', titulo: 'Compromissos', texto: 'Entradas e saídas das 13 semanas, vencidos e aprovações. Clique para abrir a lista.' },
    { seletor: '.content .grid .card:first-child', titulo: 'Alertas', texto: 'Cada alerta diz a ação esperada e aponta a tela onde ela acontece.' },
  ],
  '/fluxo13': [
    { seletor: '.content .grid', titulo: 'Semanas críticas', texto: 'Saldo inicial, final, menor saldo e necessidade máxima. Semana crítica pede plano de ação.' },
    { seletor: '.content .cenario', titulo: 'E se…', texto: 'Simule atraso de recebimentos, adiamento de pagamentos, corte de despesas e um novo contrato. Nada é gravado; a curva do cenário aparece contra a base.' },
    { seletor: '.content .card:nth-of-type(3), .content .table-wrap', titulo: 'Tabela do fluxo', texto: 'Clique numa célula para ver os lançamentos daquela semana.' },
  ],
  '/conciliacao': [
    { seletor: '.content .pares', titulo: 'Pares sugeridos', texto: 'Transações com um lançamento compatível por valor, data e histórico. Confira e concilie em um clique, ou todos os pares seguros de uma vez.' },
    { seletor: '.content .grid.cols-2 .card:first-child', titulo: 'Extrato', texto: 'Transação bancária é fato e não se edita. Arraste uma pendente até o lançamento certo para conciliar.' },
    { seletor: '.content .grid.cols-2 .card:last-child', titulo: 'Sugestões e vínculo', texto: 'Selecione uma transação para ver as sugestões com score. Fora da tolerância, a divergência exige justificativa.' },
  ],
  '/lancamentos': [
    { seletor: '.content .filters', titulo: 'Filtros e vistas', texto: 'Obra, categoria, status, situação e período. "Salvar vista" guarda a combinação com um nome.' },
    { seletor: '.content .tabela', titulo: 'Lançamentos', texto: 'Ordene por qualquer coluna; datas editáveis direto na linha; clique abre o detalhe com liquidação, alçada e auditoria.' },
  ],
  '/obras': [
    { seletor: '.content .tabs', titulo: 'Obra 360', texto: 'Resumo econômico, cronograma visual com curva S, serviços, materiais com a estrutura 3D, produção, financeiro e prazo.' },
  ],
  '/radar/hoje': [
    { seletor: '.content .page-head', titulo: 'Radar · Hoje', texto: 'A fila do dia por prioridade: vencidas primeiro, depois o score. Cada linha diz por que a empresa está aqui e a próxima ação.' },
  ],
  '/producao': [
    { seletor: '.content .page-head', titulo: 'Fábrica e montagem', texto: 'Apontamento por estação em kg, peças e horas. "Modo quiosque" leva o painel para a TV da fábrica.' },
  ],
};
export const chaveTour = (rota: string) => `eiff-control:tour:${rota.split('/').slice(0, 3).join('/') || '/'}`;
export const tourVisto = (rota: string) => { try { return localStorage.getItem(chaveTour(rota)) === '1'; } catch { return true; } };
export const marcarTourVisto = (rota: string) => { try { localStorage.setItem(chaveTour(rota), '1'); } catch { /* ignore */ } };

function passosDe(rota: string): PassoTour[] {
  const base = rota === '/' ? '/' : `/${rota.split('/')[1]}`; const chaveRota = POR_ROTA[rota] ? rota : POR_ROTA[base] ? base : '';
  const licao = LICOES.find((l) => l.rota === rota) ?? LICOES.find((l) => l.rota === base);
  const proprios = chaveRota ? POR_ROTA[chaveRota] : [];
  const todos = [...proprios, ...GERAL.filter((g) => !proprios.some((p) => p.seletor === g.seletor))];
  const existentes = todos.filter((p) => document.querySelector(p.seletor));
  if (licao) existentes.unshift({ seletor: '.content .page-head', titulo: licao.titulo, texto: `${licao.objetivo} A lição completa, com passos e verificação, está em Capacitação.|${licao.id}` });
  return existentes;
}

export function Tour({ rota, aberto, onFechar }: { rota: string; aberto: boolean; onFechar: () => void }) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const passos = useMemo(() => (aberto ? passosDe(rota) : []), [aberto, rota]);
  const passo = passos[i];
  useEffect(() => { if (aberto) { setI(0); marcarTourVisto(rota); } }, [aberto, rota]);
  useLayoutEffect(() => {
    if (!aberto || !passo) return;
    const el = document.querySelector(passo.seletor); if (!el) { setRect(null); return; }
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const medir = () => setRect(el.getBoundingClientRect());
    const t = setTimeout(medir, 350); medir();
    window.addEventListener('resize', medir); window.addEventListener('scroll', medir, true);
    return () => { clearTimeout(t); window.removeEventListener('resize', medir); window.removeEventListener('scroll', medir, true); };
  }, [aberto, passo]);
  useEffect(() => {
    if (!aberto) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onFechar(); else if (e.key === 'ArrowRight' || e.key === 'Enter') setI((x) => Math.min(passos.length - 1, x + 1)); else if (e.key === 'ArrowLeft') setI((x) => Math.max(0, x - 1)); };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [aberto, passos.length, onFechar]);
  if (!aberto || !passo) return null;
  const pad = 8; const r = rect;
  const [texto, licaoId] = passo.texto.split('|');
  const abaixo = r ? r.bottom + 12 + 180 < window.innerHeight : true;
  const estiloCartao: React.CSSProperties = r ? { left: Math.max(12, Math.min(window.innerWidth - 372, r.left)), top: abaixo ? r.bottom + 12 : Math.max(12, r.top - 12 - 190) } : { left: '50%', top: '40%', transform: 'translateX(-50%)' };
  return (
    <div className="tour" role="dialog" aria-label="Tour da tela" onClick={onFechar}>
      {r && <div className="tour-foco" style={{ left: r.left - pad, top: r.top - pad, width: r.width + pad * 2, height: r.height + pad * 2 }} onClick={(e) => e.stopPropagation()} />}
      <div className="tour-cartao card" style={estiloCartao} onClick={(e) => e.stopPropagation()}>
        <div className="small muted">{i + 1} / {passos.length}</div>
        <h2>{passo.titulo}</h2>
        <p className="small">{texto}</p>
        {licaoId && <button className="btn sm" onClick={() => { onFechar(); navegar(`/capacitacao/${licaoId}`); }}>Ver lição</button>}
        <div className="actions" style={{ marginTop: 10 }}>
          <button className="btn sm" onClick={onFechar}>Fechar</button>
          <span style={{ flex: 1 }} />
          <button className="btn sm" disabled={i === 0} onClick={() => setI(i - 1)}>← Anterior</button>
          {i < passos.length - 1 ? <button className="btn sm primary" onClick={() => setI(i + 1)}>Próximo →</button> : <button className="btn sm primary" onClick={onFechar}>Concluir</button>}
        </div>
      </div>
    </div>
  );
}
