import React, { useState } from 'react';
import { CANAIS, CODIGOS_RESPOSTA, ESTAGIOS, FAIXAS_FUNCIONARIOS, FAIXAS_RECEITA, NOME_CANAL, NOME_ESTAGIO, NOME_PERSONA, NOME_SINAL, NOME_TIPO_ATIVIDADE, NOME_TIPO_TAREFA, PERSONAS, TIPOS_ATIVIDADE, TIPOS_SINAL, TIPOS_TAREFA, calcularDecisionFit, calcularScore, contextoEmpresa, normalizarContatosCsv, tipoProjetoPrincipal, normalizarEmpresasCsv, type Atividade, type Canal, type Contato, type Empresa, type Estagio, type ExplicacaoScore, type ImportacaoJob, type Oportunidade, type Projeto, type TarefaRadar, type TipoAtividade, type TipoSinal, type TipoTarefa, ACOES_SINAL, NOME_ACAO_SINAL, NOME_RELEVANCIA, RELEVANCIAS, RELEVANCIA_PADRAO_POR_TIPO, type AcaoSinal, type RelevanciaEstrutural } from '../../core/radar';
import { actions, useStore } from '../../data/store';
import { dryRunContatosCsv, relatorioDryRun, type DryRunContatos } from '../../core/radar/dryrun';
import { Badge, Field, Input, Modal, NumberInput, Select, money, tentar, type Tone } from '../../ui/components';

export const d = (s?: string) => (s ? s.slice(0, 10).split('-').reverse().join('/') : '—');
export const dh = (s?: string) => (s ? `${d(s)} ${s.length > 10 ? s.slice(11, 16) : ''}`.trim() : '—');
export const hojeIso = () => new Date().toISOString();
const TONE_CLASSE: Record<string, Tone> = { 'A+': 'ok', A: 'ok', B: 'warn', C: 'muted', D: 'muted' };
export const toneClasse = (c: string): Tone => TONE_CLASSE[c] ?? 'muted';
export const nomeUsuario = (usuarios: { id: string; nome: string }[], id?: string) => usuarios.find((u) => u.id === id)?.nome ?? (id ? id.slice(0, 8) : '—');
export const TONE_ESTAGIO = (e: Estagio): Tone => (e === 'WON' ? 'ok' : e === 'LOST' ? 'bad' : e === 'NURTURE' ? 'muted' : ['PROPOSAL_SENT', 'NEGOTIATION', 'PRICING', 'ENGINEERING', 'PROJECT_RECEIVED'].includes(e) ? 'info' : 'warn');

// ---------------------------------------------------------------------------
// Score: pilula clicavel + explicacao
// ---------------------------------------------------------------------------
export function ScorePill({ e, onClick, compacto }: { e: Empresa; onClick?: () => void; compacto?: boolean }) {
  return <span className={`score-pill ${e.priorityClass}`} onClick={onClick} title="Ver por que este score">{Math.round(e.priorityScore)}{!compacto && <span className="cls">{e.priorityClass}</span>}</span>;
}

