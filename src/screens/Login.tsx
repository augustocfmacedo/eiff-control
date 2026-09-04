import React, { useState } from 'react';
import { Marca } from '../ui/icons';
import { actions, useStore } from '../data/store';

export default function Login() {
  const { erroInicial } = useStore();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const entrar = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      await actions.entrar(email.trim(), senha);
    } catch (x) {
      setErro((x as Error).message);
    } finally {
      setEnviando(false);
    }
  };
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--bg)' }}>
      <form className="card" style={{ width: 'min(400px, 92vw)' }} onSubmit={entrar}>
        <div className="brand" style={{ paddingLeft: 0 }}><div className="logo"><Marca size={22} /></div><div><b>EIFF Control</b><span>Do orçamento ao caixa</span></div></div>
        <p className="muted small">Acesso restrito. Use o e-mail e a senha cadastrados pelo administrador no Supabase.</p>
        {erroInicial && <div className="alert warn">{erroInicial}</div>}
        {erro && <div className="alert bad">{erro}</div>}
        <div className="form" style={{ gridTemplateColumns: '1fr' }}>
          <label className="field req"><span>E-mail</span><input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
          <label className="field req"><span>Senha</span><input type="password" autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} required /></label>
        </div>
        <div className="foot"><button className="btn primary" type="submit" disabled={enviando}>{enviando ? 'Entrando…' : 'Entrar'}</button></div>
      </form>
    </div>
  );
}
