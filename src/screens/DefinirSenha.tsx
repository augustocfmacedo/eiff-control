// "Crie sua senha": quem chega pelo link do e-mail (convite do Administrador ou "esqueci minha senha") ja esta com a sessao
// do link; aqui grava a senha (supabase.auth.updateUser) e segue para o sistema. A senha nunca passa pelo nosso servidor.
import React, { useRef, useState } from 'react';
import { Logotipo } from '../ui/icons';
import { CenaEstrutura, useEntrada } from '../ui/motion';
import { actions, useStore } from '../data/store';

export default function DefinirSenha() {
  const { usuario } = useStore();
  const [senha, setSenha] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const cartao = useRef<HTMLFormElement>(null); useEntrada(cartao);
  const salvar = async (e: React.FormEvent) => {
    e.preventDefault(); setErro(null); setEnviando(true);
    try { await actions.definirSenha(senha, confirmacao); } catch (x) { setErro((x as Error).message); } finally { setEnviando(false); }
  };
  return (
    <div className="login">
      <CenaEstrutura variante="login" />
      <form className="card login-card" ref={cartao} onSubmit={salvar}>
        <div className="brand" style={{ paddingLeft: 0 }}><Logotipo height={56} /><div className="brand-txt"><b>Control</b><span>Crie sua senha</span></div></div>
        <p className="muted small">{usuario.nome ? <>Olá, <b>{usuario.nome.split(' ')[0]}</b>. </> : null}Escolha a senha que você vai usar para entrar. Ela fica só com você: nem o administrador a vê.</p>
        {erro && <div className="alert bad" role="alert">{erro}</div>}
        <div className="form" style={{ gridTemplateColumns: '1fr' }}>
          <label className="field req"><span>Nova senha</span><input type="password" autoComplete="new-password" minLength={8} value={senha} onChange={(e) => setSenha(e.target.value)} required autoFocus /><small className="muted">Ao menos 8 caracteres, misturando letras e números.</small></label>
          <label className="field req"><span>Repita a senha</span><input type="password" autoComplete="new-password" minLength={8} value={confirmacao} onChange={(e) => setConfirmacao(e.target.value)} required /></label>
        </div>
        <div className="foot"><button className="btn primary" type="submit" disabled={enviando}>{enviando ? 'Salvando…' : 'Salvar senha e entrar'}</button></div>
      </form>
    </div>
  );
}
