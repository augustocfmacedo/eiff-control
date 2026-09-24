// EIFF Inbox — configuracao minima (permissao inbox_config): setores, equipes, membros, fallback/escalacao e SLA.
// Fase 3 (Octopus Router): limiares de confianca, modo de automacao padrao e regras de roteamento/automacao editaveis
// como DADOS tipados (linhas simples, sem DSL); a validacao mora no store (validarConfiguracaoOctopus).
import React, { useState } from 'react';
import { MODOS_AUTOMACAO, PRIORIDADES, RISCOS, metricasShadow, ultimasDecisoes, type DecisaoObservada, type ConfiguracaoInbox, type Equipe, type MembroSetor, type ModoAutomacao, type Prioridade, type RegraAutomacao, type RegraRoteamento, type Risco, type Setor, type TipoRelacao } from '../core/inbox';
import { RegraDeNegocioError, actions, pode, useStore } from '../data/store';
import { Badge, EstadoErro, Field, Input, Link, PageHead, Select, Tabs, dataHora, useToast } from '../ui/components';

const erroDe = (e: unknown) => (e instanceof RegraDeNegocioError || e instanceof Error ? e.message : String(e));

export default function InboxConfig() {
  const { ds, usuario } = useStore();
  const { toast, el } = useToast();
  const [aba, setAba] = useState<'setores' | 'equipes' | 'membros' | 'roteamento' | 'shadow'>('setores');
  if (!pode(usuario, 'inbox_config')) {
    return <EstadoErro titulo="Acesso restrito" causa={<>A configuração do EIFF Inbox exige a permissão <code>inbox_config</code> (Administrador e Diretoria). Seu perfil é <b>{usuario.papel}</b>.</>}>Peça ao Administrador se precisar alterar setores, equipes ou membros.</EstadoErro>;
  }
  const inbox = ds.inbox;
  if (!inbox) return <EstadoErro titulo="Inbox indisponível" causa="O slice do Inbox não foi carregado.">Recarregue os dados.</EstadoErro>;
  const tentar = (fn: () => unknown, ok: string) => { try { fn(); toast(ok); } catch (e) { toast(erroDe(e)); } };
  const usuarios = ds.usuarios.filter((u) => u.ativo);
  const nomeUsuario = (id?: string) => (id ? usuarios.find((u) => u.id === id)?.nome ?? ds.usuarios.find((u) => u.id === id)?.nome ?? id : '—');
  const setoresOrdenados = [...inbox.setores].sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome));

  return (
    <>
      <PageHead title="EIFF Inbox · Configuração" subtitle={<>Setores, equipes, membros e roteamento. <Link to="/atendimento">Voltar ao Inbox</Link></>} />
      <div className="card">
        <Tabs value={aba} onChange={setAba} items={[{ id: 'setores', label: `Setores (${inbox.setores.length})` }, { id: 'equipes', label: `Equipes (${inbox.equipes.length})` }, { id: 'membros', label: `Membros (${inbox.membros.length})` }, { id: 'roteamento', label: 'Roteamento e SLA' }, { id: 'shadow', label: 'Shadow mode' }]} />
        {aba === 'setores' && <Setores setores={setoresOrdenados} usuarios={usuarios} nomeUsuario={nomeUsuario} onSalvar={(s) => tentar(() => actions.inboxSalvarSetor(s), 'Setor salvo')} />}
        {aba === 'equipes' && <Equipes equipes={inbox.equipes} setores={setoresOrdenados} usuarios={usuarios} nomeUsuario={nomeUsuario} onSalvar={(e) => tentar(() => actions.inboxSalvarEquipe(e), 'Equipe salva')} />}
        {aba === 'membros' && <Membros membros={inbox.membros} equipes={inbox.equipes} setores={setoresOrdenados} usuarios={usuarios} nomeUsuario={nomeUsuario} onSalvar={(m) => tentar(() => actions.inboxSalvarMembro(m), 'Membro salvo')} onRemover={(id) => { if (window.confirm('Remover este membro do setor?')) tentar(() => actions.inboxRemoverMembro(id), 'Membro removido'); }} />}
        {aba === 'shadow' && <ShadowMode decisoes={ultimasDecisoes(inbox, 20)} metricas={metricasShadow(inbox)} nomeSetor={(c) => (c ? inbox.setores.find((s) => s.codigo === c)?.nome ?? c : '—')} nomeEquipe={(id) => (id ? inbox.equipes.find((e) => e.id === id)?.nome ?? id : '')} nomeUsuario={nomeUsuario} />}
        {aba === 'roteamento' && <Roteamento cfg={inbox.configuracao} setores={setoresOrdenados} equipes={inbox.equipes} usuarios={usuarios} onSalvar={(c) => tentar(() => actions.inboxSalvarConfiguracao(c), 'Configuração salva')} />}
      </div>
      {el}
    </>
  );
}

