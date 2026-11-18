// CD-D3/E5 — Metas e resultados no Command Center (não é o Diretor Comercial completo: a rota #/radar/diretor é do CD-6).
//
// Só APRESENTA o bloco `metaComercial` do snapshot CD-1.3 (via o modelo puro de metaResultadoVisao.ts) e pede a mudança de
// meta pela ação canônica com confirmação do banco (`actions.definirMetaComercialConfirmada`, que chama
// `definirMetaComercialRadar`). Nenhum indicador é calculado aqui; indisponível aparece como "—" com o motivo.
import React, { useState } from 'react';
import type { BlocoMetaComercialCD } from '../../core/radar/commercialDirector';
import { motivosRecusaNovaMeta, type VersaoMetaComercial } from '../../core/radar/metaComercial';
import type { ResultadoMetaConfirmada } from '../../data/metaConfirmada';
import { Badge, Field, Input, KpiHero, KpiStrip, Modal, MoedaInput, ProgressRow, Select } from '../../ui/components';
import { rotuloInstante, rotuloMes, visaoMetaComercial, type EdicaoMeta, type ValorTela } from './metaResultadoVisao';

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });
const comMotivo = (v: ValorTela) => (v.disponivel ? undefined : v.motivo);

export interface PainelMetaProps {
  bloco: BlocoMetaComercialCD;
  /** versões de meta do mês selecionado, como vieram do banco (só leitura) */
  versoes: VersaoMetaComercial[];
  meses: string[];
  agoraIso: string;
  edicao: EdicaoMeta;
  /** aviso da sincronização (alterações não confirmadas) ou do último salvamento */
  aviso?: { tom: 'ok' | 'warn' | 'bad'; texto: string };
  onMes: (mes: string) => void;
  onAtualizar: () => void;
  onDefinir: () => void;
  onRetirar: () => void;
}

