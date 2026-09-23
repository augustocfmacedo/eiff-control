// EIFF Inbox — configuracao minima (permissao inbox_config): setores, equipes, membros, fallback/escalacao e SLA.
// Tela administrativa simples: nenhum motor visual de regras. As regras de nivel e roteamento continuam em dados
// (ConfiguracaoInbox) e so mudam por migration/codigo nesta fase.
import React, { useState } from 'react';
import { PRIORIDADES, type Equipe, type MembroSetor, type Prioridade, type Setor } from '../core/inbox';
import { RegraDeNegocioError, actions, pode, useStore } from '../data/store';
import { Badge, EstadoErro, Field, Input, Link, PageHead, Select, Tabs, useToast } from '../ui/components';

const erroDe = (e: unknown) => (e instanceof RegraDeNegocioError || e instanceof Error ? e.message : String(e));

export default function InboxConfig() {
  const { ds, usuario } = useStore();
  const { toast, el } = useToast();
  const [aba, setAba] = useState<'setores' | 'equipes' | 'membros' | 'roteamento'>('setores');
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
        <Tabs value={aba} onChange={setAba} items={[{ id: 'setores', label: `Setores (${inbox.setores.length})` }, { id: 'equipes', label: `Equipes (${inbox.equipes.length})` }, { id: 'membros', label: `Membros (${inbox.membros.length})` }, { id: 'roteamento', label: 'Roteamento e SLA' }]} />
        {aba === 'setores' && <Setores setores={setoresOrdenados} usuarios={usuarios} nomeUsuario={nomeUsuario} onSalvar={(s) => tentar(() => actions.inboxSalvarSetor(s), 'Setor salvo')} />}
        {aba === 'equipes' && <Equipes equipes={inbox.equipes} setores={setoresOrdenados} usuarios={usuarios} nomeUsuario={nomeUsuario} onSalvar={(e) => tentar(() => actions.inboxSalvarEquipe(e), 'Equipe salva')} />}
        {aba === 'membros' && <Membros membros={inbox.membros} equipes={inbox.equipes} setores={setoresOrdenados} usuarios={usuarios} nomeUsuario={nomeUsuario} onSalvar={(m) => tentar(() => actions.inboxSalvarMembro(m), 'Membro salvo')} onRemover={(id) => { if (window.confirm('Remover este membro do setor?')) tentar(() => actions.inboxRemoverMembro(id), 'Membro removido'); }} />}
        {aba === 'roteamento' && <Roteamento cfg={inbox.configuracao} setores={setoresOrdenados} onSalvar={(c) => tentar(() => actions.inboxSalvarConfiguracao(c), 'Configuração salva')} />}
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

function Roteamento({ cfg, setores, onSalvar }: { cfg: { setorFallback: string; setorEscalacao: string; slaHorasPorPrioridade: Record<Prioridade, number>; nivelPadrao: 'A' | 'B' | 'C'; regrasRoteamento: { id: string; motivo: string; destino: { setorCodigo: string }; ativa: boolean }[]; regrasNivel: { id: string; motivo: string; nivel: string; ativa: boolean }[] }; setores: Setor[]; onSalvar: (c: { setorFallback: string; setorEscalacao: string; slaHorasPorPrioridade: Record<Prioridade, number>; nivelPadrao: 'A' | 'B' | 'C' }) => void }) {
  const [c, setC] = useState({ setorFallback: cfg.setorFallback, setorEscalacao: cfg.setorEscalacao, slaHorasPorPrioridade: { ...cfg.slaHorasPorPrioridade }, nivelPadrao: cfg.nivelPadrao });
  const ativos = setores.filter((s) => s.ativo);
  return (
    <>
      <div className="form">
        <Field label="Setor de fallback" hint="recebe o que nenhuma regra roteou"><Select value={c.setorFallback} onChange={(v) => setC({ ...c, setorFallback: v })} options={ativos.map((s) => ({ value: s.codigo, label: s.nome }))} /></Field>
        <Field label="Setor de escalação" hint="para onde escala quando o SLA vence"><Select value={c.setorEscalacao} onChange={(v) => setC({ ...c, setorEscalacao: v })} options={ativos.map((s) => ({ value: s.codigo, label: s.nome }))} /></Field>
        <Field label="Nível padrão" hint="A = IA responde · B = IA prepara · C = humano"><Select value={c.nivelPadrao} onChange={(v) => setC({ ...c, nivelPadrao: v as 'A' | 'B' | 'C' })} options={['A', 'B', 'C']} /></Field>
        {PRIORIDADES.map((p) => <Field key={p} label={`SLA ${p} (horas)`}><Input type="number" min={0.5} step={0.5} value={c.slaHorasPorPrioridade[p]} onChange={(e) => setC({ ...c, slaHorasPorPrioridade: { ...c.slaHorasPorPrioridade, [p]: Number(e.target.value) } })} /></Field>)}
        <div className="full actions"><button className="btn primary" onClick={() => onSalvar(c)}>Salvar</button></div>
      </div>
      <h3 style={{ marginTop: 16 }}>Regras (somente leitura nesta fase)</h3>
      <p className="small muted">As regras de roteamento e de nível são dados da configuração e ainda não têm editor visual. A primeira regra que casa vence; sem regra, vale o fallback.</p>
      <div className="table-wrap"><table>
        <thead><tr><th>Regra</th><th>Motivo</th><th>Destino / nível</th><th>Situação</th></tr></thead>
        <tbody>
          {cfg.regrasRoteamento.map((r) => <tr key={r.id}><td className="mono">{r.id}</td><td>{r.motivo}</td><td>{setores.find((s) => s.codigo === r.destino.setorCodigo)?.nome ?? r.destino.setorCodigo}</td><td><Badge tone={r.ativa ? 'ok' : 'muted'}>{r.ativa ? 'ativa' : 'inativa'}</Badge></td></tr>)}
          {cfg.regrasNivel.map((r) => <tr key={r.id}><td className="mono">{r.id}</td><td>{r.motivo}</td><td>nível {r.nivel}</td><td><Badge tone={r.ativa ? 'ok' : 'muted'}>{r.ativa ? 'ativa' : 'inativa'}</Badge></td></tr>)}
        </tbody>
      </table></div>
    </>
  );
}
