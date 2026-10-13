// Cadastros › Usuarios (modo remoto, so Administrador): convidar pessoas, trocar papel e obras, desativar/reativar e reenviar
// o acesso. Tudo passa por /api/usuarios (netlify/functions/usuarios.ts -> src/core/usuariosServidor.ts), que confere no
// servidor se quem pede e Administrador antes de usar a chave administrativa. A senha nunca passa por aqui: a pessoa recebe
// um e-mail com link e cria a propria senha (tela DefinirSenha).
import { useCallback, useEffect, useState } from 'react';
import type { Papel } from '../core/types';
import { PAPEIS, PAPEIS_COM_OBRAS, type UsuarioLista } from '../core/usuarios';
import { tokenSessao } from '../data/supabase';
import { Badge, Empty, Field, Modal, Select, useToast } from '../ui/components';
import { Tabela, type Coluna } from '../ui/Tabela';

const O_QUE_FAZ: Record<Papel, string> = {
  Administrador: 'tudo, inclusive usuários e parâmetros',
  Diretoria: 'aprova, vê caixa e bancos, decide os pedidos do Diretor Financeiro',
  Financeiro: 'lança, liquida, concilia, vê caixa e bancos',
  'Gestor de obra': 'obras escolhidas: serviços, custos, compras, produção; não vê bancos',
  Engenharia: 'obras escolhidas: orçamentos, materiais, produção; não vê bancos',
  Compras: 'pedidos de compra, estoque e lançamentos; não aprova',
  Contabilidade: 'consulta caixa, bancos, DRE e auditoria',
  Auditoria: 'só leitura de bancos e auditoria',
  Solicitante: 'SÓ a conversa com o Diretor Financeiro para pedir pagamentos',
};
const dia = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '');