function Setores({ setores, usuarios, nomeUsuario, onSalvar }: { setores: Setor[]; usuarios: { id: string; nome: string }[]; nomeUsuario: (id?: string) => string; onSalvar: (s: Setor) => void }) {
  const [edit, setEdit] = useState<Setor | null>(null);
  const novo = () => setEdit({ codigo: '', nome: '', ativo: true, ordem: (setores.at(-1)?.ordem ?? 0) + 1 });
  return (
    <>
      <div className="actions" style={{ marginBottom: 10 }}><button className="btn sm primary" onClick={novo}>Novo setor</button></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Ordem</th><th>Código</th><th>Nome</th><th>Responsável padrão</th><th>Situação</th><th /></tr></thead>
        <tbody>{setores.map((s) => (
          <tr key={s.codigo}><td className="num">{s.ordem}</td><td className="mono">{s.codigo}</td><td>{s.nome}</td><td>{nomeUsuario(s.responsavelPadraoId)}</td><td><Badge tone={s.ativo ? 'ok' : 'muted'}>{s.ativo ? 'ativo' : 'inativo'}</Badge></td><td><button className="btn sm" onClick={() => setEdit(s)}>Editar</button></td></tr>
        ))}</tbody>
      </table></div>
      {edit && (
        <div className="card" style={{ marginTop: 12 }}>
          <h3>{setores.some((s) => s.codigo === edit.codigo) ? 'Editar setor' : 'Novo setor'}</h3>
          <div className="form">
            <Field label="Código" req hint="maiúsculas, números e _; não muda depois de criado"><Input value={edit.codigo} onChange={(e) => setEdit({ ...edit, codigo: e.target.value.toUpperCase() })} disabled={setores.some((s) => s.codigo === edit.codigo)} /></Field>
            <Field label="Nome" req><Input value={edit.nome} onChange={(e) => setEdit({ ...edit, nome: e.target.value })} /></Field>
            <Field label="Ordem"><Input type="number" value={edit.ordem} onChange={(e) => setEdit({ ...edit, ordem: Number(e.target.value) })} /></Field>
            <Field label="Responsável padrão"><Select value={edit.responsavelPadraoId ?? ''} onChange={(v) => setEdit({ ...edit, responsavelPadraoId: v || undefined })} allowEmpty="— nenhum (fica em Não atribuídos) —" options={usuarios.map((u) => ({ value: u.id, label: u.nome }))} /></Field>
            <Field label="Situação"><Select value={edit.ativo ? 'ativo' : 'inativo'} onChange={(v) => setEdit({ ...edit, ativo: v === 'ativo' })} options={['ativo', 'inativo']} /></Field>
            <div className="full actions"><button className="btn primary" disabled={!edit.codigo.trim() || !edit.nome.trim()} onClick={() => { onSalvar(edit); setEdit(null); }}>Salvar</button><button className="btn" onClick={() => setEdit(null)}>Cancelar</button></div>
          </div>
        </div>
      )}
    </>
  );
}

