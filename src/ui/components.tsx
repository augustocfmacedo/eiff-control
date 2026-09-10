import React, { useEffect, useState, useRef } from 'react';
import { NumeroVivo, Valor, useCrescer } from './motion';
import { formatarMoedaEntrada, parseMoeda } from './numero';
import { fmtBr } from '../core/engine';
import { href, navegar } from './router';
import { Icon, Marca, Logotipo, type IconName } from './icons';

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 });
const brlInt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const pctF = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 1 });

export const money = (v: number | undefined, compact = false) => (v === undefined || Number.isNaN(v) ? '' : compact ? brlInt.format(v) : brl.format(v));
export const pct = (v: number | undefined) => (v === undefined || Number.isNaN(v) ? '' : pctF.format(v));
export const data = (s?: string) => fmtBr(s);
export const dataHora = (iso?: string) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '');

export function Money({ v, compact, sign }: { v: number | undefined; compact?: boolean; sign?: boolean }) {
  if (v === undefined) return <span className="num" />;
  const cls = sign ? (v < 0 ? 'num neg' : v > 0 ? 'num pos' : 'num') : v < 0 ? 'num neg' : 'num';
  return <NumeroVivo className={cls} texto={money(v, compact)} leve />;
}

export function Kpi({ label, value, hint, tone, to }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: 'ok' | 'warn' | 'bad'; to?: string }) {
  return (
    <div className={`kpi ${tone ?? ''} ${to ? 'link' : ''}`} onClick={to ? () => navegar(to) : undefined} title={to ? 'Ver origem do número' : undefined}>
      <div className="label">{label}</div>
      <div className="value"><Valor v={value} /></div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export interface KpiSecundario { label: string; value: React.ReactNode; tone?: 'neg' | 'warn' | 'pos' }

/** KPI principal da tela: valor grande, complemento, grafico opcional e metricas secundarias na base. */
export function KpiHero({ label, value, sufixo, hint, tone, to, children, secundarios }: { label: string; value: React.ReactNode; sufixo?: React.ReactNode; hint?: React.ReactNode; tone?: 'ok' | 'warn' | 'bad'; to?: string; children?: React.ReactNode; secundarios?: KpiSecundario[] }) {
  return (
    <div className={`kpi hero ${tone ?? ''} ${to ? 'link' : ''}`} onClick={to ? () => navegar(to) : undefined}>
      <div className="label">{label}</div>
      <div className="value"><Valor v={value} />{sufixo && <small>{sufixo}</small>}</div>
      {hint && <div className="hint">{hint}</div>}
      {children && <div className="kpi-spark">{children}</div>}
      {secundarios && secundarios.length > 0 && (
        <div className="kpi-sec">{secundarios.map((s) => <div key={s.label}><div className="label">{s.label}</div><div className={`v ${s.tone ?? ''}`}><Valor v={s.value} /></div></div>)}</div>
      )}
    </div>
  );
}

/** Faixa compacta de metricas secundarias. */
export function KpiStrip({ itens }: { itens: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: 'neg' | 'warn' | 'pos'; to?: string }[] }) {
  return (
    <div className="strip">
      {itens.map((i) => (
        <div key={i.label} className={i.to ? 'link' : ''} onClick={i.to ? () => navegar(i.to!) : undefined}>
          <div className="label">{i.label}</div>
          <div className={`v ${i.tone ?? ''}`}><Valor v={i.value} /></div>
          {i.hint && <div className="hint">{i.hint}</div>}
        </div>
      ))}
    </div>
  );
}

export function ProgressRow({ label, valor, texto, tone }: { label: string; valor: number; texto?: string; tone?: 'ok' | 'warn' | 'bad' }) {
  const cor = tone === 'bad' ? 'var(--bad)' : tone === 'warn' ? 'var(--warn)' : tone === 'ok' ? 'var(--ok)' : 'var(--brand)';
  const barra = useRef<HTMLElement>(null); const fracao = Math.max(0, Math.min(1, valor)); useCrescer(barra, fracao);
  return (
    <div className="progress-row">
      <span className="label">{label}</span>
      <div className="progress"><i ref={barra} style={{ width: `${fracao * 100}%`, background: cor }} /></div>
      <span className="v">{texto ?? pct(valor)}</span>
    </div>
  );
}

/** Bloco de carregamento com brilho, no formato do conteudo que vem depois. */
export function Skeleton({ w = '100%', h = 14, r, style }: { w?: number | string; h?: number | string; r?: number; style?: React.CSSProperties }) {
  return <span className="skel" style={{ width: w, height: h, borderRadius: r, ...style }} aria-hidden="true" />;
}
/** Esqueleto de uma tela padrao (cabecalho, dois heros, faixa e um cartao): fallback do carregamento sob demanda. */
export function SkeletonTela() {
  return (
    <div className="skel-tela" aria-busy="true" aria-label="Carregando">
      <div className="page-head"><div><Skeleton w={240} h={22} /><div style={{ marginTop: 8 }}><Skeleton w={420} h={12} /></div></div><Skeleton w={96} h={30} r={7} /></div>
      <div className="hero-grid">{[0, 1].map((i) => <div key={i} className="kpi hero"><Skeleton w={220} h={10} /><div style={{ marginTop: 12 }}><Skeleton w={200} h={30} /></div><div style={{ marginTop: 10 }}><Skeleton w="70%" h={11} /></div><div style={{ marginTop: 18 }}><Skeleton h={56} r={8} /></div></div>)}</div>
      <div className="strip">{[0, 1, 2, 3, 4, 5].map((i) => <div key={i}><Skeleton w={90} h={9} /><div style={{ marginTop: 8 }}><Skeleton w={80} h={18} /></div></div>)}</div>
      <div className="card" style={{ marginTop: 16 }}><Skeleton w={180} h={14} />{[0, 1, 2, 3, 4].map((i) => <div key={i} style={{ marginTop: 12 }}><Skeleton h={12} w={`${92 - i * 7}%`} /></div>)}</div>
    </div>
  );
}

/** Cabecalho de relatorio, visivel so na impressao. */
export function PrintHead({ titulo, subtitulo }: { titulo: string; subtitulo?: string }) {
  return (
    <div className="print-only print-head">
      <Logotipo height={40} />
      <div><b>{titulo}</b><br /><span>{subtitulo ?? ''} · impresso em {new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</span></div>
    </div>
  );
}

export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'muted';
export function Badge({ tone = 'muted', children, title }: { tone?: Tone; children: React.ReactNode; title?: string }) {
  return <span className={`badge ${tone}`} title={title}>{children}</span>;
}

export const toneStatus = (s: string): Tone =>
  ({
    Realizado: 'ok', Conciliado: 'ok', Aprovado: 'ok', OK: 'ok', PASS: 'ok', Ativa: 'ok', 'Em execução': 'info', Concluída: 'ok',
    Programado: 'info', 'A vencer': 'info', 'Próximos 7 dias': 'warn', Pendente: 'warn', 'Pendente de aprovação': 'warn', ATENÇÃO: 'warn', Divergente: 'bad',
    Atrasado: 'bad', FALHA: 'bad', FAIL: 'bad', Rejeitado: 'bad', Cancelado: 'muted', Rascunho: 'muted', Devolvido: 'warn', 'Parcialmente liquidado': 'warn',
    Ignorado: 'muted', 'Excluído': 'muted', 'Sem vencimento': 'bad', Planejamento: 'muted', Suspensa: 'warn', Cancelada: 'muted',
  } as Record<string, Tone>)[s] ?? 'muted';

export function StatusBadge({ s }: { s: string }) {
  return <Badge tone={toneStatus(s)}>{s}</Badge>;
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={wide ? { width: 'min(1200px, 100%)' } : undefined} role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

type FieldProps = {
  label: string;
  req?: boolean;
  full?: boolean;
  children: React.ReactNode;
  hint?: string;
  erro?: string; // validacao inline: mensagem junto do campo (o resumo geral pode continuar existindo)
};
export function Field({ label, req, full, children, hint, erro }: FieldProps) {
  return (
    <label className={`field ${req ? 'req' : ''} ${full ? 'full' : ''} ${erro ? 'invalida' : ''}`}>
      <span>{label}</span>
      {children}
      {erro ? <small className="erro" role="alert">{erro}</small> : hint && <small className="muted">{hint}</small>}
    </label>
  );
}
/** Entrada de moeda em pt-BR: digita "1.234,56" (ou 1234,56 / 1234.56), formata ao sair do campo; devolve numero. */
export function MoedaInput({ value, onChange, ...rest }: { value: number; onChange: (v: number) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [txt, setTxt] = useState(() => formatarMoedaEntrada(value)); const [foco, setFoco] = useState(false);
  useEffect(() => { if (!foco) setTxt(formatarMoedaEntrada(value)); }, [value, foco]);
  return <input inputMode="decimal" className="moeda" value={txt} onFocus={(e) => { setFoco(true); e.target.select(); }} onBlur={() => { setFoco(false); setTxt(formatarMoedaEntrada(value)); }} onChange={(e) => { setTxt(e.target.value); const n = parseMoeda(e.target.value); if (n !== null) onChange(n); }} {...rest} />;
}
/** Encontra, numa lista de mensagens de validacao, a que pertence a um campo (por expressao). */
export const erroDoCampo = (erros: string[], re: RegExp) => erros.find((e) => re.test(e));

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} />;
}
export function NumberInput({ value, onChange, ...rest }: { value: number; onChange: (v: number) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  return <input type="number" step="0.01" value={Number.isFinite(value) ? value : 0} onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))} {...rest} />;
}
export function Select({ value, onChange, options, allowEmpty, ...rest }: { value: string; onChange: (v: string) => void; options: (string | { value: string; label: string })[]; allowEmpty?: string } & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange'>) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} {...rest}>
      {allowEmpty !== undefined && <option value="">{allowEmpty}</option>}
      {options.map((o) => (typeof o === 'string' ? <option key={o} value={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>))}
    </select>
  );
}

