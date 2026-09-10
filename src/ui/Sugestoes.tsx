// Faixa do assistente contextual: as sugestoes da tela (src/core/sugestoes.ts) como cartoes curtos com acao; cada uma pode
// ser dispensada nesta sessao. Nada aqui calcula; e apresentacao.
import React, { useMemo, useState } from 'react';
import { sugestoesPara } from '../core/sugestoes';
import { useStore } from '../data/store';
import { registrarAcao } from '../data/telemetria';
import { Icon } from './icons';
import { navegar } from './router';

const CHAVE = 'eiff-control:sugestoes-dispensadas';
const lerDispensadas = (): string[] => { try { return JSON.parse(sessionStorage.getItem(CHAVE) ?? '[]'); } catch { return []; } };

export function Sugestoes({ rota }: { rota: string }) {
  const { ds, usuario } = useStore();
  const [dispensadas, setDispensadas] = useState<string[]>(lerDispensadas);
  const lista = useMemo(() => { try { return sugestoesPara(rota, ds, usuario); } catch { return []; } }, [rota, ds, usuario]);
  const visiveis = lista.filter((s) => !dispensadas.includes(s.id)).slice(0, 4);
  if (!visiveis.length) return null;
  const dispensar = (id: string) => { const v = [...dispensadas, id]; setDispensadas(v); try { sessionStorage.setItem(CHAVE, JSON.stringify(v)); } catch { /* ignore */ } registrarAcao('sugestao:dispensar'); };
  return (
    <div className="sugestoes no-print" aria-label="Sugestões do assistente">
      {visiveis.map((s) => (
        <div key={s.id} className={`sugestao ${s.tom}`}>
          <span className="sugestao-ico"><Icon name={s.tom === 'info' ? 'ajuda' : 'aviso'} size={15} /></span>
          <span className="sugestao-txt"><span>{s.texto}</span>{s.detalhe && <span className="muted small"> {s.detalhe}</span>}</span>
          {s.acao && <button className="btn sm" onClick={() => { registrarAcao(`sugestao:${s.id}`); navegar(s.acao!.to); }}>{s.acao.rotulo}</button>}
          <button className="btn sm fechar" title="Dispensar nesta sessão" aria-label="Dispensar" onClick={() => dispensar(s.id)}>×</button>
        </div>
      ))}
    </div>
  );
}
