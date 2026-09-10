// Vistas salvas: um conjunto de filtros com nome, por tela e por navegador (localStorage). A tela entrega o objeto de filtros
// atual e a funcao que os aplica; o componente cuida de listar, salvar, aplicar e excluir.
import React, { useEffect, useState } from 'react';

interface Vista<T> { nome: string; filtros: T; em: string }
const chave = (tela: string) => `eiff-control:vistas:${tela}`;
const lerVistas = <T,>(tela: string): Vista<T>[] => { try { const v = JSON.parse(localStorage.getItem(chave(tela)) ?? '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
const gravarVistas = <T,>(tela: string, vistas: Vista<T>[]) => { try { localStorage.setItem(chave(tela), JSON.stringify(vistas)); } catch { /* ignore */ } };

export function VistasSalvas<T extends object>({ tela, filtros, aplicar, ehPadrao }: { tela: string; filtros: T; aplicar: (f: T) => void; ehPadrao?: (f: T) => boolean }) {
  const [vistas, setVistas] = useState<Vista<T>[]>(() => lerVistas<T>(tela));
  const [ativa, setAtiva] = useState('');
  useEffect(() => { const v = vistas.find((x) => x.nome === ativa); if (v && JSON.stringify(v.filtros) !== JSON.stringify(filtros)) setAtiva(''); }, [filtros, vistas, ativa]);
  const salvar = () => {
    const nome = window.prompt('Nome da vista (ex.: "Atrasados da obra Smart Fit"):', ativa || '')?.trim(); if (!nome) return;
    const v = [...vistas.filter((x) => x.nome !== nome), { nome, filtros, em: new Date().toISOString() }].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    setVistas(v); gravarVistas(tela, v); setAtiva(nome);
  };
  const excluir = () => { if (!ativa || !window.confirm(`Excluir a vista "${ativa}"?`)) return; const v = vistas.filter((x) => x.nome !== ativa); setVistas(v); gravarVistas(tela, v); setAtiva(''); };
  const podeSalvar = !ehPadrao || !ehPadrao(filtros);
  return (
    <span className="vistas" title="Vistas salvas: filtros com nome, guardados neste navegador">
      <select className="btn sm" value={ativa} onChange={(e) => { const v = vistas.find((x) => x.nome === e.target.value); setAtiva(e.target.value); if (v) aplicar(v.filtros); }} aria-label="Vista salva">
        <option value="">{vistas.length ? 'Vistas salvas…' : 'Sem vistas salvas'}</option>
        {vistas.map((v) => <option key={v.nome} value={v.nome}>{v.nome}</option>)}
      </select>
      <button className="btn sm" onClick={salvar} disabled={!podeSalvar} title={podeSalvar ? 'Salvar os filtros atuais como vista' : 'Ajuste algum filtro para salvar uma vista'}>Salvar vista</button>
      {ativa && <button className="btn sm" onClick={excluir} title="Excluir a vista selecionada">Excluir</button>}
    </span>
  );
}