export function ScoreModal({ e, onClose }: { e: Empresa; onClose: () => void }) {
  const { ds } = useStore();
  const ctx = contextoEmpresa(ds.radar, e.id);
  const x: ExplicacaoScore | undefined = ctx ? calcularScore(ctx, ds.radar.regrasScore, ds.radar.configScore, ds.params.dataBase) : undefined;
  const hist = ds.radar.snapshotsScore.filter((s) => s.empresaId === e.id).sort((a, b) => (a.em < b.em ? 1 : -1)).slice(0, 8);
  return (
    <Modal title={`Por que ${Math.round(e.priorityScore)} · ${e.priorityClass}?`} onClose={onClose} wide>
      <div className="small muted" style={{ marginBottom: 10 }}>{e.razaoSocial}. Score = Σ dimensão × peso. Cada fator mostra a regra, os pontos após decaimento e o motivo. Regras e pesos são configuráveis no Command Center.</div>
      {!x ? <div className="muted">Sem dados.</div> : (
        <div className="grid cols-2">
          {x.dimensoes.map((dm) => (
            <div key={dm.dimensao} className="card" style={{ padding: 12 }}>
              <div className="dim-bar"><b style={{ width: 130 }}>{dm.dimensao}</b><div className="barra"><i style={{ width: `${dm.score}%` }} /></div><span className="num" style={{ width: 90 }}>{dm.score} × {Math.round(dm.peso * 100)}%</span></div>
              {!dm.fatores.length ? <div className="muted small" style={{ marginTop: 6 }}>Nenhuma regra desta dimensão se aplica.</div> : dm.fatores.map((f) => (
                <div key={f.regraId} className="fator"><span>{f.regra}<div className="muted">{f.motivo}</div></span><span className={`pts ${f.pontos < 0 ? 'neg' : ''}`}>{f.pontos > 0 ? '+' : ''}{f.pontos}{f.fator < 1 && f.fator > 0 ? <span className="muted small"> ({f.base} × {f.fator})</span> : null}</span></div>
              ))}
            </div>
          ))}
        </div>
      )}
      {!!hist.length && (
        <div style={{ marginTop: 12 }}>
          <h3>Histórico</h3>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>{hist.map((s) => <Badge key={s.id} tone={toneClasse(s.classe)}>{d(s.em)} · {s.total} {s.classe}</Badge>)}</div>
        </div>
      )}
      <div className="foot"><button className="btn" onClick={onClose}>Fechar</button></div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Formularios
// ---------------------------------------------------------------------------
interface FormProps<T> { inicial: T; onClose: () => void; onErro: (m: string) => void; onOk: (m: string) => void }

export function EmpresaForm({ inicial, onClose, onErro, onOk }: FormProps<Empresa>) {
  const { ds } = useStore();
  const [e, setE] = useState(inicial);
  const up = (p: Partial<Empresa>) => setE({ ...e, ...p });
  const setores = [...new Set(ds.radar.empresas.map((x) => x.setor).filter((x): x is string => !!x))].sort();
  return (
    <Modal title={ds.radar.empresas.some((x) => x.id === e.id) ? e.razaoSocial : 'Nova empresa'} onClose={onClose} wide>
      <div className="form">
        <Field label="Razão social" req full><Input value={e.razaoSocial} onChange={(ev) => up({ razaoSocial: ev.target.value })} /></Field>
        <Field label="Nome fantasia"><Input value={e.nomeFantasia ?? ''} onChange={(ev) => up({ nomeFantasia: ev.target.value || undefined })} /></Field>
        <Field label="CNPJ"><Input value={e.cnpj ?? ''} onChange={(ev) => up({ cnpj: ev.target.value || undefined })} placeholder="00.000.000/0000-00" /></Field>
        <Field label="Site"><Input value={e.site ?? ''} onChange={(ev) => up({ site: ev.target.value || undefined, dominio: undefined })} placeholder="www.empresa.com.br" /></Field>
        <Field label="LinkedIn"><Input value={e.linkedin ?? ''} onChange={(ev) => up({ linkedin: ev.target.value || undefined })} /></Field>
        <Field label="Setor" hint={setores.length ? `existentes: ${setores.slice(0, 5).join(', ')}` : undefined}><Input value={e.setor ?? ''} onChange={(ev) => up({ setor: ev.target.value || undefined })} list="radar-setores" /><datalist id="radar-setores">{setores.map((s) => <option key={s} value={s} />)}</datalist></Field>
        <Field label="CNAE"><Input value={e.cnae ?? ''} onChange={(ev) => up({ cnae: ev.target.value || undefined })} /></Field>
        <Field label="Cidade"><Input value={e.cidade ?? ''} onChange={(ev) => up({ cidade: ev.target.value || undefined })} /></Field>
        <Field label="UF"><Input value={e.uf ?? ''} onChange={(ev) => up({ uf: ev.target.value.toUpperCase() || undefined })} maxLength={2} /></Field>
        <Field label="Funcionários"><Select value={e.faixaFuncionarios ?? ''} onChange={(v) => up({ faixaFuncionarios: v || undefined })} options={FAIXAS_FUNCIONARIOS} allowEmpty="—" /></Field>
        <Field label="Faturamento"><Select value={e.faixaReceita ?? ''} onChange={(v) => up({ faixaReceita: v || undefined })} options={FAIXAS_RECEITA} allowEmpty="—" /></Field>
        <Field label="Capital social (R$)"><NumberInput value={e.capitalSocial ?? 0} onChange={(v) => up({ capitalSocial: v || undefined })} /></Field>
        <Field label="Unidades"><NumberInput value={e.numeroUnidades ?? 0} onChange={(v) => up({ numeroUnidades: v || undefined })} /></Field>
        <Field label="Observações" full><Input value={e.observacoes} onChange={(ev) => up({ observacoes: ev.target.value })} /></Field>
      </div>
      <div className="foot"><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" onClick={() => tentar(() => { const r = actions.salvarEmpresaRadar(e); onOk(`${r.razaoSocial} salva · score ${Math.round(r.priorityScore)} ${r.priorityClass}.`); }, onErro, onClose)}>Salvar</button></div>
    </Modal>
  );
}

export function ContatoForm({ inicial, onClose, onErro, onOk }: FormProps<Contato>) {
  const { ds } = useStore();
  const [c, setC] = useState(inicial);
  const up = (p: Partial<Contato>) => setC({ ...c, ...p });
  const emp = ds.radar.empresas.find((e) => e.id === c.empresaId);
  const fit = emp ? calcularDecisionFit({ ...c, persona: c.personaManual ? c.persona : undefined }, emp, ds.radar.pesosDecisionFit, ds.radar.regrasPersona, tipoProjetoPrincipal(c.empresaId, ds.radar.projetos)) : undefined;
  return (
    <Modal title={c.nome ? c.nome : 'Novo contato'} onClose={onClose}>
      <div className="form">
        <Field label="Nome" req full><Input value={c.nome} onChange={(ev) => up({ nome: ev.target.value })} /></Field>
        <Field label="Cargo"><Input value={c.cargo ?? ''} onChange={(ev) => up({ cargo: ev.target.value || undefined })} /></Field>
        <Field label="Departamento"><Input value={c.departamento ?? ''} onChange={(ev) => up({ departamento: ev.target.value || undefined })} /></Field>
        <Field label="Senioridade"><Select value={c.senioridade ?? ''} onChange={(v) => up({ senioridade: v || undefined })} options={['Analista', 'Coordenador', 'Gerente', 'Diretor', 'C-level', 'Sócio/Proprietário']} allowEmpty="—" /></Field>
        <Field label="Persona" hint={fit ? `decision fit ${fit.score}: ${fit.razoes.join(' · ')}` : 'inferida do cargo; escolha para fixar'}><Select value={c.persona ?? ''} onChange={(v) => up({ persona: (v || undefined) as Contato['persona'], personaManual: !!v })} options={PERSONAS.map((p) => ({ value: p, label: NOME_PERSONA[p] }))} allowEmpty="— automática —" /></Field>
        <Field label="Decisor"><Select value={c.decisor ? 'Sim' : 'Não'} onChange={(v) => up({ decisor: v === 'Sim' })} options={['Sim', 'Não']} /></Field>
        <Field label="Poder de decisão"><Select value={c.poderDecisao ?? ''} onChange={(v) => up({ poderDecisao: (v || undefined) as Contato['poderDecisao'] })} options={['Baixo', 'Médio', 'Alto']} allowEmpty="—" /></Field>
        <Field label="Situação"><Select value={c.situacao ?? 'ATIVO'} onChange={(v) => up({ situacao: v as Contato['situacao'] })} options={[{ value: 'ATIVO', label: 'Ativo' }, { value: 'INVALIDO', label: 'Inválido' }, { value: 'SAIU_DA_EMPRESA', label: 'Saiu da empresa' }]} /></Field>
        <Field label="Status do e-mail"><Select value={c.statusEmail ?? ''} onChange={(v) => up({ statusEmail: (v || undefined) as Contato['statusEmail'] })} options={[{ value: 'valido', label: 'Válido' }, { value: 'desconhecido', label: 'Não verificado' }, { value: 'catch_all', label: 'Catch-all' }, { value: 'invalido', label: 'Inválido' }, { value: 'devolvido', label: 'Devolvido (bounce)' }]} allowEmpty="—" /></Field>
        <Field label="Status do telefone"><Select value={c.statusTelefone ?? ''} onChange={(v) => up({ statusTelefone: (v || undefined) as Contato['statusTelefone'] })} options={[{ value: 'valido', label: 'Válido' }, { value: 'desconhecido', label: 'Não verificado' }, { value: 'invalido', label: 'Inválido' }]} allowEmpty="—" /></Field>
        <Field label="E-mail"><Input value={c.email ?? ''} onChange={(ev) => up({ email: ev.target.value || undefined })} /></Field>
        <Field label="Telefone"><Input value={c.telefone ?? ''} onChange={(ev) => up({ telefone: ev.target.value || undefined })} /></Field>
        <Field label="Celular"><Input value={c.celular ?? ''} onChange={(ev) => up({ celular: ev.target.value || undefined })} /></Field>
        <Field label="WhatsApp"><Input value={c.whatsapp ?? ''} onChange={(ev) => up({ whatsapp: ev.target.value || undefined })} /></Field>
        <Field label="LinkedIn" full><Input value={c.linkedin ?? ''} onChange={(ev) => up({ linkedin: ev.target.value || undefined })} /></Field>
        <Field label="Verificado em"><Input type="date" value={c.verificadoEm?.slice(0, 10) ?? ''} onChange={(ev) => up({ verificadoEm: ev.target.value || undefined })} /></Field>
        <Field label="Ativo"><Select value={c.ativo ? 'Sim' : 'Não'} onChange={(v) => up({ ativo: v === 'Sim' })} options={['Sim', 'Não']} /></Field>
        <Field label="Observações" full><Input value={c.observacoes} onChange={(ev) => up({ observacoes: ev.target.value })} /></Field>
      </div>
      <div className="foot"><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" onClick={() => tentar(() => { actions.salvarContatoRadar(c); onOk('Contato salvo.'); }, onErro, onClose)}>Salvar</button></div>
    </Modal>
  );
}

export function ProjetoForm({ inicial, onClose, onErro, onOk }: FormProps<Projeto>) {
  const [p, setP] = useState(inicial);
  const up = (x: Partial<Projeto>) => setP({ ...p, ...x });
  return (
    <Modal title={p.nome || 'Novo projeto'} onClose={onClose}>
      <div className="form">
        <Field label="Nome" req full><Input value={p.nome} onChange={(ev) => up({ nome: ev.target.value })} placeholder="Galpão logístico 8.000 m²" /></Field>
        <Field label="Tipo"><Select value={p.tipo ?? ''} onChange={(v) => up({ tipo: v || undefined })} options={['Galpão', 'Fábrica', 'Centro de distribuição', 'Escritório', 'Retrofit/Reforma', 'Mezanino', 'Cobertura', 'Outro']} allowEmpty="—" /></Field>
        <Field label="Estágio"><Select value={p.estagio ?? ''} onChange={(v) => up({ estagio: v || undefined })} options={['Estudo', 'Projeto', 'Licenciamento', 'Licitação', 'Obra', 'Concluído']} allowEmpty="—" /></Field>
        <Field label="Cidade"><Input value={p.cidade ?? ''} onChange={(ev) => up({ cidade: ev.target.value || undefined })} /></Field>
        <Field label="UF"><Input value={p.uf ?? ''} onChange={(ev) => up({ uf: ev.target.value.toUpperCase() || undefined })} maxLength={2} /></Field>
        <Field label="Endereço" full><Input value={p.endereco ?? ''} onChange={(ev) => up({ endereco: ev.target.value || undefined })} /></Field>
        <Field label="Área estimada (m²)"><NumberInput value={p.areaM2 ?? 0} onChange={(v) => up({ areaM2: v || undefined })} /></Field>
        <Field label="Valor estimado (R$)"><NumberInput value={p.valorEstimado ?? 0} onChange={(v) => up({ valorEstimado: v || undefined })} /></Field>
        <Field label="Início previsto"><Input type="date" value={p.inicioPrevisto ?? ''} onChange={(ev) => up({ inicioPrevisto: ev.target.value || undefined })} /></Field>
        <Field label="Observações" full><Input value={p.observacoes} onChange={(ev) => up({ observacoes: ev.target.value })} /></Field>
      </div>
      <div className="foot"><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" onClick={() => tentar(() => { actions.salvarProjetoRadar(p); onOk('Projeto salvo.'); }, onErro, onClose)}>Salvar</button></div>
    </Modal>
  );
}

/** Dados brutos digitados: JSON quando parseavel, senao texto livre. */
const brutoDe = (t: string): unknown => { try { return JSON.parse(t); } catch { return { texto: t.trim() }; } };
export function SinalForm({ empresaId, onClose, onErro, onOk }: { empresaId: string; onClose: () => void; onErro: (m: string) => void; onOk: (m: string) => void }) {
  const { ds } = useStore();
  const [s, setS] = useState<{ tipo: TipoSinal; titulo: string; descricao: string; eventoEm: string; confianca: number; url: string; projetoId: string; fonteId: string; verificado: boolean; bruto: string; relevancia: string; oQueAconteceu: string; porQueImporta: string; acao: string }>({ tipo: 'PROJECT_IDENTIFIED', titulo: '', descricao: '', eventoEm: ds.params.dataBase, confianca: 1, url: '', projetoId: '', verificado: true, bruto: '', relevancia: '', oQueAconteceu: '', porQueImporta: '', acao: '', fonteId: ds.radar.fontes.find((f) => f.codigo === 'MANUAL')?.id ?? '' });
  const up = (p: Partial<typeof s>) => setS({ ...s, ...p });
  return (
    <Modal title="Registrar sinal" onClose={onClose}>
      <div className="form">
        <Field label="Tipo" req><Select value={s.tipo} onChange={(v) => up({ tipo: v as TipoSinal })} options={TIPOS_SINAL.map((t) => ({ value: t, label: NOME_SINAL[t] }))} /></Field>
        <Field label="Quando aconteceu" req><Input type="date" value={s.eventoEm} onChange={(ev) => up({ eventoEm: ev.target.value })} /></Field>
        <Field label="Título" req full><Input value={s.titulo} onChange={(ev) => up({ titulo: ev.target.value })} placeholder="Anunciou novo CD de 15.000 m² em Anápolis" /></Field>
        <Field label="Descrição" full><Input value={s.descricao} onChange={(ev) => up({ descricao: ev.target.value })} /></Field>
        <Field label="Fonte"><Select value={s.fonteId} onChange={(v) => up({ fonteId: v })} options={ds.radar.fontes.filter((f) => f.ativo).map((f) => ({ value: f.id, label: f.nome }))} /></Field>
        <Field label="Confiança (0-1)"><NumberInput value={s.confianca} onChange={(v) => up({ confianca: Math.max(0, Math.min(1, v)) })} step={0.1} /></Field>
        <Field label="Projeto"><Select value={s.projetoId} onChange={(v) => up({ projetoId: v })} options={ds.radar.projetos.filter((p) => p.empresaId === empresaId).map((p) => ({ value: p.id, label: p.nome }))} allowEmpty="—" /></Field>
        <Field label="Link"><Input value={s.url} onChange={(ev) => up({ url: ev.target.value })} /></Field>
        <Field label="Verificado" hint="confirmado na fonte"><label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={s.verificado} onChange={(ev) => up({ verificado: ev.target.checked })} /> sim</label></Field>
        <Field label="Dados brutos da fonte" hint="trecho, JSON ou anotação; guardado como raw_payload" full><textarea value={s.bruto} onChange={(ev) => up({ bruto: ev.target.value })} rows={3} style={{ width: '100%', fontSize: 12 }} /></Field>
        <Field label="Relevância estrutural" hint={`sem escolha: derivada do tipo (${RELEVANCIA_PADRAO_POR_TIPO[s.tipo] ?? 'requer análise'})`}><Select value={s.relevancia} onChange={(v) => up({ relevancia: v })} options={RELEVANCIAS.map((x) => ({ value: x, label: `${x} · ${NOME_RELEVANCIA[x]}` }))} allowEmpty="derivar do tipo" /></Field>
        <Field label="Ação recomendada por este sinal" hint="sem escolha: matriz operacional do Signal Pilot"><Select value={s.acao} onChange={(v) => up({ acao: v })} options={ACOES_SINAL.map((x) => ({ value: x, label: `${x} · ${NOME_ACAO_SINAL[x]}` }))} allowEmpty="—" /></Field>
        <Field label="O que aconteceu (fato objetivo)" full><Input value={s.oQueAconteceu} onChange={(ev) => up({ oQueAconteceu: ev.target.value })} /></Field>
        <Field label="Por que importa para a EIFF" hint="nunca é gerado automaticamente; deixe vazio se ainda requer análise" full><Input value={s.porQueImporta} onChange={(ev) => up({ porQueImporta: ev.target.value })} /></Field>
      </div>
      <div className="foot"><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" onClick={() => tentar(() => { actions.registrarSinalRadar({ empresaId, tipo: s.tipo, titulo: s.titulo, descricao: s.descricao, eventoEm: s.eventoEm, confianca: s.confianca, url: s.url || undefined, projetoId: s.projetoId || undefined, fonteId: s.fonteId || undefined, verificado: s.verificado, payload: s.bruto.trim() ? brutoDe(s.bruto) : undefined, leitura: { relevanciaEstrutural: (s.relevancia || undefined) as RelevanciaEstrutural | undefined, oQueAconteceu: s.oQueAconteceu.trim() || undefined, porQueImporta: s.porQueImporta.trim() || undefined, acaoRecomendada: (s.acao || undefined) as AcaoSinal | undefined } }); onOk('Sinal registrado e score atualizado.'); }, onErro, onClose)}>Registrar</button></div>
    </Modal>
  );
}

export function AtividadeForm({ empresaId, contatoId, oportunidadeId, onClose, onErro, onOk }: { empresaId: string; contatoId?: string; oportunidadeId?: string; onClose: () => void; onErro: (m: string) => void; onOk: (m: string) => void }) {
  const { ds } = useStore();
  const [a, setA] = useState<Atividade>(actions.novaAtividadeRadar(empresaId, { contatoId, oportunidadeId, ocorreuEm: hojeIso().slice(0, 16) }));
  const [prox, setProx] = useState<{ ativa: boolean; tipo: TipoTarefa; venceEm: string; descricao: string }>({ ativa: true, tipo: 'FOLLOW_UP', venceEm: '', descricao: '' });
  const up = (p: Partial<Atividade>) => setA({ ...a, ...p });
  const contatos = ds.radar.contatos.filter((c) => c.empresaId === empresaId && c.ativo);
  const opps = ds.radar.oportunidades.filter((o) => o.empresaId === empresaId);
  const respostas = ds.radar.tiposResposta.filter((t) => t.ativo);
  return (
    <Modal title="Registrar atividade" onClose={onClose} wide>
      <div className="form">
        <Field label="Tipo" req><Select value={a.tipo} onChange={(v) => up({ tipo: v as TipoAtividade })} options={TIPOS_ATIVIDADE.map((t) => ({ value: t, label: NOME_TIPO_ATIVIDADE[t] }))} /></Field>
        <Field label="Canal" req><Select value={a.canal} onChange={(v) => up({ canal: v as Canal })} options={CANAIS.map((c) => ({ value: c, label: NOME_CANAL[c] }))} /></Field>
        <Field label="Quando" req><Input type="datetime-local" value={a.ocorreuEm.slice(0, 16)} onChange={(ev) => up({ ocorreuEm: ev.target.value })} /></Field>
        <Field label="Contato"><Select value={a.contatoId ?? ''} onChange={(v) => up({ contatoId: v || undefined })} options={contatos.map((c) => ({ value: c.id, label: `${c.nome}${c.cargo ? ` · ${c.cargo}` : ''}` }))} allowEmpty="—" /></Field>
        <Field label="Oportunidade"><Select value={a.oportunidadeId ?? ''} onChange={(v) => up({ oportunidadeId: v || undefined })} options={opps.map((o) => ({ value: o.id, label: `${o.titulo} · ${NOME_ESTAGIO[o.estagio]}` }))} allowEmpty="—" /></Field>
        <Field label="Estratégia"><Select value={a.estrategiaId ?? ''} onChange={(v) => up({ estrategiaId: v || undefined })} options={ds.radar.estrategias.filter((e) => e.ativo).map((e) => ({ value: e.id, label: e.nome }))} allowEmpty="—" /></Field>
        <Field label="Resultado" hint="alimenta o score de intenção e relacionamento"><Select value={a.resultado ?? ''} onChange={(v) => up({ resultado: (v || undefined) as Atividade['resultado'] })} options={respostas.map((t) => ({ value: t.codigo, label: t.nome }))} allowEmpty="—" /></Field>
        <Field label="Notas" full><Input value={a.notas} onChange={(ev) => up({ notas: ev.target.value })} placeholder="o que foi dito, objeções, próximos passos" /></Field>
      </div>
      <div className="card" style={{ marginTop: 12, padding: 12 }}>
        <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={prox.ativa} onChange={(ev) => setProx({ ...prox, ativa: ev.target.checked })} /><b>Agendar a próxima ação</b> <span className="muted small">(oportunidade ativa não pode ficar sem)</span></label>
        {prox.ativa && (
          <div className="form" style={{ marginTop: 8 }}>
            <Field label="O quê" req><Select value={prox.tipo} onChange={(v) => setProx({ ...prox, tipo: v as TipoTarefa })} options={TIPOS_TAREFA.map((t) => ({ value: t, label: NOME_TIPO_TAREFA[t] }))} /></Field>
            <Field label="Quando" req><Input type="date" value={prox.venceEm} onChange={(ev) => setProx({ ...prox, venceEm: ev.target.value })} /></Field>
            <Field label="Descrição" req full><Input value={prox.descricao} onChange={(ev) => setProx({ ...prox, descricao: ev.target.value })} placeholder="Enviar apresentação e agendar visita técnica" /></Field>
          </div>
        )}
      </div>
      <div className="foot"><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" onClick={() => tentar(() => { actions.registrarAtividadeRadar({ ...a, ocorreuEm: a.ocorreuEm.length === 16 ? `${a.ocorreuEm}:00` : a.ocorreuEm }, prox.ativa ? { tipo: prox.tipo, venceEm: prox.venceEm, descricao: prox.descricao } : undefined); onOk('Atividade registrada.'); }, onErro, onClose)}>Registrar</button></div>
    </Modal>
  );
}

export function TarefaForm({ inicial, onClose, onErro, onOk }: FormProps<TarefaRadar>) {
  const { ds } = useStore();
  const [t, setT] = useState(inicial);
  const up = (p: Partial<TarefaRadar>) => setT({ ...t, ...p });
  return (
    <Modal title={t.descricao ? 'Tarefa' : 'Nova tarefa'} onClose={onClose}>
      <div className="form">
        <Field label="Tipo"><Select value={t.tipo} onChange={(v) => up({ tipo: v as TipoTarefa })} options={TIPOS_TAREFA.map((x) => ({ value: x, label: NOME_TIPO_TAREFA[x] }))} /></Field>
        <Field label="Prioridade"><Select value={t.prioridade} onChange={(v) => up({ prioridade: v as TarefaRadar['prioridade'] })} options={['Alta', 'Normal', 'Baixa']} /></Field>
        <Field label="Prazo" req><Input type="date" value={t.venceEm.slice(0, 10)} onChange={(ev) => up({ venceEm: ev.target.value })} /></Field>
        <Field label="Responsável" req><Select value={t.responsavelId} onChange={(v) => up({ responsavelId: v })} options={ds.usuarios.filter((u) => u.ativo).map((u) => ({ value: u.id, label: u.nome }))} /></Field>
        <Field label="Contato"><Select value={t.contatoId ?? ''} onChange={(v) => up({ contatoId: v || undefined })} options={ds.radar.contatos.filter((c) => c.empresaId === t.empresaId).map((c) => ({ value: c.id, label: c.nome }))} allowEmpty="—" /></Field>
        <Field label="Oportunidade"><Select value={t.oportunidadeId ?? ''} onChange={(v) => up({ oportunidadeId: v || undefined })} options={ds.radar.oportunidades.filter((o) => o.empresaId === t.empresaId).map((o) => ({ value: o.id, label: o.titulo }))} allowEmpty="—" /></Field>
        <Field label="Descrição" req full><Input value={t.descricao} onChange={(ev) => up({ descricao: ev.target.value })} /></Field>
      </div>
      <div className="foot"><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" onClick={() => tentar(() => { actions.salvarTarefaRadar(t); onOk('Tarefa salva.'); }, onErro, onClose)}>Salvar</button></div>
    </Modal>
  );
}

export function ConcluirTarefaForm({ tarefa, onClose, onErro, onOk }: { tarefa: TarefaRadar; onClose: () => void; onErro: (m: string) => void; onOk: (m: string) => void }) {
  const [prox, setProx] = useState<{ ativa: boolean; tipo: TipoTarefa; venceEm: string; descricao: string }>({ ativa: !!tarefa.oportunidadeId, tipo: 'FOLLOW_UP', venceEm: '', descricao: '' });
  return (
    <Modal title="Concluir tarefa" onClose={onClose}>
      <p><b>{tarefa.descricao}</b> <span className="muted small">· prazo {d(tarefa.venceEm)}</span></p>
      <label className="row" style={{ gap: 8, marginTop: 8 }}><input type="checkbox" checked={prox.ativa} onChange={(ev) => setProx({ ...prox, ativa: ev.target.checked })} /><b>Agendar a próxima ação</b></label>
      {prox.ativa && (
        <div className="form" style={{ marginTop: 8 }}>
          <Field label="O quê"><Select value={prox.tipo} onChange={(v) => setProx({ ...prox, tipo: v as TipoTarefa })} options={TIPOS_TAREFA.map((t) => ({ value: t, label: NOME_TIPO_TAREFA[t] }))} /></Field>
          <Field label="Quando" req><Input type="date" value={prox.venceEm} onChange={(ev) => setProx({ ...prox, venceEm: ev.target.value })} /></Field>
          <Field label="Descrição" req full><Input value={prox.descricao} onChange={(ev) => setProx({ ...prox, descricao: ev.target.value })} /></Field>
        </div>
      )}
      <div className="foot"><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" onClick={() => tentar(() => { actions.concluirTarefaRadar(tarefa.id, prox.ativa ? { tipo: prox.tipo, venceEm: prox.venceEm, descricao: prox.descricao } : undefined); onOk('Tarefa concluída.'); }, onErro, onClose)}>Concluir</button></div>
    </Modal>
  );
}

export function OportunidadeForm({ inicial, onClose, onErro, onOk }: FormProps<Oportunidade>) {
  const { ds } = useStore();
  const [o, setO] = useState(inicial);
  const [motivo, setMotivo] = useState('');
  const up = (p: Partial<Oportunidade>) => setO({ ...o, ...p });
  const existe = ds.radar.oportunidades.some((x) => x.id === o.id);
  const salvar = () => tentar(() => {
    if (existe && inicial.estagio !== o.estagio) { actions.mudarEstagioRadar(o.id, o.estagio, { motivo, proximaAcao: o.proximaAcao, proximaAcaoEm: o.proximaAcaoEm, valorEstimado: o.valorEstimado }); actions.salvarOportunidadeRadar({ ...o, estagio: o.estagio, motivoFechamento: motivo || o.motivoFechamento }); }
    else actions.salvarOportunidadeRadar(o);
    onOk('Oportunidade salva.');
  }, onErro, onClose);
  return (
    <Modal title={existe ? o.titulo : 'Nova oportunidade'} onClose={onClose} wide>
      <div className="form">
        <Field label="Título" req full><Input value={o.titulo} onChange={(ev) => up({ titulo: ev.target.value })} /></Field>
        <Field label="Estágio" req><Select value={o.estagio} onChange={(v) => up({ estagio: v as Estagio })} options={ESTAGIOS.map((e) => ({ value: e, label: NOME_ESTAGIO[e] }))} /></Field>
        <Field label="Responsável" req><Select value={o.responsavelId} onChange={(v) => up({ responsavelId: v })} options={ds.usuarios.filter((u) => u.ativo).map((u) => ({ value: u.id, label: u.nome }))} /></Field>
        <Field label="Valor estimado (R$)"><NumberInput value={o.valorEstimado ?? 0} onChange={(v) => up({ valorEstimado: v || undefined })} /></Field>
        <Field label="Previsão de fechamento"><Input type="date" value={o.previsaoFechamento ?? ''} onChange={(ev) => up({ previsaoFechamento: ev.target.value || undefined })} /></Field>
        <Field label="Projeto"><Select value={o.projetoId ?? ''} onChange={(v) => up({ projetoId: v || undefined })} options={ds.radar.projetos.filter((p) => p.empresaId === o.empresaId).map((p) => ({ value: p.id, label: p.nome }))} allowEmpty="—" /></Field>
        <Field label="Estratégia"><Select value={o.estrategiaId ?? ''} onChange={(v) => up({ estrategiaId: v || undefined })} options={ds.radar.estrategias.filter((e) => e.ativo).map((e) => ({ value: e.id, label: e.nome }))} allowEmpty="—" /></Field>
        <Field label="Próxima ação" req hint="obrigatória em estágio ativo"><Input value={o.proximaAcao ?? ''} onChange={(ev) => up({ proximaAcao: ev.target.value || undefined })} placeholder="Ligar para confirmar o cronograma" /></Field>
        <Field label="Quando" req><Input type="date" value={o.proximaAcaoEm?.slice(0, 10) ?? ''} onChange={(ev) => up({ proximaAcaoEm: ev.target.value || undefined })} /></Field>
        {(o.estagio === 'WON' || o.estagio === 'LOST') && <Field label={o.estagio === 'WON' ? 'Motivo do ganho' : 'Motivo da perda'} req full><Input value={motivo} onChange={(ev) => setMotivo(ev.target.value)} /></Field>}
        <Field label="Observações" full><Input value={o.observacoes} onChange={(ev) => up({ observacoes: ev.target.value })} /></Field>
      </div>
      <div className="foot"><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" onClick={salvar}>Salvar</button></div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Importacao CSV
// ---------------------------------------------------------------------------
/** Contexto que pode ir para o log: tipo, contagem de linhas, cabecalho e mensagem. Nunca o conteudo do CSV, e-mails ou nomes. */
export function contextoImportacaoSanitizado(x: { tipo: string; arquivo: string; texto: string; erro: unknown }): Record<string, unknown> {
  const primeiraLinha = x.texto.split(/\r?\n/, 1)[0] ?? '';
  const e = x.erro as { message?: string; stack?: string } | undefined;
  return { onde: 'radar/importacao', tipo: x.tipo, arquivo: x.arquivo.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '***@***'), linhas: Math.max(0, x.texto.split(/\r?\n/).filter((l) => l.trim()).length - 1), bytes: x.texto.length, cabecalho: primeiraLinha.slice(0, 400).split(/[;,\t]/).map((c) => c.trim()).slice(0, 60), mensagem: String(e?.message ?? x.erro).slice(0, 300), stack: String(e?.stack ?? '').split('\n').slice(0, 4).join(' | ').slice(0, 600) };
}

interface ErroImportacaoState { erro?: unknown }
/** Error boundary do importador: nao esconde o erro (mostra na tela) e registra so contexto sanitizado no console. */
class ErroImportacao extends React.Component<{ contexto: () => Record<string, unknown>; onClose: () => void; children: React.ReactNode }, ErroImportacaoState> {
  state: ErroImportacaoState = {};
  static getDerivedStateFromError(erro: unknown): ErroImportacaoState { return { erro }; }
  componentDidCatch(erro: unknown) { console.error('[radar/importacao] erro de interface', { ...this.props.contexto(), mensagem: String((erro as Error)?.message ?? erro).slice(0, 300) }); }
  render() {
    if (!this.state.erro) return this.props.children;
    const m = String((this.state.erro as Error)?.message ?? this.state.erro);
    return (
      <div className="form">
        <p><b>Erro de interface no importador:</b> {m}</p>
        <p className="small muted">A importação em si pode ter sido concluída: confira em Command Center › Importações. O contexto sanitizado (tipo, contagem de linhas, cabeçalho e mensagem, sem dados pessoais) foi registrado no console do navegador.</p>
        <div className="foot"><button className="btn primary" onClick={this.props.onClose}>Fechar</button></div>
      </div>
    );
  }
}

export function ImportarForm(props: { onClose: () => void; onErro: (m: string) => void; onOk: (m: string) => void }) {
  const ctx = React.useRef<() => Record<string, unknown>>(() => ({ onde: 'radar/importacao' }));
  return (
    <Modal title="Importar planilha (CSV)" onClose={props.onClose} wide>
      <ErroImportacao contexto={() => ctx.current()} onClose={props.onClose}><ImportarFormInterno {...props} contexto={ctx} /></ErroImportacao>
    </Modal>
  );
}

function ImportarFormInterno({ onClose, onErro, onOk, contexto }: { onClose: () => void; onErro: (m: string) => void; onOk: (m: string) => void; contexto: React.MutableRefObject<() => Record<string, unknown>> }) {
  const { ds } = useStore();
  const [tipo, setTipo] = useState<'empresas' | 'contatos'>('empresas');
  const [fonteId, setFonteId] = useState(ds.radar.fontes.find((f) => f.codigo === 'CSV')?.id ?? '');
  const [texto, setTexto] = useState('');
  const [arquivo, setArquivo] = useState('colado');
  const [job, setJob] = useState<ImportacaoJob | null>(null);
  const [dry, setDry] = useState<DryRunContatos | null>(null);
  const previa = texto.trim() ? (tipo === 'empresas' ? normalizarEmpresasCsv(texto) : normalizarContatosCsv(texto)) : undefined;
  const colunas = previa ? previa.cabecalho.map((c, i) => ({ c, campo: previa.colunas[i] })) : [];
  const ler = (f: File) => { const r = new FileReader(); r.onload = () => { setTexto(String(r.result ?? '')); setArquivo(f.name); }; r.readAsText(f, 'utf-8'); };
  const linhas = previa ? ('empresas' in previa ? previa.empresas.length : previa.contatos.length) : 0;
  contexto.current = () => contextoImportacaoSanitizado({ tipo, arquivo, texto, erro: undefined });
  return (
    <>
      {job ? (
        <>
          <p><b>Importação {job.status.toLowerCase()}</b> · {job.total} linha(s): {job.importados} nova(s), {job.atualizados} atualizada(s), {job.duplicados} possível(is) duplicata(s), {job.revisao ?? 0} para revisão, {job.erros} erro(s).</p>
          {!!job.duplicados && <p className="small">Revise as duplicatas em Command Center › Duplicatas antes de trabalhar essas empresas.</p>}
          {!!job.revisao && <p className="small">{job.revisao} contato(s) com empresa ambígua ou não encontrada foram para Command Center › Fila de revisão: nenhuma empresa foi criada automaticamente.</p>}
          {!!job.erros && <div style={{ maxHeight: 220, overflow: 'auto' }}><table className="small"><thead><tr><th>Linha</th><th>Campo</th><th>Erro</th></tr></thead><tbody>{ds.radar.importacaoErros.filter((e) => e.jobId === job.id).map((e) => <tr key={e.id}><td>{e.numero}</td><td>{e.campo ?? '—'}</td><td>{e.mensagem}</td></tr>)}</tbody></table></div>}
          <div className="foot"><button className="btn primary" onClick={onClose}>Fechar</button></div>
        </>
      ) : (
        <>
          <div className="form">
            <Field label="O que a planilha contém"><Select value={tipo} onChange={(v) => setTipo(v as 'empresas')} options={[{ value: 'empresas', label: 'Empresas' }, { value: 'contatos', label: 'Contatos (com a empresa em cada linha)' }]} /></Field>
            <Field label="Fonte" hint="fica registrada em cada empresa e contato"><Select value={fonteId} onChange={setFonteId} options={ds.radar.fontes.filter((f) => f.ativo).map((f) => ({ value: f.id, label: f.nome }))} /></Field>
            <Field label="Arquivo CSV"><input type="file" accept=".csv,.txt,.tsv" onChange={(ev) => { const f = ev.target.files?.[0]; if (f) ler(f); }} /></Field>
            <Field label="Nome do arquivo / dataset" hint="fica no job de importação (lineage)"><Input value={arquivo} onChange={(ev) => setArquivo(ev.target.value)} /></Field>
            <Field label="Ou cole o conteúdo (com cabeçalho)" full><textarea value={texto} onChange={(ev) => setTexto(ev.target.value)} rows={7} style={{ width: '100%', fontFamily: 'monospace', fontSize: 12 }} placeholder={tipo === 'empresas' ? 'Razão Social;CNPJ;Cidade;UF;Setor;Funcionários;Site' : 'Empresa ID;Empresa;Domínio;Nome;Cargo;Departamento;Senioridade;E-mail;Status do e-mail;Celular;LinkedIn;Fonte'} /></Field>
          </div>
          {!!colunas.length && (
            <div className="small" style={{ marginTop: 8 }}>
              <b>{linhas} linha(s)</b> · colunas reconhecidas: {colunas.map(({ c, campo }) => <Badge key={c} tone={campo ? 'ok' : 'muted'}>{c}{campo ? ` → ${campo}` : ' (ignorada)'}</Badge>)}
            </div>
          )}
          {dry && tipo === 'contatos' && (
            <div className="card small" style={{ marginTop: 8 }}>
              <b>Dry run (nada foi gravado)</b>
              <div className="grid cols-2" style={{ marginTop: 6 }}>
                <ul style={{ margin: 0, paddingLeft: 18 }}>{relatorioDryRun(dry).map((l) => <li key={l}>{l}</li>)}</ul>
                <div style={{ maxHeight: 260, overflow: 'auto' }}>
                  <table className="small"><thead><tr><th>#</th><th>Contato</th><th>Empresa</th><th>Associação</th><th>Persona</th><th className="num">Fit</th><th>Status</th></tr></thead>
                    <tbody>{dry.detalhes.map((x) => <tr key={x.numero}><td>{x.numero}</td><td>{x.nome}</td><td>{x.empresa}</td><td>{x.associacao || '—'}</td><td>{x.persona ? NOME_PERSONA[x.persona] : '—'}</td><td className="num">{x.decisionFit ?? '—'}</td><td><Badge tone={x.status === 'ok' ? 'ok' : x.status === 'invalido' ? 'bad' : 'warn'}>{x.status}</Badge>{x.mensagem ? <span className="muted"> {x.mensagem}</span> : null}</td></tr>)}</tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
          <p className="small muted" style={{ marginTop: 8 }}>Deduplicação por CNPJ, domínio, razão social + cidade/UF e nome parecido. Empresas iguais são atualizadas só nos campos vazios; parecidas entram como possíveis duplicatas para revisão. Cada linha bruta fica guardada com a fonte.</p>
          <div className="foot"><button className="btn" onClick={onClose}>Cancelar</button>{tipo === 'contatos' && <button className="btn" disabled={!linhas} onClick={() => tentar(() => { setDry(dryRunContatosCsv(texto, ds.radar, ds.params.dataBase)); }, onErro)}>Dry run (simular sem gravar)</button>}<button className="btn primary" disabled={!linhas} onClick={() => tentar(() => { try { const j = actions.importarCsvRadar(texto, { tipo, fonteId, arquivo }); setJob(j); onOk(`Importação: ${j.importados} nova(s), ${j.atualizados} atualizada(s).`); } catch (e) { console.error('[radar/importacao] falha na importação', contextoImportacaoSanitizado({ tipo, arquivo, texto, erro: e })); throw e; } }, onErro)}>Importar {linhas ? `${linhas} linha(s)` : ''}</button></div>
        </>
      )}
    </>
  );
}

export const valor = (v?: number) => (v ? money(v, true) : '—');
export const RESPOSTA_NOME = (codigo?: string, tipos: { codigo: string; nome: string }[] = []) => tipos.find((t) => t.codigo === codigo)?.nome ?? codigo ?? '—';
export const codigosResposta = CODIGOS_RESPOSTA;
