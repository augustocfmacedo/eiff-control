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

/**
 * Commercial UX 1.0 (UX-1.1): no Panorama, sugestao que so leva de volta para a propria tela e ruido concorrente — a
 * tela ja e a superficie daquela informacao, com contagens de outro recorte. Regra ESTREITA e so de apresentacao: nada
 * muda em `sugestoes.ts`, e sugestao que leva para outro lugar (ex.: duplicatas) continua aparecendo, aqui e nas demais
 * rotas. Nao generalizar para "mesma rota" em geral: em /radar, por exemplo, o destino util muda so de aba.
 */
export const ROTA_PANORAMA_COMERCIAL = '/radar/hoje';
export const sugestaoRedundanteNoPanorama = (rota: string, destino?: string): boolean =>
  rota === ROTA_PANORAMA_COMERCIAL && (destino ?? '').split('?')[0] === ROTA_PANORAMA_COMERCIAL;

export function Sugestoes({ rota }: { rota: string }) {
  const { ds, usuario } = useStore();
  const [dispensadas, setDispensadas] = useState<string[]>(lerDispensadas);
  const lista = useMemo(() => { try { return sugestoesPara(rota, ds, usuario); } catch { return []; } }, [rota, ds, usuario]);
  const visiveis = lista.filter((s) => !dispensadas.includes(s.id) && !sugestaoRedundanteNoPanorama(rota, s.acao?.to)).slice(0, 4);
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
