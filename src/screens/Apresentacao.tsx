// Modo apresentacao do painel executivo: os mesmos numeros do motor (dashboard/carteira/posicao), em tipografia grande,
// um tema por slide, com a estrutura metalica 3D ao fundo. Para reuniao de diretoria: setas/espaco avancam, Esc sai,
// avanco automatico a cada 9 s, tela cheia quando o navegador permite. Nada aqui calcula: so apresenta.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { carteiraObras, dashboard, posicaoBancaria } from '../core/engine';
import { useStore } from '../data/store';
import { ProgressRow, money, pct } from '../ui/components';
import { Marca } from '../ui/icons';
import { CenaEstrutura, NumeroVivo, useEntrada } from '../ui/motion';

interface Sec { label: string; value: string; tone?: 'neg' | 'warn' | 'pos' }
interface Slide { rotulo: string; valor: string; tone?: 'neg' | 'warn' | 'pos'; dica: string; sec?: Sec[]; obras?: { codigo: string; execucao: number; margem: number }[]; alertas?: { nome: string; valor: string; critico?: boolean }[] }

export default function Apresentacao({ onSair }: { onSair: () => void }) {
  const { ds } = useStore();
  const slides = useMemo<Slide[]>(() => {
    const d = dashboard(ds); const carteira = carteiraObras(ds); const posicao = posicaoBancaria(ds);
    const saldoBancario = posicao.reduce((a, p) => a + p.saldoBancario, 0); const reserva = ds.params.reservaMinima;
    const alertas = [
      { nome: 'Recebíveis vencidos', valor: money(d.recebiveisVencidos, true), ok: d.recebiveisVencidos === 0 },
      { nome: 'Pagamentos vencidos', valor: money(d.pagamentosVencidos, true), ok: d.pagamentosVencidos === 0 },
      { nome: 'Realizados sem conciliação', valor: String(d.realizadosSemConciliacao), ok: d.realizadosSemConciliacao === 0 },
      { nome: 'Obras com margem negativa', valor: String(d.obrasMargemNegativa), ok: d.obrasMargemNegativa === 0, critico: true },
      { nome: 'Aprovações pendentes', valor: String(d.aprovacoesPendentes), ok: d.aprovacoesPendentes === 0 },
      { nome: 'Caixa abaixo da reserva (13S)', valor: money(d.menorSaldo13s, true), ok: d.menorSaldo13s >= reserva, critico: true },
    ].filter((a) => !a.ok);
    return [
      { rotulo: 'Caixa: saldo bancário hoje', valor: money(saldoBancario), tone: saldoBancario < 0 ? 'neg' : undefined, dica: `Projeção de 13 semanas com reserva mínima de ${money(reserva, true)}.`,
        sec: [{ label: 'Menor saldo 13S', value: money(d.menorSaldo13s, true), tone: d.menorSaldo13s < reserva ? 'neg' : 'pos' }, { label: 'Saldo final 13S', value: money(d.saldoFinal13s, true), tone: d.saldoFinal13s < 0 ? 'neg' : undefined }, { label: 'Necessidade vs. reserva', value: money(d.necessidadeMaxima, true), tone: d.necessidadeMaxima > 0 ? 'warn' : undefined }, { label: 'Próximos 7 dias', value: `${money(d.proximos7DiasEntradas, true)} / ${money(d.proximos7DiasSaidas, true)}` }] },
      { rotulo: 'Carteira de obras: margem projetada', valor: pct(d.margemCarteira), tone: d.margemCarteira < 0 ? 'neg' : d.margemCarteira < 0.1 ? 'warn' : 'pos', dica: `${d.obrasAtivas} obra(s) ativa(s) · ${d.obrasMargemNegativa} com margem negativa.`,
        sec: [{ label: 'Receita contratada', value: money(d.receitaContratada, true) }, { label: 'EAC da carteira', value: money(d.custoTotalProjetado, true) }, { label: 'Backlog a receber', value: money(d.backlog, true) }, { label: 'Saldo devedor', value: money(d.saldoDevedor, true), tone: d.saldoDevedor > 0 ? 'warn' : undefined }],
        obras: carteira.slice(0, 4).map((o) => ({ codigo: o.obra.codigo, execucao: o.execucaoFisica, margem: o.pctMargemProjetada })) },
      { rotulo: 'Compromissos das próximas 13 semanas', valor: money(d.entradas13s - d.saidas13s), tone: d.entradas13s - d.saidas13s < 0 ? 'neg' : 'pos', dica: 'Entradas menos saídas previstas no horizonte de 13 semanas.',
        sec: [{ label: 'Entradas 13S', value: money(d.entradas13s, true) }, { label: 'Saídas 13S', value: money(d.saidas13s, true) }, { label: 'Recebíveis vencidos', value: money(d.recebiveisVencidos, true), tone: d.recebiveisVencidos > 0 ? 'warn' : undefined }, { label: 'Pagamentos vencidos', value: money(d.pagamentosVencidos, true), tone: d.pagamentosVencidos > 0 ? 'neg' : undefined }, { label: 'Serviço da dívida / mês', value: money(d.servicoDividaMensal, true) }] },
      { rotulo: 'Alertas financeiros', valor: alertas.length ? `${alertas.length} em aberto` : 'tudo em ordem', tone: alertas.length ? (alertas.some((a) => a.critico) ? 'neg' : 'warn') : 'pos', dica: alertas.length ? 'Cada alerta aponta a origem do número no painel.' : 'Nenhum alerta pendente na data-base.', alertas },
    ];
  }, [ds]);
  const [i, setI] = useState(0);
  const slide = useRef<HTMLDivElement>(null); useEntrada(slide, i);
  const ir = (n: number) => setI((a) => (a + n + slides.length) % slides.length);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onSair(); else if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); ir(1); } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); ir(-1); } };
    window.addEventListener('keydown', onKey);
    const auto = setInterval(() => ir(1), 9000);
    const raiz = document.documentElement; raiz.requestFullscreen?.().catch(() => undefined);
    return () => { window.removeEventListener('keydown', onKey); clearInterval(auto); if (document.fullscreenElement) document.exitFullscreen?.().catch(() => undefined); };
  }, [slides.length]);
  const s = slides[i];
  return (
    <div className="apresentacao no-print" role="dialog" aria-label="Apresentação do painel executivo">
      <CenaEstrutura variante="apresentacao" />
      <div className="cabeca"><Marca size={22} /><span>Painel executivo · {ds.params.empresa} · data-base {ds.params.dataBase.split('-').reverse().join('/')} · cenário {ds.params.cenario}</span></div>
      <div className="slide" key={i} ref={slide} onClick={() => ir(1)}>
        <div className="rotulo">{s.rotulo}</div>
        <div className={`valor ${s.tone ?? ''}`}><NumeroVivo texto={s.valor} duracao={1.2} /></div>
        <div className="dica">{s.dica}</div>
        {s.sec && <div className="sec">{s.sec.map((x) => <div key={x.label}><div className="label">{x.label}</div><div className={`v ${x.tone ?? ''}`}><NumeroVivo texto={x.value} /></div></div>)}</div>}
        {s.obras && s.obras.length > 0 && <div className="obras">{s.obras.map((o) => <ProgressRow key={o.codigo} label={o.codigo} valor={o.execucao} texto={pct(o.margem)} tone={o.margem < 0 ? 'bad' : o.margem < 0.1 ? 'warn' : 'ok'} />)}</div>}
        {s.alertas && s.alertas.length > 0 && <div className="alertas">{s.alertas.map((a) => <span key={a.nome} className={`badge ${a.critico ? 'bad' : 'warn'}`}>{a.nome} · {a.valor}</span>)}</div>}
      </div>
      <div className="rodape">
        <span className="pontos">{slides.map((_, k) => <i key={k} className={k === i ? 'ativo' : ''} onClick={(e) => { e.stopPropagation(); setI(k); }} />)}</span>
        <span>{i + 1} / {slides.length} · setas ou espaço avançam · Esc sai</span>
        <button className="btn sm sair" onClick={onSair}>Sair da apresentação</button>
      </div>
    </div>
  );
}