async function chamar<T>(corpo: unknown): Promise<T> {
  const token = await tokenSessao();
  const r = await fetch('/api/usuarios', { method: 'POST', headers: { 'content-type': 'application/json', 'x-supabase-anon': (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? '', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(corpo) });
  const d = (await r.json().catch(() => ({}))) as { erro?: string; mensagem?: string };
  if (!r.ok) throw Object.assign(new Error(d.mensagem ?? `Falha (${r.status}).`), { codigo: d.erro });
  return d as T;
}

interface Form { id?: string; nome: string; email: string; papel: Papel; obras: string[]; ativo: boolean }
const VAZIO: Form = { nome: '', email: '', papel: 'Solicitante', obras: [], ativo: true };

export function GestaoUsuarios() {
  const { toast, el } = useToast();
  const [lista, setLista] = useState<UsuarioLista[] | null>(null);
  const [obras, setObras] = useState<string[]>([]);
  const [falha, setFalha] = useState<{ codigo?: string; mensagem: string } | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [erroForm, setErroForm] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const linkEquipe = `${window.location.origin}/#/diretor/nova`;

  const carregar = useCallback(async () => {
    try { const r = await chamar<{ usuarios: UsuarioLista[]; obras: string[] }>({ acao: 'listar' }); setLista(r.usuarios); setObras(r.obras); setFalha(null); }
    catch (e) { setFalha({ codigo: (e as { codigo?: string }).codigo, mensagem: (e as Error).message }); setLista([]); }
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);

  const salvar = async () => {
    if (!form) return;
    setOcupado(true); setErroForm(null);
    try {
      const obrasDoPapel = PAPEIS_COM_OBRAS.includes(form.papel) ? form.obras : [];
      if (form.id) {
        await chamar({ acao: 'alterar', id: form.id, nome: form.nome, papel: form.papel, ativo: form.ativo, obras: obrasDoPapel });
        toast(`${form.nome}: alterações salvas.`);
      } else {
        const r = await chamar<{ convite: string }>({ acao: 'convidar', nome: form.nome, email: form.email, papel: form.papel, obras: obrasDoPapel });
        toast(r.convite === 'enviado' ? `Convite enviado para ${form.email}. A pessoa cria a própria senha pelo link do e-mail.` : `${form.email} já tinha login: liguei ao papel e mandei um link para criar nova senha.`);
      }
      setForm(null); await carregar();
    } catch (e) { setErroForm((e as Error).message); }
    finally { setOcupado(false); }
  };
  const enviarAcesso = async (u: UsuarioLista) => {
    try { const r = await chamar<{ enviado: string }>({ acao: 'enviar_acesso', id: u.id }); toast(r.enviado === 'convite' ? `Convite reenviado para ${u.email}.` : `Link de nova senha enviado para ${u.email}.`); }
    catch (e) { toast((e as Error).message); }
  };
  const copiarLink = async () => {
    try { await navigator.clipboard.writeText(linkEquipe); toast('Link da equipe copiado.'); } catch { toast(linkEquipe); }
  };

  if (falha?.codigo === 'nao_configurado') return (
    <div className="alert warn">
      <b>Falta um passo no Netlify.</b> {falha.mensagem} Para criar logins, o servidor precisa da chave administrativa do Supabase:
      copie o valor em Supabase › Project Settings › API (campo <i>service_role</i>) e cole em Netlify › Site configuration › Environment variables, com o nome indicado acima.
      Não envie essa chave por e-mail nem por chat. Depois de salvar, publique de novo o site e recarregue esta tela.
    </div>
  );

  const colunas: Coluna<UsuarioLista>[] = [
    { titulo: 'Nome', ordenar: (u) => u.nome }, { titulo: 'E-mail', ordenar: (u) => u.email }, { titulo: 'Papel', ordenar: (u) => u.papel },
    { titulo: 'Obras' }, { titulo: 'Situação', ordenar: (u) => (u.ativo ? 0 : 1) }, { titulo: '', largura: 190, className: 'no-print' },
  ];
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ margin: 0 }}>Usuários</h2>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className="btn sm" onClick={copiarLink} title={linkEquipe}>Copiar link da equipe (Diretor Financeiro)</button>
          <button className="btn primary sm" onClick={() => { setForm({ ...VAZIO }); setErroForm(null); }}>Convidar pessoa</button>
        </div>
      </div>
      <p className="small muted">O convite chega por e-mail e a pessoa cria a própria senha pelo link. Quem é <b>Solicitante</b> entra direto na conversa com o Diretor Financeiro e não vê mais nada do sistema.</p>
      {falha && falha.codigo !== 'nao_configurado' && <div className="alert bad">{falha.mensagem}</div>}
      {lista === null ? <p className="muted small">Carregando usuários…</p> : (
        <Tabela colunas={colunas} linhas={lista} chave={(u) => u.id} vazio={<Empty titulo="Nenhum usuário">Convide a primeira pessoa.</Empty>} linha={(u) => (
          <>
            <td><b>{u.nome}</b>{u.voce && <span className="muted small"> · você</span>}</td>
            <td className="small">{u.email}</td>
            <td><Badge tone={u.papel === 'Solicitante' ? 'warn' : u.papel === 'Administrador' ? 'info' : 'muted'} title={O_QUE_FAZ[u.papel]}>{u.papel}</Badge></td>
            <td className="small">{u.obras === '*' ? (PAPEIS_COM_OBRAS.includes(u.papel) ? 'todas' : '—') : u.obras.join(', ')}</td>
            <td className="small">
              {u.ativo ? <Badge tone="ok">ativo</Badge> : <Badge tone="muted">inativo</Badge>}
              <div className="muted">{u.ultimoAcesso ? `último acesso ${dia(u.ultimoAcesso)}` : u.confirmadoEm ? 'senha criada' : 'convite pendente'}</div>
            </td>
            <td className="no-print">
              <button className="btn sm" onClick={() => { setForm({ id: u.id, nome: u.nome, email: u.email, papel: u.papel, obras: u.obras === '*' ? [] : u.obras, ativo: u.ativo }); setErroForm(null); }}>Editar</button>{' '}
              {u.ativo && !u.voce && <button className="btn sm" onClick={() => void enviarAcesso(u)} title={u.confirmadoEm ? 'Manda um link para criar nova senha' : 'Reenvia o convite'}>{u.confirmadoEm ? 'Nova senha' : 'Reenviar convite'}</button>}
            </td>
          </>
        )} />
      )}

      {form && (
        <Modal title={form.id ? `Editar ${form.nome}` : 'Convidar pessoa'} onClose={() => setForm(null)}>
          <div className="form">
            <Field label="Nome" req><input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} autoFocus /></Field>
            <Field label="E-mail" req hint={form.id ? 'O e-mail do login não muda por aqui.' : 'Para onde vai o convite.'}><input type="email" value={form.email} disabled={!!form.id} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label="Papel" req full hint={O_QUE_FAZ[form.papel]}><Select value={form.papel} onChange={(v) => setForm({ ...form, papel: v as Papel })} options={PAPEIS} /></Field>
            {PAPEIS_COM_OBRAS.includes(form.papel) && (
              <Field label="Obras que acompanha" full hint="Nenhuma marcada = todas as obras.">
                <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>{obras.map((c) => (
                  <label key={c} className="small"><input type="checkbox" checked={form.obras.includes(c)} onChange={(e) => setForm({ ...form, obras: e.target.checked ? [...form.obras, c] : form.obras.filter((x) => x !== c) })} /> {c}</label>
                ))}</div>
              </Field>
            )}
            {form.id && <Field label="Situação" full hint="Inativo não entra no sistema; o histórico fica."><label className="small"><input type="checkbox" checked={form.ativo} onChange={(e) => setForm({ ...form, ativo: e.target.checked })} /> Ativo</label></Field>}
          </div>
          {erroForm && <div className="alert bad" role="alert" style={{ marginTop: 10 }}>{erroForm}</div>}
          <div className="foot">
            <button className="btn" onClick={() => setForm(null)}>Cancelar</button>
            <button className="btn primary" disabled={ocupado} onClick={() => void salvar()}>{ocupado ? 'Salvando…' : form.id ? 'Salvar' : 'Enviar convite'}</button>
          </div>
        </Modal>
      )}
      {el}
    </div>
  );
}