/** Estado de erro padrao: o que aconteceu, a causa provavel e o que fazer, com as acoes possiveis. */
export function EstadoErro({ titulo, causa, children, acoes }: { titulo: string; causa?: React.ReactNode; children?: React.ReactNode; acoes?: React.ReactNode }) {
  return (
    <div className="estado-erro" role="alert">
      <span className="estado-erro-ico"><Icon name="aviso" size={22} /></span>
      <div><h2>{titulo}</h2>{causa && <div className="alert bad" style={{ marginTop: 8 }}>{causa}</div>}{children && <p className="small muted" style={{ marginTop: 8 }}>{children}</p>}{acoes && <div className="actions" style={{ marginTop: 12 }}>{acoes}</div>}</div>
    </div>
  );
}
export function Alert({ tone, children }: { tone: 'ok' | 'warn' | 'bad' | 'info'; children: React.ReactNode }) {
  return <div className={`alert ${tone}`}>{children}</div>;
}

export function Empty({ children, icone = 'vazio', titulo, acao }: { children: React.ReactNode; icone?: IconName; titulo?: string; acao?: React.ReactNode }) {
  return <div className="empty"><span className="empty-marca" aria-hidden="true"><Marca size={54} /></span><Icon name={icone} size={26} />{titulo && <div className="empty-title">{titulo}</div>}<div>{children}</div>{acao && <div className="actions" style={{ justifyContent: 'center', marginTop: 6 }}>{acao}</div>}</div>;
}