export function PainelMetaComercial({ bloco, versoes, meses, agoraIso, edicao, aviso, onMes, onAtualizar, onDefinir, onRetirar }: PainelMetaProps) {
  const v = visaoMetaComercial(bloco);
  const temMeta = v.meta.disponivel;
  // pouco texto: o motivo de indisponibilidade aparece uma vez (no destaque); a faixa só repete motivo diferente
  const motivoDestaque = comMotivo(v.receitaLiquida);
  const motivoFaixa = (x: ValorTela) => { const m = comMotivo(x); return m && m !== motivoDestaque ? m : undefined; };
  return (
    <section className="card meta-comercial" aria-label="Metas e resultados">
      <div className="meta-cabecalho">
        <h2>Metas e resultados</h2>
        {bloco.mes
          ? <Select aria-label="Mês comercial" value={bloco.mes} onChange={onMes} options={meses.map((m) => ({ value: m, label: rotuloMes(m) }))} />
          : <span className="muted small">—</span>}
        <span className="small muted meta-instante">Retrato de {rotuloInstante(agoraIso)}</span>
        <button className="btn sm" onClick={onAtualizar}>Atualizar</button>
      </div>
      {aviso && <div className={`meta-aviso ${aviso.tom}`} role={aviso.tom === 'ok' ? 'status' : 'alert'}>{aviso.texto}</div>}
      <div className="meta-estado"><Badge tone={v.tom === 'ok' ? 'ok' : v.tom === 'bad' ? 'bad' : v.tom === 'warn' ? 'warn' : 'info'}>{v.titulo}</Badge>
        {v.atencao > 0 && <span className="small muted">{v.atencao} alerta(s) de atenção nos detalhes</span>}</div>
      <div className="meta-grid">
        <KpiHero label="Receita ganha líquida" value={v.receitaLiquida.texto} tone={v.tom}
          sufixo={temMeta ? `de ${v.meta.texto}` : undefined}
          hint={comMotivo(v.receitaLiquida) ?? (v.pisoConhecido ? `piso conhecido ${v.pisoConhecido.texto}` : undefined)}
          secundarios={[
            { label: 'Meta', value: v.meta.texto },
            ...(v.barra === undefined ? [{ label: 'Atingimento', value: v.atingimento.texto }] : []),
            { label: v.diferenca.rotulo, value: v.diferenca.valor.texto, tone: v.diferenca.rotulo === 'Excedente' ? 'pos' : undefined },
          ]}>
          {v.barra !== undefined && <ProgressRow label="Atingimento" valor={v.barra} texto={v.atingimento.texto} tone={v.estado === 'ATINGIDA' ? 'ok' : undefined} />}
          {!temMeta && <div className="small muted">{comMotivo(v.meta)}</div>}
        </KpiHero>
        <KpiStrip itens={[
          { label: 'Negócios ganhos', value: v.ganhos.texto, hint: v.ganhos.disponivel ? `receita ganha ${v.receitaGanha.texto}` : motivoFaixa(v.ganhos) },
          { label: 'Sem valor confirmado', value: v.ganhosSemValor.texto, tone: v.ganhosSemValor.disponivel && v.ganhosSemValor.texto !== '0' ? 'warn' : undefined, hint: motivoFaixa(v.ganhosSemValor) },
          { label: 'Estornos', value: v.estornos.texto, tone: v.estornos.disponivel && v.estornos.texto !== '0' ? 'neg' : undefined, hint: v.estornos.disponivel ? v.valorEstornos.texto : motivoFaixa(v.estornos) },
        ]} />
      </div>
      <div className="meta-acoes">
        {edicao.podeEditar && <button className="btn primary sm" onClick={onDefinir}>{bloco.metaVigente?.estado === 'VIGENTE' ? 'Revisar meta' : 'Definir meta'}</button>}
        {edicao.podeRetirar && <button className="btn sm" onClick={onRetirar}>Retirar meta</button>}
        {!edicao.podeEditar && <span className="small muted">{edicao.motivo ?? 'Somente leitura.'}</span>}
      </div>
      <details className="meta-detalhes">
        <summary>Detalhes</summary>
        <div className="meta-detalhes-corpo">
          <div>
            <h3>Alertas</h3>
            {bloco.alertas.length ? <ul>{bloco.alertas.map((a, i) => <li key={`${a.codigo}-${i}`}><Badge tone={a.severidade === 'ATENCAO' ? 'warn' : 'info'}>{a.severidade === 'ATENCAO' ? 'atenção' : 'info'}</Badge> {a.mensagem}</li>)}</ul> : <div className="small muted">Nenhum alerta.</div>}
          </div>
          <div>
            <h3>Versões da meta</h3>
            {versoes.length ? (
              <table className="small"><thead><tr><th>Versão</th><th className="num">Valor</th><th>Motivo</th><th>Em</th></tr></thead>
                <tbody>{versoes.map((x) => <tr key={x.id}><td>v{x.versao}{x.id === bloco.metaVigente?.id ? ' · vigente' : ''}</td><td className="num">{x.valor === null || x.valor === undefined || x.valor === '' ? 'retirada' : BRL.format(Number(x.valor))}</td><td>{x.motivo}</td><td>{rotuloInstante(x.definidaEm).replace(' (horário de São Paulo)', '')}</td></tr>)}</tbody></table>
            ) : <div className="small muted">Nenhuma versão para este mês.</div>}
          </div>
          <div>
            <h3>Retificações e inconsistências</h3>
            <div className="small">Complementos que corrigiram este mês: <b>{v.retificacoes.texto}</b>{comMotivo(v.retificacoes) ? ` (${comMotivo(v.retificacoes)})` : ''}</div>
            {bloco.retificacoes.map((x) => <div key={x.complementoId} className="small muted">ganho {x.ganhoId} completado em {rotuloInstante(x.complementadoEm).replace(' (horário de São Paulo)', '')} · {BRL.format(x.centavos / 100)}</div>)}
            <div className="small">Eventos desconsiderados pelo motor: <b>{v.eventosInconsistentes.texto}</b></div>
            <div className="small muted">Fontes: metas {bloco.disponibilidade.metas ? 'carregadas' : 'indisponíveis'} · livro de desfechos {bloco.disponibilidade.livro ? 'carregado' : 'indisponível'} · regras {bloco.versaoRegras}</div>
          </div>
        </div>
      </details>
    </section>
  );
}

