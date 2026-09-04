import React, { useEffect, useState } from 'react';
import { fmtBr } from '../core/engine';
import { href, navegar } from './router';
import { Icon, Logotipo, type IconName } from './icons';

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
  return <span className={cls}>{money(v, compact)}</span>;
}

export function Kpi({ label, value, hint, tone, to }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: 'ok' | 'warn' | 'bad'; to?: string }) {
  return (
    <div className={`kpi ${tone ?? ''} ${to ? 'link' : ''}`} onClick={to ? () => navegar(to) : undefined} title={to ? 'Ver origem do número' : undefined}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
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
      <div className="value">{value}{sufixo && <small>{sufixo}</small>}</div>
      {hint && <div className="hint">{hint}</div>}
      {children && <div className="kpi-spark">{children}</div>}
      {secundarios && secundarios.length > 0 && (
        <div className="kpi-sec">{secundarios.map((s) => <div key={s.label}><div className="label">{s.label}</div><div className={`v ${s.tone ?? ''}`}>{s.value}</div></div>)}</div>
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
          <div className={`v ${i.tone ?? ''}`}>{i.value}</div>
          {i.hint && <div className="hint">{i.hint}</div>}
        </div>
      ))}
    </div>
  );
}

export function ProgressRow({ label, valor, texto, tone }: { label: string; valor: number; texto?: string; tone?: 'ok' | 'warn' | 'bad' }) {
  const cor = tone === 'bad' ? 'var(--bad)' : tone === 'warn' ? 'var(--warn)' : tone === 'ok' ? 'var(--ok)' : 'var(--brand)';
  return (
    <div className="progress-row">
      <span className="label">{label}</span>
      <div className="progress"><i style={{ width: `${Math.max(0, Math.min(1, valor)) * 100}%`, background: cor }} /></div>
      <span className="v">{texto ?? pct(valor)}</span>
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
export function Badge({ tone = 'muted', children }: { tone?: Tone; children: React.ReactNode }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export const toneStatus = (s: string): Tone =>
  ({
    Realizado: 'ok', Conciliado: 'ok', Aprovado: 'ok', OK: 'ok', PASS: 'ok', Ativa: 'ok', 'Em execução': 'info', Concluída: 'ok',
    Programado: 'info', 'A vencer': 'info', 'Próximos 7 dias': 'warn', Pendente: 'warn', 'Pendente de aprovação': 'warn', ATENÇÃO: 'warn', Divergente: 'bad',
    Atrasado: 'bad', FALHA: 'bad', FAIL: 'bad', Rejeitado: 'bad', Cancelado: 'muted', Rascunho: 'muted', Devolvido: 'warn', 'Parcialmente liquidado': 'warn',
    Ignorado: 'muted', 'Sem vencimento': 'bad', Planejamento: 'muted', Suspensa: 'warn', Cancelada: 'muted',
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
};
export function Field({ label, req, full, children, hint }: FieldProps) {
  return (
    <label className={`field ${req ? 'req' : ''} ${full ? 'full' : ''}`}>
      <span>{label}</span>
      {children}
      {hint && <small className="muted">{hint}</small>}
    </label>
  );
}

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

export function Alert({ tone, children }: { tone: 'ok' | 'warn' | 'bad' | 'info'; children: React.ReactNode }) {
  return <div className={`alert ${tone}`}>{children}</div>;
}

export function Empty({ children, icone = 'vazio', titulo }: { children: React.ReactNode; icone?: IconName; titulo?: string }) {
  return <div className="empty"><Icon name={icone} size={26} />{titulo && <div className="empty-title">{titulo}</div>}<div>{children}</div></div>;
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
          <div className={v < 0 ? 'neg' : ''} style={{ height: `${Math.max(2, (Math.abs(v) / max) * 90)}%` }} />
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
