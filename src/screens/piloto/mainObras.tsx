// UX-P03 — entrada isolada do piloto de obras (piloto-obras.html, so em `vite dev`).
//
// NAO importa o store, o Supabase, a fila offline nem a telemetria: a unica fonte e a fixture local, e o conjunto de
// obras visiveis vem da fixture (contrato de entrada, nao ACL). Variante, estado, visao e composicao vem da query string
// (?variante=padrao|subconjunto|nenhuma|vazio&estado=carregando|erro&visao=diretoria|operacao&composicao=<id>&tema=light)
// e nada e guardado no navegador. O `vite build` empacota apenas index.html, entao este HTML nunca vai para producao.
import React from 'react';
import { createRoot } from 'react-dom/client';
import '../../styles.css';
import ObrasCompacto from './ObrasCompacto';
import { Logotipo } from '../../ui/icons';
import type { EntradaObras, Visao } from './obrasCompactoModel';
import { FIXTURE_GERADA_EM, ROTULO_TESTE, VARIANTES, datasetTeste, entradaDaVariante, type VarianteFixture } from './obrasCompacto.fixtures';

const AGORA = '2026-09-23T15:00:00.000Z';
const q = new URLSearchParams(window.location.search);
const variante = (VARIANTES.some((v) => v.id === q.get('variante')) ? q.get('variante') : 'padrao') as VarianteFixture;
const estado = q.get('estado');
const visao: Visao = q.get('visao') === 'operacao' ? 'operacao' : 'diretoria';
if (q.get('tema') === 'light') document.documentElement.dataset.theme = 'light';

const fonte = { rotulo: ROTULO_TESTE, modo: 'teste' as const, id: variante, atualizadoEm: FIXTURE_GERADA_EM };
const { usuario, codigosObraVisiveis } = entradaDaVariante(variante);
const entrada: EntradaObras =
  estado === 'carregando' ? { estado: 'carregando', fonte }
  : estado === 'erro' ? { estado: 'erro', fonte, mensagem: 'Falha simulada ao ler a fonte de dados de teste.', causa: 'piloto: ?estado=erro' }
  : { estado: 'pronto', fonte, ds: datasetTeste(variante), usuario, codigosObraVisiveis, agora: AGORA, visao };

const link = (params: Record<string, string | null>) => {
  const p = new URLSearchParams(q);
  for (const [k, v] of Object.entries(params)) { if (v === null) p.delete(k); else p.set(k, v); }
  const s = p.toString();
  return `${window.location.pathname}${s ? `?${s}` : ''}`;
};
const ativo = (cond: boolean) => (cond ? 'btn sm primary' : 'btn sm');

function Casca() {
  return (
    <div className="app recolhida" style={{ gridTemplateColumns: '1fr' }}>
      <header className="topbar" style={{ padding: '10px 28px', gap: 12 }}>
        <div className="brand" style={{ padding: 0 }}><Logotipo height={28} /><div className="brand-txt"><b>Control</b><span>Piloto UX-P03 · demonstração isolada</span></div></div>
        <div className="spacer" />
        <nav className="actions" aria-label="Variantes de dados de teste">
          {VARIANTES.map((v) => <a key={v.id} className={ativo(!estado && variante === v.id)} href={link({ variante: v.id, estado: null })} title={v.descricao}>{v.rotulo}</a>)}
          <span className="muted small">·</span>
          <a className={ativo(estado === 'carregando')} href={link({ estado: 'carregando' })}>Carregando</a>
          <a className={ativo(estado === 'erro')} href={link({ estado: 'erro' })}>Erro</a>
          <span className="muted small">·</span>
          <a className="btn sm" href={link({ tema: q.get('tema') === 'light' ? null : 'light' })}>{q.get('tema') === 'light' ? 'Tema escuro' : 'Tema claro'}</a>
        </nav>
      </header>
      <main className="content" id="conteudo">
        <ObrasCompacto entrada={entrada} composicaoInicial={q.get('composicao')} visaoInicial={visao} />
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Casca />
  </React.StrictMode>,
);