export interface FormMetaProps {
  mes: string;
  modo: 'definir' | 'retirar';
  /** valor da meta vigente, para começar a revisão a partir dele */
  valorAtual?: number;
  agoraIso: string;
  onCancelar: () => void;
  onConfirmar: (valor: number | null, motivo: string) => Promise<ResultadoMetaConfirmada>;
  onConcluido: (r: Extract<ResultadoMetaConfirmada, { ok: true }>) => void;
}

/** Definir/revisar (valor + motivo) ou retirar (motivo). A validação mostrada é a do motor E1; a ação repete tudo. */
export function FormMetaComercial({ mes, modo, valorAtual, agoraIso, onCancelar, onConfirmar, onConcluido }: FormMetaProps) {
  const [valor, setValor] = useState<number>(valorAtual ?? 0);
  const [motivo, setMotivo] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | undefined>();
  const [tentou, setTentou] = useState(false);
  const alvo = modo === 'retirar' ? null : valor;
  const recusas = motivosRecusaNovaMeta({ mes, valor: alvo, motivo, agora: agoraIso });
  const ehPeriodo = (x: string) => /Mês inválido|mês corrente|Instante de referência/.test(x);
  const ehMotivo = (x: string) => /motivo/i.test(x);
  const erroValor = tentou ? recusas.find((x) => !ehPeriodo(x) && !ehMotivo(x)) : undefined;
  const erroMotivo = tentou ? recusas.find(ehMotivo) : undefined;
  const erroMes = recusas.find(ehPeriodo);
  const confirmar = async () => {
    setTentou(true); setErro(undefined);
    if (recusas.length) return;
    setSalvando(true);
    const r = await onConfirmar(alvo, motivo).catch((e: Error) => ({ ok: false as const, estado: 'nao_confirmada' as const, mensagem: e.message }));
    setSalvando(false);
    if (r.ok) onConcluido(r); else setErro(r.mensagem);
  };
  return (
    <Modal title={`${modo === 'retirar' ? 'Retirar a meta' : valorAtual ? 'Revisar a meta' : 'Definir a meta'} · ${rotuloMes(mes)}`} onClose={salvando ? () => undefined : onCancelar}>
      <div className="form">
        {modo === 'definir' && <Field label="Meta de receita ganha (R$)" req full erro={erroValor}><MoedaInput value={valor} onChange={setValor} aria-label="Meta de receita ganha" /></Field>}
        {modo === 'retirar' && <div className="small muted full">A meta deixa de valer neste mês. A versão atual fica no histórico.</div>}
        <Field label="Motivo" req full erro={erroMotivo} hint="3 a 500 caracteres; fica na versão e na auditoria"><Input value={motivo} maxLength={500} onChange={(e) => setMotivo(e.target.value)} placeholder={modo === 'retirar' ? 'Por que a meta deixa de valer' : 'Ex.: meta aprovada na reunião de diretoria'} /></Field>
        {erroMes && <div className="meta-aviso bad full" role="alert">{erroMes}</div>}
        {erro && <div className="meta-aviso bad full" role="alert">{erro}</div>}
      </div>
      <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
        <button className="btn" onClick={onCancelar} disabled={salvando}>Cancelar</button>
        <button className={`btn ${modo === 'retirar' ? 'danger' : 'primary'}`} onClick={() => void confirmar()} disabled={salvando}>{salvando ? 'Confirmando no banco…' : modo === 'retirar' ? 'Retirar' : 'Salvar'}</button>
      </div>
    </Modal>
  );
}
