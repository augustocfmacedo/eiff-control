import React from 'react';

// Icones em linha (24x24, traco 1.7) para menu, botoes e estados. Monocromaticos: herdam currentColor.
const PATHS: Record<string, React.ReactNode> = {
  painel: <><rect x="3" y="3" width="8" height="10" rx="1.5" /><rect x="13" y="3" width="8" height="5" rx="1.5" /><rect x="13" y="11" width="8" height="10" rx="1.5" /><rect x="3" y="16" width="8" height="5" rx="1.5" /></>,
  inbox: <><path d="M3 13h5l2 3h4l2-3h5" /><path d="M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" /></>,
  central: <><path d="M3 21h18" /><path d="M5 21V7l7-4 7 4v14" /><path d="M9 21v-5h6v5" /><path d="M9 10h.01M15 10h.01M9 14h.01M15 14h.01" /></>,
  obras: <><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" /></>,
  orcamento: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3z" /><path d="M9 8h6M9 12h6M9 16h3" /></>,
  equipe: <><circle cx="9" cy="8" r="3.2" /><path d="M3 20a6 6 0 0 1 12 0" /><circle cx="17" cy="9" r="2.6" /><path d="M15.5 14.5A5 5 0 0 1 21 20" /></>,
  fabrica: <><path d="M3 21V10l6 3V10l6 3V10l6 3v8" /><path d="M3 21h18" /><path d="M7 17h2M11 17h2M15 17h2" /></>,
  campo: <><rect x="7" y="2.5" width="10" height="19" rx="2" /><path d="M11 18h2" /></>,
  compras: <><path d="M3 4h2l2.4 11.2a1.5 1.5 0 0 0 1.5 1.2h8.6a1.5 1.5 0 0 0 1.5-1.2L21 8H6" /><circle cx="9.5" cy="20" r="1.2" /><circle cx="17.5" cy="20" r="1.2" /></>,
  pagar: <><path d="M7 17L17 7" /><path d="M9 7h8v8" /></>,
  receber: <><path d="M17 7L7 17" /><path d="M15 17H7V9" /></>,
  lancamentos: <><path d="M4 4h12a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3V4z" /><path d="M8 9h7M8 13h7" /></>,
  aprovacoes: <><circle cx="12" cy="12" r="9" /><path d="M8 12.5l2.6 2.6L16.5 9" /></>,
  banco: <><path d="M3 10l9-6 9 6" /><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8" /><path d="M3 20h18" /></>,
  fluxo: <><path d="M3 17l5-6 4 3 5-7 4 4" /><path d="M3 21h18" /></>,
  calendario: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  conciliacao: <><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>,
  dividas: <><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M3 10h18M7 15h3" /></>,
  dre: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M8 7h8M8 11h2M12 11h2M16 11h0M8 15h2M12 15h2M16 15h0M8 18h2M12 18h2M16 15v3" /></>,
  checks: <><path d="M12 3l8 3v6c0 4.5-3.2 7.8-8 9-4.8-1.2-8-4.5-8-9V6l8-3z" /><path d="M9 12l2 2 4-4" /></>,
  cadastros: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>,
  auditoria: <><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.3-4.3" /></>,
  menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
  recolher: <><path d="M15 6l-6 6 6 6" /></>,
  expandir: <><path d="M9 6l6 6-6 6" /></>,
  sol: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  lua: <><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" /></>,
  sair: <><path d="M10 17l5-5-5-5" /><path d="M15 12H3" /><path d="M13 4h5a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-5" /></>,
  mais: <><path d="M12 5v14M5 12h14" /></>,
  aviso: <><path d="M12 3l10 18H2L12 3z" /><path d="M12 10v4M12 17.5h.01" /></>,
  vazio: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18" /><path d="M8 15h4" /></>,
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg className={`ico ${className ?? ''}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {PATHS[name]}
    </svg>
  );
}

/** Simbolo EIFF: tres colunas de blocos. Preto da marca = currentColor (branco no tema escuro), laranja = --brand. */
export function Marca({ size = 28 }: { size?: number }) {
  const h = size; const w = Math.round((size * 343) / 714);
  return (
    <svg className="marca" width={w} height={h} viewBox="0 0 343 714" aria-label="EIFF" role="img">
      <g fill="currentColor">
        <rect x="0" y="136" width="68" height="126" rx="4" /><rect x="0" y="293" width="68" height="126" rx="4" />
        <rect x="137" y="136" width="68" height="441" rx="4" /><rect x="137" y="626" width="68" height="88" rx="4" />
        <rect x="275" y="136" width="68" height="86" rx="4" />
      </g>
      <g fill="var(--brand)">
        <rect x="0" y="451" width="68" height="126" rx="4" /><rect x="137" y="0" width="68" height="88" rx="4" /><rect x="275" y="264" width="68" height="313" rx="4" />
      </g>
    </svg>
  );
}

/** Logotipo completo: simbolo + palavra EIFF (traco geometrico da identidade). */
export function Logotipo({ height = 24 }: { height?: number }) {
  const w = Math.round((height * 1190) / 715);
  // letras medidas da identidade (altura 715, traco 56): E com ganchos, I, F, F
  const r = (x: number, y: number, w: number, h: number) => <rect x={x} y={y} width={w} height={h} />;
  const letras = (
    <>
      {r(0, 0, 56, 715)}{r(56, 0, 100, 57)}{r(100, 57, 56, 111)}{r(56, 287, 100, 56)}{r(56, 658, 100, 57)}{r(100, 547, 56, 111)}
      {r(224, 0, 56, 715)}
      {[344, 554].map((x) => <React.Fragment key={x}>{r(x, 0, 56, 715)}{r(x + 56, 0, 100, 57)}{r(x + 100, 57, 56, 111)}{r(x + 56, 287, 100, 56)}</React.Fragment>)}
    </>
  );
  return (
    <svg className="logotipo" width={w} height={height} viewBox="0 0 1190 716" aria-label="EIFF" role="img">
      <g fill="currentColor">
        <rect x="0" y="136" width="68" height="126" rx="4" /><rect x="0" y="293" width="68" height="126" rx="4" />
        <rect x="137" y="136" width="68" height="441" rx="4" /><rect x="137" y="626" width="68" height="88" rx="4" />
        <rect x="275" y="136" width="68" height="86" rx="4" />
      </g>
      <g fill="var(--brand)">
        <rect x="0" y="451" width="68" height="126" rx="4" /><rect x="137" y="0" width="68" height="88" rx="4" /><rect x="275" y="264" width="68" height="313" rx="4" />
      </g>
      <g fill="currentColor" transform="translate(480 0)">{letras}</g>
    </svg>
  );
}