function Equipes({ equipes, setores, usuarios, nomeUsuario, onSalvar }: { equipes: Equipe[]; setores: Setor[]; usuarios: { id: string; nome: string }[]; nomeUsuario: (id?: string) => string; onSalvar: (e: Omit<Equipe, 'id'> & { id?: string }) => void }) {
  const [edit, setEdit] = useState<(Omit<Equipe, 'id'> & { id?: string }) | null>(null);
  const nomeSetor = (c: string) => setores.find((s) => s.codigo === c)?.nome ?? c;
  return (
    <>
      <div className="actions" style={{ marginBottom: 10 }}><button className="btn sm primary" onClick={() => setEdit({ setorCodigo: setores[0]?.codigo ?? '', nome: '', ativo: true, ordem: 1 })}>Nova equipe</button></div>
      {equipes.length === 0 ? <div className="muted small">Nenhuma equipe. O roteamento funciona só por setor; equipes refinam quem atende.</div> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Setor</th><th>Equipe</th><th>Ordem</th><th>Responsável padrão</th><th>Situação</th><th /></tr></thead>
          <tbody>{[...equipes].sort((a, b) => a.setorCodigo.localeCompare(b.setorCodigo) || a.ordem - b.ordem).map((e) => (
            <tr key={e.id}><td>{nomeSetor(e.setorCodigo)}</td><td>{e.nome}</td><td className="num">{e.ordem}</td><td>{nomeUsuario(e.responsavelPadraoId)}</td><td><Badge tone={e.ativo ? 'ok' : 'muted'}>{e.ativo ? 'ativa' : 'inativa'}</Badge></td><td><button className="btn sm" onClick={() => setEdit(e)}>Editar</button></td></tr>
          ))}</tbody>
        </table></div>
      )}
      {edit && (
        <div className="card" style={{ marginTop: 12 }}>
          <h3>{edit.id ? 'Editar equipe' : 'Nova equipe'}</h3>
          <div className="form">
            <Field label="Setor" req><Select value={edit.setorCodigo} onChange={(v) => setEdit({ ...edit, setorCodigo: v })} options={setores.map((s) => ({ value: s.codigo, label: s.nome }))} /></Field>
            <Field label="Nome" req><Input value={edit.nome} onChange={(e) => setEdit({ ...edit, nome: e.target.value })} /></Field>
            <Field label="Ordem"><Input type="number" value={edit.ordem} onChange={(e) => setEdit({ ...edit, ordem: Number(e.target.value) })} /></Field>
            <Field label="Responsável padrão"><Select value={edit.responsavelPadraoId ?? ''} onChange={(v) => setEdit({ ...edit, responsavelPadraoId: v || undefined })} allowEmpty="— o do setor —" options={usuarios.map((u) => ({ value: u.id, label: u.nome }))} /></Field>
            <Field label="Situação"><Select value={edit.ativo ? 'ativa' : 'inativa'} onChange={(v) => setEdit({ ...edit, ativo: v === 'ativa' })} options={['ativa', 'inativa']} /></Field>
            <div className="full actions"><button className="btn primary" disabled={!edit.nome.trim() || !edit.setorCodigo} onClick={() => { onSalvar(edit); setEdit(null); }}>Salvar</button><button className="btn" onClick={() => setEdit(null)}>Cancelar</button></div>
          </div>
        </div>
      )}
    </>
  );
}

