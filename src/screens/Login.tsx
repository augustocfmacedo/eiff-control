import React, { useRef, useState } from 'react';
import { Logotipo } from '../ui/icons';
import { CenaEstrutura, useEntrada } from '../ui/motion';
import { actions, useStore } from '../data/store';
import { erroDoLink } from '../data/supabase';

export default function Login() {
  const { erroInicial } = useStore();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(erroDoLink);
  const [aviso, setAviso] = useState<string | null>(null);
  const [esqueci, setEsqueci] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const cartao = useRef<HTMLFormElement>(null); useEntrada(cartao);
  const entrar = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro(null); setAviso(null);
    setEnviando(true);
    try {
      if (esqueci) {
        await actions.pedirNovaSenha(email);
        setAviso('Se este e-mail estiver cadastrado, você vai receber em instantes um link para criar uma nova senha. Confira também a caixa de spam.');
      } else await actions.entrar(email.trim(), senha);
    } catch (x) {
      setErro((x as Error).message);
    } finally {
      setEnviando(false);
    }
  };
  return (
    <div className="login">
      <CenaEstrutura variante="login" />
      <form className="card login-card" ref={cartao} onSubmit={entrar}>
        <div className="brand" style={{ paddingLeft: 0 }}><Logotipo height={56} /><div className="brand-txt"><b>Control</b><span>Do orçamento ao caixa</span></div></div>
        <p className="muted small">{esqueci ? 'Informe o seu e-mail: mandamos um link para você criar uma nova senha.' : 'Acesso restrito. Entre com o e-mail e a senha do seu convite.'}</p>
        {erroInicial && <div className="alert warn">{erroInicial}</div>}
        {erro && <div className="alert bad" role="alert">{erro}</div>}
        {aviso && <div className="alert ok" role="status">{aviso}</div>}
        <div className="form" style={{ gridTemplateColumns: '1fr' }}>
          <label className="field req"><span>E-mail</span><input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
          {!esqueci && <label className="field req"><span>Senha</span><input type="password" autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} required /></label>}
        </div>
        <div className="foot" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <button type="button" className="btn sm" onClick={() => { setEsqueci(!esqueci); setErro(null); setAviso(null); }}>{esqueci ? 'Voltar para entrar' : 'Esqueci minha senha'}</button>
          <button className="btn primary" type="submit" disabled={enviando}>{enviando ? (esqueci ? 'Enviando…' : 'Entrando…') : esqueci ? 'Enviar link' : 'Entrar'}</button>
        </div>
      </form>
    </div>
  );
}
