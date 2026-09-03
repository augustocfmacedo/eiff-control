import React, { useState } from 'react';
import { dreGerencial } from '../core/engine';
import { obrasVisiveis, useStore } from '../data/store';
import { Money, PageHead, pct } from '../ui/components';

export default function Dre() {
  const { ds, usuario } = useStore();
  const [meses, setMeses] = useState(12);
  const [obra, setObra] = useState('');
  const d = dreGerencial(ds, meses, obra ? (l) => l.codigoObra === obra : undefined);
  const total = (v: number[]) => v.reduce((a, b) => a + b, 0);
  return (
    <>
      <PageHead title="DRE gerencial" subtitle="Regime de competência. Grupos seguem o plano de contas; itens 'Não DRE' (principal de dívida, CAPEX, aportes, distribuições) ficam fora do resultado. Não substitui a contabilidade oficial.">
        <select className="btn sm" value={obra} onChange={(e) => setObra(e.target.value)}><option value="">Consolidado</option>{obrasVisiveis(usuario, ds.obras).map((o) => <option key={o.codigo} value={o.codigo}>{o.codigo}</option>)}</select>
        {[6, 12, 24].map((m) => <button key={m} className={`btn sm ${meses === m ? 'primary' : ''}`} onClick={() => setMeses(m)}>{m} meses</button>)}
      </PageHead>
      <div className="card table-wrap">
        <table>
          <thead><tr><th className="sticky">Linha</th>{d.periodos.map((p) => <th key={p.ini} className="num">{p.rotulo}</th>)}<th className="num">Acumulado</th></tr></thead>
          <tbody>
            {d.linhas.map((li) => {
              const isPct = li.destaque === 'margem';
              const cls = li.destaque === 'total' ? 'total' : li.destaque === 'sub' ? 'sub' : '';
              const rl = total(d.linhas.find((x) => x.nome === 'RECEITA LÍQUIDA')!.valores);
              const acum = isPct ? (rl ? total(d.linhas[d.linhas.indexOf(li) - 1].valores) / rl : 0) : total(li.valores);
              return (
                <tr key={li.nome} className={cls}>
                  <td className="sticky">{li.nome}</td>
                  {li.valores.map((v, i) => <td key={i} className={`num ${!isPct && v < 0 ? 'neg' : ''}`}>{isPct ? pct(v) : v ? <Money v={v} /> : ''}</td>)}
                  <td className="num">{isPct ? pct(acum) : <Money v={acum} />}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