function Membros({ membros, equipes, setores, usuarios, nomeUsuario, onSalvar, onRemover }: { membros: MembroSetor[]; equipes: Equipe[]; setores: Setor[]; usuarios: { id: string; nome: string; papel: string }[]; nomeUsuario: (id?: string) => string; onSalvar: (m: Omit<MembroSetor, 'id'> & { id?: string }) => void; onRemover: (id: string) => void }) {
  const [edit, setEdit] = useState<(Omit<MembroSetor, 'id'> & { id?: string }) | null>(null);
  const nomeSetor = (c: string) => setores.find((s) => s.codigo === c)?.nome ?? c;
  const equipesDo = (setor: string) => equipes.filter((e) => e.setorCodigo === setor && e.ativo);
  return (
    <>
      <div className="actions" style={{ marginBottom: 10 }}><button className="btn sm primary" onClick={() => setEdit({ usuarioId: usuarios[0]?.id ?? '', setorCodigo: setores[0]?.codigo ?? '', papel: 'atendente' })}>Novo membro</button><span className="small muted">Administrador e Diretoria veem tudo mesmo sem estar em setor. Gestor vê o setor inteiro; atendente vê o setor, o que é dele e o que ainda não tem setor.</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Usuário</th><th>Setor</th><th>Equipe</th><th>Papel</th><th /></tr></thead>
        <tbody>{[...membros].sort((a, b) => a.setorCodigo.localeCompare(b.setorCodigo) || nomeUsuario(a.usuarioId).localeCompare(nomeUsuario(b.usuarioId))).map((m) => (
          <tr key={m.id}><td>{nomeUsuario(m.usuarioId)}</td><td>{nomeSetor(m.setorCodigo)}</td><td>{m.equipeId ? equipes.find((e) => e.id === m.equipeId)?.nome ?? '—' : '—'}</td><td><Badge tone={m.papel === 'gestor' ? 'info' : 'muted'}>{m.papel}</Badge></td><td className="actions"><button className="btn sm" onClick={() => setEdit(m)}>Editar</button><button className="btn sm danger" onClick={() => onRemover(m.id)}>Remover</button></td></tr>
        ))}</tbody>
      </table></div>
      {edit && (
        <div className="card" style={{ marginTop: 12 }}>
          <h3>{edit.id ? 'Editar membro' : 'Novo membro'}</h3>
          <div className="form">
            <Field label="Usuário" req><Select value={edit.usuarioId} onChange={(v) => setEdit({ ...edit, usuarioId: v })} options={usuarios.map((u) => ({ value: u.id, label: `${u.nome} · ${u.papel}` }))} /></Field>
            <Field label="Setor" req><Select value={edit.setorCodigo} onChange={(v) => setEdit({ ...edit, setorCodigo: v, equipeId: undefined })} options={setores.map((s) => ({ value: s.codigo, label: s.nome }))} /></Field>
            <Field label="Equipe"><Select value={edit.equipeId ?? ''} onChange={(v) => setEdit({ ...edit, equipeId: v || undefined })} allowEmpty="— setor inteiro —" options={equipesDo(edit.setorCodigo).map((e) => ({ value: e.id, label: e.nome }))} /></Field>
            <Field label="Papel"><Select value={edit.papel} onChange={(v) => setEdit({ ...edit, papel: v as MembroSetor['papel'] })} options={['atendente', 'gestor']} /></Field>
            <div className="full actions"><button className="btn primary" disabled={!edit.usuarioId || !edit.setorCodigo} onClick={() => { onSalvar(edit); setEdit(null); }}>Salvar</button><button className="btn" onClick={() => setEdit(null)}>Cancelar</button></div>
          </div>
        </div>
      )}
    </>
  );
}

