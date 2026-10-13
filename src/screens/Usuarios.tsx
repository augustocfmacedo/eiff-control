// Cadastros › Usuarios (modo remoto, so Administrador): convidar pessoas, trocar papel e obras, desativar/reativar e reenviar
// o acesso. Tudo passa por /api/usuarios (netlify/functions/usuarios.ts -> src/core/usuariosServidor.ts), que confere no
// servidor se quem pede e Administrador antes de usar a chave administrativa. Duas formas: criar ja com senha inicial (o Administrador entrega; a pessoa troca no primeiro acesso) ou convite por e-mail. A senha nunca e gravada: a pessoa recebe
// um e-mail com link e cria a propria senha (tela DefinirSenha).
import { useCallback, useEffect, useState } from 'react';
import type { Papel } from '../core/types';
import { PAPEIS, PAPEIS_COM_OBRAS, type UsuarioLista } from '../core/usuarios';
import { tokenSessao } from '../data/supabase';
import { Badge, Empty, Field, Modal, Select, useToast } from '../ui/components';
import { Tabela, type Coluna } from '../ui/Tabela';

const O_QUE_FAZ: Record<Papel, string> = {
  Administrador: 'tudo, inclusive usuários, parâmetros e o caixa (só ele vê saldo, bancos e a análise de pagamentos)',
  Diretoria: 'aprova e edita obras e parâmetros; não vê caixa nem bancos',
  Financeiro: 'lança e liquida títulos; não vê caixa nem bancos',
  'Gestor de obra': 'obras escolhidas: serviços, custos, compras, produção; não vê bancos',
  Engenharia: 'obras escolhidas: orçamentos, materiais, produção; não vê bancos',
  Compras: 'pedidos de compra, estoque e lançamentos; não aprova',
  Contabilidade: 'consulta DRE e auditoria; não vê caixa nem bancos',
  Auditoria: 'só leitura da auditoria; não vê caixa nem bancos',
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

// modo 'senha': o Administrador cria o login ja com a senha inicial e entrega a pessoa; 'convite': e-mail do Supabase com link
interface Form { id?: string; nome: string; email: string; papel: Papel; obras: string[]; ativo: boolean; modo: 'senha' | 'convite'; senha: string; trocar: boolean }
const VAZIO: Form = { nome: '', email: '', papel: 'Solicitante', obras: [], ativo: true, modo: 'senha', senha: '', trocar: true };
interface Acesso { nome: string; email: string; senha: string; link: string; trocar: boolean }

/** Senha inicial forte e legivel (sem 0/O/1/l/I): 12 caracteres com letras maiusculas, minusculas e numeros. */
export function gerarSenha(): string {
  const letras = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ'; const numeros = '23456789'; const todos = letras + numeros;
  const r = new Uint32Array(12); crypto.getRandomValues(r);
  const s = Array.from(r, (v) => todos[v % todos.length]);
  s[3] = numeros[r[3] % numeros.length]; s[8] = numeros[r[8] % numeros.length]; s[0] = letras[r[0] % letras.length].toUpperCase();
  return s.join('');
}
const mensagemDeAcesso = (a: Acesso) => `Olá, ${a.nome.split(' ')[0]}! Seu acesso ao EIFF Control:\n${a.link}\nE-mail: ${a.email}\nSenha${a.trocar ? ' inicial' : ''}: ${a.senha}${a.trocar ? '\nNo primeiro acesso, o sistema vai pedir para você criar a sua própria senha.' : ''}`;

export function GestaoUsuarios() {
  const { toast, el } = useToast();
  const [lista, setLista] = useState<UsuarioLista[] | null>(null);
  const [obras, setObras] = useState<string[]>([]);
  const [falha, setFalha] = useState<{ codigo?: string; mensagem: string } | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [erroForm, setErroForm] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [acesso, setAcesso] = useState<Acesso | null>(null);
  const linkEquipe = `${window.location.origin}/#/diretor/nova`;
  const linkDe = (papel: Papel) => (papel === 'Solicitante' ? linkEquipe : `${window.location.origin}/#/`);

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
        if (form.senha) {
          await chamar({ acao: 'definir_senha', id: form.id, senha: form.senha, trocar: form.trocar });
          setAcesso({ nome: form.nome, email: form.email, senha: form.senha, link: linkDe(form.papel), trocar: form.trocar });
        } else toast(`${form.nome}: alterações salvas.`);
      } else if (form.modo === 'senha') {
        await chamar({ acao: 'criar', nome: form.nome, email: form.email, papel: form.papel, obras: obrasDoPapel, senha: form.senha, trocar: form.trocar });
        setAcesso({ nome: form.nome, email: form.email.trim().toLowerCase(), senha: form.senha, link: linkDe(form.papel), trocar: form.trocar });
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
          <button className="btn primary sm" onClick={() => { setForm({ ...VAZIO }); setErroForm(null); }}>Novo usuário</button>
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
              <button className="btn sm" onClick={() => { setForm({ ...VAZIO, id: u.id, nome: u.nome, email: u.email, papel: u.papel, obras: u.obras === '*' ? [] : u.obras, ativo: u.ativo }); setErroForm(null); }}>Editar</button>{' '}
              {u.ativo && !u.voce && <button className="btn sm" onClick={() => void enviarAcesso(u)} title={u.confirmadoEm ? 'Manda um link para criar nova senha' : 'Reenvia o convite'}>{u.confirmadoEm ? 'Nova senha' : 'Reenviar convite'}</button>}
            </td>
          </>
        )} />
      )}

      {form && (
        <Modal title={form.id ? `Editar ${form.nome}` : 'Novo usuário'} onClose={() => setForm(null)}>
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
            {!form.id && (
              <Field label="Como entregar o acesso" full>
                <div className="row" style={{ gap: 14, flexWrap: 'wrap' }}>
                  <label className="small"><input type="radio" name="modo" checked={form.modo === 'senha'} onChange={() => setForm({ ...form, modo: 'senha' })} /> Criar já com senha (eu entrego à pessoa)</label>
                  <label className="small"><input type="radio" name="modo" checked={form.modo === 'convite'} onChange={() => setForm({ ...form, modo: 'convite' })} /> Enviar convite por e-mail (a pessoa cria a senha)</label>
                </div>
              </Field>
            )}
            {(form.id || form.modo === 'senha') && (
              <Field label={form.id ? 'Nova senha (opcional)' : 'Senha inicial'} req={!form.id} full hint="De 8 a 72 caracteres, com letras e números. Ela não fica gravada no sistema: anote ou copie ao final.">
                <div className="row" style={{ gap: 8 }}>
                  <input type="text" autoComplete="new-password" spellCheck={false} value={form.senha} onChange={(e) => setForm({ ...form, senha: e.target.value })} placeholder={form.id ? 'deixe vazio para não mudar' : ''} style={{ flex: 1, fontFamily: 'monospace' }} />
                  <button type="button" className="btn sm" onClick={() => setForm({ ...form, senha: gerarSenha() })}>Gerar senha</button>
                </div>
              </Field>
            )}
            {(form.id ? !!form.senha : form.modo === 'senha') && (
              <Field label="Primeiro acesso" full>
                <label className="small"><input type="checkbox" checked={form.trocar} onChange={(e) => setForm({ ...form, trocar: e.target.checked })} /> Pedir para a pessoa criar a própria senha no primeiro acesso (recomendado)</label>
              </Field>
            )}
          </div>
          {erroForm && <div className="alert bad" role="alert" style={{ marginTop: 10 }}>{erroForm}</div>}
          <div className="foot">
            <button className="btn" onClick={() => setForm(null)}>Cancelar</button>
            <button className="btn primary" disabled={ocupado} onClick={() => void salvar()}>{ocupado ? 'Salvando…' : form.id ? 'Salvar' : form.modo === 'senha' ? 'Criar acesso' : 'Enviar convite'}</button>
          </div>
        </Modal>
      )}
      {acesso && (
        <Modal title="Acesso pronto" onClose={() => setAcesso(null)}>
          <p className="small">Entregue estes dados a <b>{acesso.nome}</b>. A senha não fica gravada no sistema: depois de fechar esta janela, não dá para vê-la de novo.</p>
          <pre className="acesso-pronto">{mensagemDeAcesso(acesso)}</pre>
          <div className="foot">
            <button className="btn" onClick={() => setAcesso(null)}>Fechar</button>
            <button className="btn primary" onClick={async () => { try { await navigator.clipboard.writeText(mensagemDeAcesso(acesso)); toast('Mensagem copiada: cole no WhatsApp ou no e-mail da pessoa.'); } catch { toast('Não consegui copiar: selecione o texto e copie.'); } }}>Copiar mensagem</button>
          </div>
        </Modal>
      )}
      {el}
    </div>
  );
}