export function Link({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) {
  return <a href={href(to)} className={className}>{children}</a>;
}

export function PageHead({ title, subtitle, children }: { title: string; subtitle?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {children && <div className="actions">{children}</div>}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { id: T; label: string }[] }) {
  return (
    <div className="tabs">
      {items.map((i) => (
        <button key={i.id} className={i.id === value ? 'active' : ''} onClick={() => onChange(i.id)}>{i.label}</button>
      ))}
    </div>
  );
}

export function Bars({ valores, rotulos }: { valores: number[]; rotulos: string[] }) {
  const max = Math.max(1, ...valores.map((v) => Math.abs(v)));
  return (
    <div className="bars">
      {valores.map((v, i) => (
        <div className="bar" key={i} title={`${rotulos[i]}: ${money(v)}`}>
          <div className={`${v < 0 ? 'neg' : ''} viz-cresce-v`} style={{ height: `${Math.max(2, (Math.abs(v) / max) * 90)}%`, animationDelay: `${i * 40}ms` }} />
          <span>{rotulos[i].split(' ')[0]}</span>
        </div>
      ))}
    </div>
  );
}

export function useToast() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 3500);
    return () => clearTimeout(t);
  }, [msg]);
  return { msg, toast: setMsg, el: msg ? <div className="toast">{msg}</div> : null };
}

/** Executa uma acao do store e retorna a mensagem de erro (regra de negocio) se houver. */
export function tentar(fn: () => void, onErro: (m: string) => void, onOk?: () => void) {
  try {
    fn();
    onOk?.();
  } catch (e) {
    onErro((e as Error).message);
  }
}