function Roteamento({ cfg, setores, equipes, usuarios, onSalvar }: { cfg: ConfiguracaoInbox; setores: Setor[]; equipes: Equipe[]; usuarios: { id: string; nome: string }[]; onSalvar: (c: Partial<ConfiguracaoInbox>) => void }) {
  const [c, setC] = useState({ setorFallback: cfg.setorFallback, setorEscalacao: cfg.setorEscalacao, slaHorasPorPrioridade: { ...cfg.slaHorasPorPrioridade }, nivelPadrao: cfg.nivelPadrao, autoRoteamento: { ...cfg.autoRoteamento } });
  const [regras, setRegras] = useState<RegraRoteamento[]>(cfg.regrasRoteamento.map((r) => ({ ...r, condicao: { ...r.condicao }, destino: { ...r.destino } })));
  const [automacao, setAutomacao] = useState<RegraAutomacao[]>(cfg.regrasAutomacao.map((r) => ({ ...r })));
  const ativos = setores.filter((s) => s.ativo);
  const a = c.autoRoteamento;
  const pct = (v: number) => Math.round(v * 100);
  const setPct = (k: 'confiancaAtribuirPessoa' | 'confiancaAtribuirSetor' | 'confiancaTransferir', v: string) => setC({ ...c, autoRoteamento: { ...a, [k]: Math.max(0, Math.min(100, Number(v))) / 100 } });
  const lista = (v?: string[]) => (v ?? []).join(', ');
  const deLista = (v: string) => v.split(',').map((x) => x.trim()).filter(Boolean);
  const upR = (i: number, p: Partial<RegraRoteamento>) => setRegras(regras.map((r, k) => (k === i ? { ...r, ...p } : r)));
  const upA = (i: number, p: Partial<RegraAutomacao>) => setAutomacao(automacao.map((r, k) => (k === i ? { ...r, ...p } : r)));
  return (
    <>
      <div className="form">
        <Field label="Setor de fallback" hint="recebe o que nenhuma regra roteou"><Select value={c.setorFallback} onChange={(v) => setC({ ...c, setorFallback: v })} options={ativos.map((s) => ({ value: s.codigo, label: s.nome }))} /></Field>
        <Field label="Setor de escalação" hint="para onde escala quando o SLA vence"><Select value={c.setorEscalacao} onChange={(v) => setC({ ...c, setorEscalacao: v })} options={ativos.map((s) => ({ value: s.codigo, label: s.nome }))} /></Field>
        <Field label="Nível padrão" hint="A = IA responde · B = IA prepara · C = humano"><Select value={c.nivelPadrao} onChange={(v) => setC({ ...c, nivelPadrao: v as 'A' | 'B' | 'C' })} options={['A', 'B', 'C']} /></Field>
        {PRIORIDADES.map((p) => <Field key={p} label={`SLA ${p} (horas)`}><Input type="number" min={0.5} step={0.5} value={c.slaHorasPorPrioridade[p]} onChange={(e) => setC({ ...c, slaHorasPorPrioridade: { ...c.slaHorasPorPrioridade, [p]: Number(e.target.value) } })} /></Field>)}
        <h3 className="full" style={{ marginTop: 8 }}>Octopus Router · confiança e automação</h3>
        <Field label="Atribuir pessoa a partir de (%)" hint="banda HIGH: setor, equipe e responsável automáticos"><Input type="number" min={0} max={100} value={pct(a.confiancaAtribuirPessoa)} onChange={(e) => setPct('confiancaAtribuirPessoa', e.target.value)} /></Field>
        <Field label="Atribuir setor a partir de (%)" hint="banda MEDIUM: só setor/equipe; abaixo vai para Não atribuídos"><Input type="number" min={0} max={100} value={pct(a.confiancaAtribuirSetor)} onChange={(e) => setPct('confiancaAtribuirSetor', e.target.value)} /></Field>
        <Field label="Automação padrão" hint="quando nenhuma regra decide"><Select value={a.automacaoPadrao} onChange={(v) => setC({ ...c, autoRoteamento: { ...a, automacaoPadrao: v as ModoAutomacao } })} options={[...MODOS_AUTOMACAO]} /></Field>
        <Field label="Transferência automática" hint="reavaliação move a conversa sozinha (nunca com override humano nem com responsável)"><Select value={a.transferenciaAutomatica ? 'sim' : 'nao'} onChange={(v) => setC({ ...c, autoRoteamento: { ...a, transferenciaAutomatica: v === 'sim' } })} options={[{ value: 'nao', label: 'Não: só recomenda' }, { value: 'sim', label: 'Sim, acima da confiança abaixo' }]} /></Field>
        <Field label="Transferir sozinho a partir de (%)"><Input type="number" min={0} max={100} value={pct(a.confiancaTransferir)} onChange={(e) => setPct('confiancaTransferir', e.target.value)} /></Field>
        <div className="full actions"><button className="btn primary" onClick={() => onSalvar({ ...c, regrasRoteamento: regras, regrasAutomacao: automacao })}>Salvar</button></div>
      </div>
      <h3 style={{ marginTop: 16 }}>Regras de roteamento <button className="btn sm" style={{ marginLeft: 8 }} onClick={() => setRegras([...regras, { id: `ROT-${String(regras.length + 1).padStart(2, '0')}`, ordem: regras.length + 1, condicao: { palavras: [] }, destino: { setorCodigo: ativos[0]?.codigo ?? '' }, motivo: '', ativa: true }])}>Adicionar</button></h3>
      <p className="small muted">A primeira regra que casa (por ordem) decide o setor e vence qualquer sugestão da IA. Condições: intenções, palavras no texto, tipo de relação do contato (separe por vírgula). Sem regra, valem a memória operacional, o catálogo de intenções, a IA e o fallback.</p>
      <div className="table-wrap"><table>
        <thead><tr><th>Id</th><th>Ordem</th><th>Intenções</th><th>Palavras</th><th>Relação</th><th>Setor</th><th>Equipe</th><th>Responsável</th><th>Prioridade</th><th>Motivo</th><th>Ativa</th><th /></tr></thead>
        <tbody>
          {regras.map((r, i) => (
            <tr key={i}>
              <td><Input value={r.id} onChange={(e) => upR(i, { id: e.target.value })} style={{ width: 80 }} /></td>
              <td><Input type="number" value={r.ordem} onChange={(e) => upR(i, { ordem: Number(e.target.value) })} style={{ width: 60 }} /></td>
              <td><Input value={lista(r.condicao.intencoes)} onChange={(e) => upR(i, { condicao: { ...r.condicao, intencoes: deLista(e.target.value) } })} placeholder="consultar_pagamento, cobranca" /></td>
              <td><Input value={lista(r.condicao.palavras)} onChange={(e) => upR(i, { condicao: { ...r.condicao, palavras: deLista(e.target.value) } })} placeholder="nota fiscal, boleto" /></td>
              <td><Input value={lista(r.condicao.tiposRelacao)} onChange={(e) => upR(i, { condicao: { ...r.condicao, tiposRelacao: deLista(e.target.value) as TipoRelacao[] } })} placeholder="fornecedor" /></td>
              <td><Select value={r.destino.setorCodigo} onChange={(v) => upR(i, { destino: { ...r.destino, setorCodigo: v, equipeId: undefined } })} options={ativos.map((s) => ({ value: s.codigo, label: s.nome }))} /></td>
              <td><Select value={r.destino.equipeId ?? ''} onChange={(v) => upR(i, { destino: { ...r.destino, equipeId: v || undefined } })} options={equipes.filter((e) => e.ativo && e.setorCodigo === r.destino.setorCodigo).map((e) => ({ value: e.id, label: e.nome }))} allowEmpty="—" /></td>
              <td><Select value={r.destino.responsavelId ?? ''} onChange={(v) => upR(i, { destino: { ...r.destino, responsavelId: v || undefined } })} options={usuarios.map((u) => ({ value: u.id, label: u.nome }))} allowEmpty="—" /></td>
              <td><Select value={r.destino.prioridade ?? ''} onChange={(v) => upR(i, { destino: { ...r.destino, prioridade: (v || undefined) as Prioridade | undefined } })} options={[...PRIORIDADES]} allowEmpty="—" /></td>
              <td><Input value={r.motivo} onChange={(e) => upR(i, { motivo: e.target.value })} /></td>
              <td><input type="checkbox" checked={r.ativa} onChange={(e) => upR(i, { ativa: e.target.checked })} /></td>
              <td><button className="btn sm" onClick={() => setRegras(regras.filter((_, k) => k !== i))}>Remover</button></td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <h3 style={{ marginTop: 16 }}>Regras de automação <button className="btn sm" style={{ marginLeft: 8 }} onClick={() => setAutomacao([...automacao, { id: `AUT-${String(automacao.length + 1).padStart(2, '0')}`, ordem: automacao.length + 1, intencoes: [], modo: 'APPROVAL', risco: 'MEDIO', motivo: '', ativa: true }])}>Adicionar</button></h3>
      <p className="small muted">AUTO = a IA responde sozinha · APPROVAL = a IA prepara e um humano aprova · HUMAN = humano obrigatório. Sem regra vale o nível (A/B/C). As guardas só apertam: risco alto, confiança abaixo do mínimo e contato não identificado nunca recebem AUTO.</p>
      <div className="table-wrap"><table>
        <thead><tr><th>Id</th><th>Ordem</th><th>Intenções</th><th>Setores</th><th>Relação</th><th>Modo</th><th>Risco</th><th>Papel exigido</th><th>Motivo</th><th>Ativa</th><th /></tr></thead>
        <tbody>
          {automacao.map((r, i) => (
            <tr key={i}>
              <td><Input value={r.id} onChange={(e) => upA(i, { id: e.target.value })} style={{ width: 80 }} /></td>
              <td><Input type="number" value={r.ordem} onChange={(e) => upA(i, { ordem: Number(e.target.value) })} style={{ width: 60 }} /></td>
              <td><Input value={lista(r.intencoes)} onChange={(e) => upA(i, { intencoes: deLista(e.target.value) })} /></td>
              <td><Input value={lista(r.setores)} onChange={(e) => upA(i, { setores: deLista(e.target.value) })} placeholder="FINANCEIRO" /></td>
              <td><Input value={lista(r.tiposRelacao)} onChange={(e) => upA(i, { tiposRelacao: deLista(e.target.value) as TipoRelacao[] })} /></td>
              <td><Select value={r.modo} onChange={(v) => upA(i, { modo: v as ModoAutomacao })} options={[...MODOS_AUTOMACAO]} /></td>
              <td><Select value={r.risco} onChange={(v) => upA(i, { risco: v as Risco })} options={[...RISCOS]} /></td>
              <td><Input value={r.papelExigido ?? ''} onChange={(e) => upA(i, { papelExigido: e.target.value || undefined })} placeholder="Financeiro" /></td>
              <td><Input value={r.motivo} onChange={(e) => upA(i, { motivo: e.target.value })} /></td>
              <td><input type="checkbox" checked={r.ativa} onChange={(e) => upA(i, { ativa: e.target.checked })} /></td>
              <td><button className="btn sm" onClick={() => setAutomacao(automacao.filter((_, k) => k !== i))}>Remover</button></td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <h3 style={{ marginTop: 16 }}>Regras de nível (somente leitura)</h3>
      <div className="table-wrap"><table>
        <thead><tr><th>Regra</th><th>Motivo</th><th>Nível</th><th>Situação</th></tr></thead>
        <tbody>{cfg.regrasNivel.map((r) => <tr key={r.id}><td className="mono">{r.id}</td><td>{r.motivo}</td><td>nível {r.nivel}</td><td><Badge tone={r.ativa ? 'ok' : 'muted'}>{r.ativa ? 'ativa' : 'inativa'}</Badge></td></tr>)}</tbody>
      </table></div>
    </>
  );
}

const NOME_HUMANO: Record<DecisaoObservada['humano'], string> = { CONFIRMOU: 'confirmou', SOBRESCREVEU: 'sobrescreveu', ASSUMIU: 'assumiu', PENDENTE: 'sem decisão humana', AUTOMATICA: 'automática (sem humano)' };
const TOM_HUMANO: Record<DecisaoObservada['humano'], 'ok' | 'bad' | 'info' | 'muted' | 'warn'> = { CONFIRMOU: 'ok', SOBRESCREVEU: 'bad', ASSUMIU: 'info', PENDENTE: 'muted', AUTOMATICA: 'warn' };
/** SHADOW MODE: o que o Octopus decidiu e o que o humano fez — derivado do routing e das atribuições, nada calculado aqui. */
function ShadowMode({ decisoes, metricas, nomeSetor, nomeEquipe, nomeUsuario }: { decisoes: DecisaoObservada[]; metricas: ReturnType<typeof metricasShadow>; nomeSetor: (c?: string) => string; nomeEquipe: (id?: string) => string; nomeUsuario: (id?: string) => string }) {
  const m = metricas;
  const alvo = (a: { setorCodigo?: string; equipeId?: string; responsavelId?: string }) => `${nomeSetor(a.setorCodigo)}${a.equipeId ? ` / ${nomeEquipe(a.equipeId)}` : ''}${a.responsavelId ? ` · ${nomeUsuario(a.responsavelId)}` : ''}`;
  return (
    <>
      <p className="small muted">Estágio de observação: o router decide e registra, o humano confirma ou sobrescreve; nada responde nem envia. A baseline abaixo é medida, não meta — decide depois se a IA entra.</p>
      <div className="table-wrap"><table>
        <thead><tr><th>Decisões</th><th>HIGH</th><th>MEDIUM</th><th>LOW</th><th>Confirmadas</th><th>Override</th><th>Sem setor (NOVA)</th><th>Intenções fora do catálogo</th><th>Falhas de IA</th></tr></thead>
        <tbody><tr><td>{m.decisoes}</td><td>{m.bandas.HIGH} ({m.pctBandas.HIGH}%)</td><td>{m.bandas.MEDIUM} ({m.pctBandas.MEDIUM}%)</td><td>{m.bandas.LOW} ({m.pctBandas.LOW}%)</td><td>{m.humano.CONFIRMOU + m.humano.ASSUMIU} ({m.pctConfirmadas}%)</td><td>{m.humano.SOBRESCREVEU} ({m.pctOverride}%)</td><td>{m.threadsSemSetor}</td><td>{m.intencoesForaDoCatalogo.map((i) => `${i.intencao} (${i.n})`).join(', ') || '—'}</td><td>{m.falhasIa}</td></tr></tbody>
      </table></div>
      {m.porSetor.length > 0 && <div className="small muted" style={{ marginTop: 6 }}>Por setor sugerido: {m.porSetor.map((s) => `${nomeSetor(s.setorCodigo === '—' ? undefined : s.setorCodigo)} ${s.decisoes} (${s.confirmadas} confirmadas, ${s.sobrescritas} sobrescritas)`).join(' · ')}</div>}
      <h3 style={{ marginTop: 16 }}>Últimas decisões do Octopus</h3>
      {decisoes.length === 0 ? <div className="small muted">Nenhuma decisão registrada ainda.</div> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Quando</th><th>Conversa</th><th>Intenção</th><th>Destino sugerido</th><th>Confiança</th><th>Origem</th><th>Automação</th><th>Onde está</th><th>Decisão humana</th></tr></thead>
          <tbody>
            {decisoes.map((d) => (
              <tr key={d.threadId}>
                <td className="small">{dataHora(d.em)}</td>
                <td><Link to={`/atendimento?t=${d.threadId}`}>{d.assunto.slice(0, 60)}</Link></td>
                <td className="mono small">{d.intencao}</td>
                <td>{alvo(d.sugerido)}{d.aplicacao === 'TRIAGEM' ? <span className="small muted"> (sugestão)</span> : null}</td>
                <td>{Math.round(d.confianca * 100)}% · {d.banda}</td>
                <td className="small">{d.origem}{d.reavaliacao ? ` · ${d.reavaliacao}` : ''}</td>
                <td className="small">{d.automacao}</td>
                <td>{alvo(d.atual)} <span className="small muted">{d.atual.status}</span></td>
                <td><Badge tone={TOM_HUMANO[d.humano]}>{NOME_HUMANO[d.humano]}</Badge>{d.override && <div className="small muted">{nomeUsuario(d.override.por)} · {dataHora(d.override.em)}: {alvo(d.override.de)} → {alvo(d.override.para)}{d.override.motivo ? ` — ${d.override.motivo}` : ''}</div>}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </>
  );
}
