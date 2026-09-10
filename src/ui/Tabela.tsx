// Tabela unificada: cabecalho fixo dentro de area rolavel, ordenacao por coluna (estavel), linhas clicaveis navegaveis por
// teclado (setas e Enter), estado vazio proprio e densidade global (data-densidade no <html>). As celulas continuam sendo
// escritas pela tela (funcao `linha` devolve os <td>), entao regras e formatos nao mudam: so a moldura fica igual em todo lugar.
import React, { useMemo, useState } from 'react';
import { ordenarLinhas } from './busca';
import { baixarCsv } from './exportar';

export interface Coluna<T> { titulo: React.ReactNode; num?: boolean; ordenar?: (l: T) => string | number | undefined; className?: string; oculta?: boolean; largura?: number | string; title?: string }
export interface OrdemTabela { coluna: number; desc?: boolean }
export interface CsvTabela<T> { nome: string; cabecalho?: string[]; linha: (l: T) => unknown[] }
export function Tabela<T>({ colunas, linhas, chave, linha, onLinha, vazio = 'Nada a mostrar.', altura, ordemInicial, className, id, csv }: {
  colunas: Coluna<T>[]; linhas: T[]; chave: (l: T) => string; linha: (l: T) => React.ReactNode; onLinha?: (l: T) => void;
  vazio?: React.ReactNode; altura?: number | string; ordemInicial?: OrdemTabela; className?: string; id?: string;
  csv?: CsvTabela<T>; // exporta o que esta na tela (filtrado e ordenado)
}) {
  const [ordem, setOrdem] = useState<OrdemTabela | null>(ordemInicial ?? null);
  const visiveis = colunas.filter((c) => !c.oculta);
  const ordenadas = useMemo(() => (ordem && colunas[ordem.coluna]?.ordenar ? ordenarLinhas(linhas, colunas[ordem.coluna].ordenar, ordem.desc) : linhas), [linhas, colunas, ordem]);
  const alternar = (i: number) => { if (!colunas[i].ordenar) return; setOrdem((o) => (o?.coluna === i ? (o.desc ? null : { coluna: i, desc: true }) : { coluna: i })); };
  const teclaLinha = (e: React.KeyboardEvent<HTMLTableRowElement>, l: T) => {
    if (e.key === 'Enter' && onLinha) { e.preventDefault(); onLinha(l); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const irmao = e.key === 'ArrowDown' ? e.currentTarget.nextElementSibling : e.currentTarget.previousElementSibling; (irmao as HTMLElement | null)?.focus(); }
  };
  const exportar = () => csv && baixarCsv(csv.nome, csv.cabecalho ?? visiveis.map((c) => (typeof c.titulo === 'string' ? c.titulo : '')), ordenadas.map(csv.linha));
  return (
    <div className={`tabela ${className ?? ''}`} style={altura !== undefined ? { maxHeight: altura } : undefined} id={id}>
      {csv && <div className="tabela-barra no-print"><span className="small muted">{ordenadas.length.toLocaleString('pt-BR')} linha(s)</span><button className="btn sm" onClick={exportar} disabled={!ordenadas.length} title="Exporta as linhas como estão na tela (filtro e ordenação)">Exportar CSV</button></div>}
      <table>
        <thead>
          <tr>
            {colunas.map((c, i) => c.oculta ? null : (
              <th key={i} className={`${c.num ? 'num' : ''} ${c.className ?? ''} ${c.ordenar ? 'ord' : ''} ${ordem?.coluna === i ? (ordem.desc ? 'desc' : 'asc') : ''}`.trim()} style={c.largura !== undefined ? { width: c.largura } : undefined}
                onClick={() => alternar(i)} title={c.title ?? (c.ordenar ? 'Ordenar' : undefined)} aria-sort={ordem?.coluna === i ? (ordem.desc ? 'descending' : 'ascending') : undefined} scope="col">
                {c.titulo}{c.ordenar && <span className="seta" aria-hidden="true">{ordem?.coluna === i && ordem.desc ? '▼' : '▲'}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ordenadas.map((l) => (
            <tr key={chave(l)} className={onLinha ? 'clickable' : ''} tabIndex={onLinha ? 0 : undefined} onClick={onLinha ? () => onLinha(l) : undefined} onKeyDown={onLinha ? (e) => teclaLinha(e, l) : undefined}>{linha(l)}</tr>
          ))}
          {ordenadas.length === 0 && <tr><td colSpan={visiveis.length} className="empty">{vazio}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

/** Densidade global das tabelas (normal | compacta), lembrada por navegador. */
export type Densidade = 'normal' | 'compacta';
export function lerDensidade(): Densidade { try { return localStorage.getItem('eiff-control:densidade') === 'compacta' ? 'compacta' : 'normal'; } catch { return 'normal'; } }
export function aplicarDensidade(d: Densidade) { document.documentElement.dataset.densidade = d; try { localStorage.setItem('eiff-control:densidade', d); } catch { /* ignore */ } }
