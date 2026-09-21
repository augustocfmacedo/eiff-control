// EIFF Central — Identidades do WhatsApp (Wave 03, F3): vinculo numero -> pessoa, com onboarding fora do canal.
//
// Esta tela NUNCA escreve no banco: tudo passa por /api/central/identidade (JWT -> perfil -> ver_central ->
// RPCs server-only da migration 0049). O que ela mostra vem do servidor ja mascarado; o codigo de verificacao
// aparece UMA vez, na resposta de "solicitar", e some ao recarregar — quem pediu o entrega pessoalmente ao
// colaborador, que o enviara do proprio WhatsApp ao numero da Central quando o Alpha estiver ligado.
// Em modo local (sem sessao) nao ha chamada nenhuma: estado explicativo.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { TAMANHO_CODIGO, VALIDADE_CODIGO_MINUTOS, MAX_TENTATIVAS_CODIGO, type IdentidadeTela, type ListaTela, type ResultadoSolicitacao } from '../core/central/onboarding';
import type { SituacaoIdentidade } from '../core/central/tipos';
import { useStore } from '../data/store';
import { tokenSessao } from '../data/supabase';
import { Alert, Badge, Empty, Field, Input, KpiStrip, Modal, PageHead, Select, dataHora, useToast, type Tone } from '../ui/components';
import { Icon } from '../ui/icons';
import { Tabela } from '../ui/Tabela';

const URL_API = '/api/central/identidade';

const ROTULO_SITUACAO: Record<SituacaoIdentidade, string> = { PENDING: 'Pendente', VERIFIED: 'Verificada', REVOKED: 'Revogada' };
const TONE_SITUACAO: Record<SituacaoIdentidade, Tone> = { PENDING: 'warn', VERIFIED: 'ok', REVOKED: 'muted' };
const ROTULO_CONTEXTO: Record<string, string> = { INTERNAL: 'Interno (EIFF Central)', EXTERNAL: 'Externo (EIFF Comercial)' };

/** mensagens humanas para os codigos fechados do servidor (nunca ecoa telefone nem codigo) */
const MENSAGEM_ERRO: Record<string, string> = {
  nao_autenticado: 'Sessão expirada. Entre novamente.',
  sem_perfil: 'Seu usuário não tem perfil ativo no banco.',
  sem_permissao: 'Seu perfil não tem a permissão ver_central.',
  configuracao_incompleta: 'O servidor está sem a chave de serviço da Central. Nada foi alterado; avise o Administrador.',
  pedido_invalido: 'Pedido fora do contrato da Central.',
  telefone_invalido: 'Telefone fora do formato: informe DDD + número (ex.: 62 99999-1234).',
  pessoa_ausente: 'Escolha a pessoa (usuário ou colaborador).',
  pessoa_dupla: 'Escolha só uma pessoa.',
  pessoa_invalida: 'A pessoa escolhida não tem um identificador válido no banco (cadastro ainda não sincronizado?).',
  pessoa_de_outra_organizacao: 'A pessoa escolhida não pertence à sua organização.',
  numero_ja_verificado_para_outra_pessoa: 'Este número já está verificado para outra pessoa neste contexto. Revogue antes de vincular a outra.',
  contexto_nao_suportado: 'Nesta fase só o contexto interno vincula números.',
  falha_ao_revogar_anterior: 'Não foi possível invalidar o código anterior; por segurança nenhum código novo foi gerado. Tente de novo.',
  motivo_obrigatorio: 'Informe o motivo da revogação.',
  identidade_nao_encontrada: 'Identidade não encontrada na sua organização.',
  transicao_invalida: 'Esta identidade já está revogada.',
  rpc_recusou: 'O banco recusou a operação.',
  indisponivel: 'Servidor da Central indisponível no momento. Nada foi alterado.',
  metodo: 'Método não suportado.',
  sem_endpoint: 'A função /api/central/identidade não está publicada neste ambiente.',
  rede: 'Sem conexão com o servidor.',
};
const mensagemDe = (erro: string, http?: number) => MENSAGEM_ERRO[erro] ?? `Falha (${erro}${http ? `, HTTP ${http}` : ''}).`;

type PedidoApi = { acao: 'listar' } | { acao: 'solicitar'; telefone: string; profileId?: string; workerId?: string } | { acao: 'revogar'; identidadeId: string; motivo: string };
type RespostaApi<T> = { ok: true; corpo: T } | { ok: false; erro: string; http?: number };

/** Chama a funcao com o JWT da sessao. Nunca lanca: toda falha vira erro nomeado que `mensagemDe` traduz. */
async function chamarApi<T>(pedido: PedidoApi): Promise<RespostaApi<T>> {
  const token = await tokenSessao();
  if (!token) return { ok: false, erro: 'nao_autenticado' };
  try {
    const r = await fetch(URL_API, {
      method: 'POST', cache: 'no-store',
      headers: { 'content-type': 'application/json', 'x-supabase-anon': (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? '', authorization: `Bearer ${token}` },
      body: JSON.stringify(pedido),
    });
    // sem a funcao publicada o servidor devolve o index.html do SPA
    if (!(r.headers.get('content-type') ?? '').includes('application/json')) return { ok: false, erro: 'sem_endpoint', http: r.status };
    const corpo = (await r.json().catch(() => null)) as (T & { erro?: string }) | null;
    if (!r.ok) return { ok: false, erro: corpo?.erro ?? 'falha', http: r.status };
    if (!corpo) return { ok: false, erro: 'falha', http: r.status };
    return { ok: true, corpo };
  } catch {
    return { ok: false, erro: 'rede' };
  }
}

type CodigoExibido = { codigo: string; expiraEm: string; telefoneMascarado: string; pessoa: string; renovou: boolean };
type Vinculo = { tipo: 'usuario' | 'colaborador'; pessoaId: string; telefone: string };

export default function CentralIdentidades() {
  const { ds, usuario, modo } = useStore();
  const { toast, el: toastEl } = useToast();
  const [lista, setLista] = useState<ListaTela | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erroLista, setErroLista] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erroForm, setErroForm] = useState<string | null>(null);
  const [vinculo, setVinculo] = useState<Vinculo | null>(null);
  const [renovando, setRenovando] = useState<IdentidadeTela | null>(null);
  const [revogando, setRevogando] = useState<{ id: IdentidadeTela; motivo: string } | null>(null);
  const [codigo, setCodigo] = useState<CodigoExibido | null>(null);
  const [filtro, setFiltro] = useState<'todas' | SituacaoIdentidade>('todas');
  const [agoraIso, setAgoraIso] = useState(() => new Date().toISOString());

  const remoto = modo !== 'local';
  const nomeUsuario = useCallback((id?: string) => (id ? ds.usuarios.find((u) => u.id === id)?.nome : undefined), [ds.usuarios]);
  const nomeColaborador = useCallback((id?: string) => (id ? ds.colaboradores.find((c) => c.id === id)?.nome : undefined), [ds.colaboradores]);
  const pessoaDe = useCallback((l: Pick<IdentidadeTela, 'profileId' | 'workerId'>) => (l.profileId ? nomeUsuario(l.profileId) ?? `usuário ${l.profileId.slice(0, 8)}` : l.workerId ? nomeColaborador(l.workerId) ?? `colaborador ${l.workerId.slice(0, 8)}` : '—'), [nomeUsuario, nomeColaborador]);

  const recarregar = useCallback(async () => {
    if (!remoto) return;
    setCarregando(true);
    const r = await chamarApi<ListaTela>({ acao: 'listar' });
    setCarregando(false);
    if (r.ok) { setLista(r.corpo); setErroLista(null); } else setErroLista(mensagemDe(r.erro, r.http));
    setAgoraIso(new Date().toISOString());
  }, [remoto]);
  useEffect(() => { void recarregar(); }, [recarregar]);
  useEffect(() => { const id = setInterval(() => setAgoraIso(new Date().toISOString()), 30_000); return () => clearInterval(id); }, []);

  const linhas = useMemo(() => (lista?.linhas ?? []).filter((l) => filtro === 'todas' || l.situacao === filtro), [lista, filtro]);
  const usuariosAtivos = useMemo(() => ds.usuarios.filter((u) => u.ativo).sort((a, b) => a.nome.localeCompare(b.nome)), [ds.usuarios]);
  const colaboradoresAtivos = useMemo(() => ds.colaboradores.filter((c) => c.ativo).sort((a, b) => a.nome.localeCompare(b.nome)), [ds.colaboradores]);

  const abrirVinculo = (base?: Partial<Vinculo>) => { setErroForm(null); setVinculo({ tipo: base?.tipo ?? 'colaborador', pessoaId: base?.pessoaId ?? '', telefone: base?.telefone ?? '' }); };
  const escolherPessoa = (tipo: Vinculo['tipo'], pessoaId: string) => setVinculo((v) => {
    if (!v) return v;
    // colaborador com telefone no cadastro: sugere, mas quem confirma e a pessoa
    const tel = tipo === 'colaborador' ? ds.colaboradores.find((c) => c.id === pessoaId)?.telefone ?? '' : '';
    return { ...v, tipo, pessoaId, telefone: v.telefone || tel };
  });

  const solicitar = async (v: Vinculo, renovou: boolean) => {
    if (!v.pessoaId) { setErroForm(MENSAGEM_ERRO.pessoa_ausente); return; }
    if (!v.telefone.trim()) { setErroForm(MENSAGEM_ERRO.telefone_invalido); return; }
    setEnviando(true); setErroForm(null);
    const r = await chamarApi<ResultadoSolicitacao>({ acao: 'solicitar', telefone: v.telefone.trim(), ...(v.tipo === 'usuario' ? { profileId: v.pessoaId } : { workerId: v.pessoaId }) });
    setEnviando(false);
    if (!r.ok) { setErroForm(mensagemDe(r.erro, r.http)); return; }
    if (!r.corpo.ok) { setErroForm(mensagemDe(r.corpo.erro)); return; }
    const pessoa = pessoaDe(v.tipo === 'usuario' ? { profileId: v.pessoaId } : { workerId: v.pessoaId });
    setCodigo({ codigo: r.corpo.codigo, expiraEm: r.corpo.expiraEm, telefoneMascarado: r.corpo.telefoneMascarado, pessoa, renovou: renovou || r.corpo.revogadosAntes > 0 });
    setVinculo(null); setRenovando(null);
    toast(renovou ? 'Novo código gerado; o anterior deixou de valer.' : 'Vínculo solicitado. Entregue o código pessoalmente.');
    void recarregar();
  };
  const revogar = async () => {
    if (!revogando) return;
    if (!revogando.motivo.trim()) { setErroForm(MENSAGEM_ERRO.motivo_obrigatorio); return; }
    setEnviando(true); setErroForm(null);
    const r = await chamarApi<{ ok: boolean; erro?: string }>({ acao: 'revogar', identidadeId: revogando.id.id, motivo: revogando.motivo.trim() });
    setEnviando(false);
    if (!r.ok) { setErroForm(mensagemDe(r.erro, r.http)); return; }
    setRevogando(null);
    if (codigo && revogando.id.situacao === 'PENDING') setCodigo(null);
    toast('Identidade revogada.');
    void recarregar();
  };

  const expiraTexto = (l: IdentidadeTela) => {
    if (l.situacao !== 'PENDING' || !l.expiraEm) return '—';
    return l.expiraEm < agoraIso ? `expirado ${dataHora(l.expiraEm)}` : dataHora(l.expiraEm);
  };
  const contagem = lista?.contagem ?? { PENDING: 0, VERIFIED: 0, REVOKED: 0 };
  const total = contagem.PENDING + contagem.VERIFIED + contagem.REVOKED;

  return (
    <>
      <PageHead title="Identidades do WhatsApp" subtitle={<>EIFF Central · vínculo entre o número do WhatsApp e a pessoa do EIFF Control. Nesta fase <b>nada é enviado</b> pelo WhatsApp: o código de verificação é entregue pessoalmente.</>}>
        {remoto && <button className="btn" onClick={() => void recarregar()} disabled={carregando}>{carregando ? 'Atualizando…' : 'Atualizar'}</button>}
        {remoto && <button className="btn primary" onClick={() => abrirVinculo()}><Icon name="mais" size={14} /> Vincular número</button>}
      </PageHead>

      {!remoto ? (
        <div className="card">
          <Empty icone="central" titulo="Identidades só existem com o servidor">
            Em modo local não há sessão nem banco: nenhuma chamada é feita daqui. Com o Supabase configurado, esta tela lista os vínculos da organização
            (telefone sempre mascarado), gera o código de verificação de {TAMANHO_CODIGO} dígitos com validade de {VALIDADE_CODIGO_MINUTOS} minutos e revoga números —
            tudo pela função <code>/api/central/identidade</code>, com o papel e a organização lidos do seu perfil no banco.
          </Empty>
        </div>
      ) : (
        <>
          {codigo && (
            <div className="card" role="status" aria-live="polite">
              <h2>Código de verificação de {codigo.pessoa}</h2>
              <div className="actions" style={{ alignItems: 'baseline', gap: 18 }}>
                <span className="mono" style={{ fontSize: 34, fontWeight: 700, letterSpacing: '0.18em', fontVariantNumeric: 'tabular-nums', color: 'var(--brand)' }}>{codigo.codigo}</span>
                <span className="small muted">para {codigo.telefoneMascarado} · válido até <b>{dataHora(codigo.expiraEm)}</b> ({VALIDADE_CODIGO_MINUTOS} min, {MAX_TENTATIVAS_CODIGO} tentativas)</span>
              </div>
              <Alert tone="warn">
                <b>Entregue este código pessoalmente ao colaborador. Ele não será mostrado de novo.</b> O colaborador envia o código do próprio WhatsApp ao número da Central.
                {codigo.renovou && <> O código anterior deste número <b>deixou de valer</b>.</>}
              </Alert>
              <div className="actions"><button className="btn sm" onClick={() => setCodigo(null)}>Ocultar código</button></div>
            </div>
          )}

          <KpiStrip itens={[
            { label: 'Pendentes', value: contagem.PENDING, hint: 'aguardando o código', tone: contagem.PENDING ? 'warn' : undefined },
            { label: 'Verificadas', value: contagem.VERIFIED, hint: 'podem agir na Central', tone: contagem.VERIFIED ? 'pos' : undefined },
            { label: 'Revogadas', value: contagem.REVOKED, hint: 'histórico preservado' },
            { label: 'Total', value: total, hint: lista ? `lido ${dataHora(agoraIso)}` : '—' },
          ]} />

          {erroLista && <Alert tone="bad">{erroLista}</Alert>}

          <div className="card">
            <div className="actions" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
              <h2 style={{ margin: 0 }}>Vínculos da organização</h2>
              <div className="actions">
                {(['todas', 'PENDING', 'VERIFIED', 'REVOKED'] as const).map((f) => (
                  <button key={f} className={`btn sm ${filtro === f ? 'primary' : ''}`} onClick={() => setFiltro(f)}>{f === 'todas' ? 'Todas' : ROTULO_SITUACAO[f]}</button>
                ))}
              </div>
            </div>
            {lista && !lista.linhas.length ? (
              <Empty icone="central" titulo="Nenhum número vinculado ainda" acao={<button className="btn primary" onClick={() => abrirVinculo()}>Vincular número</button>}>
                Como funciona: você escolhe a pessoa e o número, o servidor gera um código de {TAMANHO_CODIGO} dígitos (mostrado uma única vez), você entrega o código pessoalmente,
                e o colaborador o envia do próprio WhatsApp ao número da Central. Só depois disso o número fica <b>verificado</b> — e só número verificado pode agir na Central.
              </Empty>
            ) : (
              <Tabela<IdentidadeTela>
                colunas={[
                  { titulo: 'Pessoa', ordenar: (l) => pessoaDe(l) },
                  { titulo: 'Telefone', title: 'Sempre mascarado: o número completo fica só no banco' },
                  { titulo: 'Contexto', ordenar: (l) => l.contexto },
                  { titulo: 'Situação', ordenar: (l) => l.situacao },
                  { titulo: 'Expira em', ordenar: (l) => l.expiraEm ?? '' },
                  { titulo: 'Tentativas', num: true, ordenar: (l) => l.tentativas },
                  { titulo: 'Verificada em', ordenar: (l) => l.verificadoEm ?? '' },
                  { titulo: 'Ações' },
                ]}
                linhas={linhas}
                chave={(l) => l.id}
                vazio={carregando ? 'Carregando…' : 'Nada a mostrar neste filtro.'}
                linha={(l) => (
                  <>
                    <td>{pessoaDe(l)}<div className="small muted">{l.profileId ? 'usuário' : 'colaborador'}{l.solicitadoPor ? ` · pedido por ${nomeUsuario(l.solicitadoPor) ?? '—'}` : ''}</div></td>
                    <td className="mono">{l.telefoneMascarado}</td>
                    <td>{ROTULO_CONTEXTO[l.contexto] ?? l.contexto}</td>
                    <td><Badge tone={TONE_SITUACAO[l.situacao]}>{ROTULO_SITUACAO[l.situacao]}</Badge>{l.situacao === 'REVOKED' && l.motivoRevogacao && <div className="small muted" title={l.motivoRevogacao}>{l.motivoRevogacao.slice(0, 60)}{l.motivoRevogacao.length > 60 ? '…' : ''}</div>}</td>
                    <td>{expiraTexto(l)}</td>
                    <td className="num">{l.situacao === 'PENDING' ? `${l.tentativas}/${MAX_TENTATIVAS_CODIGO}` : '—'}</td>
                    <td>{l.verificadoEm ? dataHora(l.verificadoEm) : l.revogadoEm ? <span className="small muted">revogada {dataHora(l.revogadoEm)}</span> : '—'}</td>
                    <td>
                      <div className="actions">
                        {l.situacao === 'PENDING' && <button className="btn sm" onClick={() => { setErroForm(null); setRenovando(l); }}>Gerar novo código</button>}
                        {l.situacao !== 'REVOKED' && <button className="btn sm" onClick={() => { setErroForm(null); setRevogando({ id: l, motivo: '' }); }}>Revogar</button>}
                      </div>
                    </td>
                  </>
                )}
              />
            )}
            <p className="small muted" style={{ marginTop: 10 }}>
              Regras: um número só fica verificado para uma pessoa por contexto; uma nova solicitação invalida o código anterior do mesmo número; o código expira em {VALIDADE_CODIGO_MINUTOS} minutos,
              vale uma única vez e aceita no máximo {MAX_TENTATIVAS_CODIGO} tentativas (limite fixado no banco). Revogação é definitiva: número revogado volta só por novo vínculo.
              Solicitante: <b>{usuario.nome}</b> ({usuario.papel}).
            </p>
          </div>
        </>
      )}

      {vinculo && (
        <Modal title="Vincular número de WhatsApp" onClose={() => !enviando && setVinculo(null)}>
          <div className="form">
            <Field label="Tipo de pessoa" req>
              <Select value={vinculo.tipo} onChange={(v) => escolherPessoa(v as Vinculo['tipo'], '')} options={[{ value: 'colaborador', label: 'Colaborador (equipe)' }, { value: 'usuario', label: 'Usuário do EIFF Control' }]} />
            </Field>
            <Field label={vinculo.tipo === 'usuario' ? 'Usuário' : 'Colaborador'} req>
              <Select value={vinculo.pessoaId} onChange={(v) => escolherPessoa(vinculo.tipo, v)} allowEmpty="Escolha…"
                options={vinculo.tipo === 'usuario' ? usuariosAtivos.map((u) => ({ value: u.id, label: `${u.nome} · ${u.papel}` })) : colaboradoresAtivos.map((c) => ({ value: c.id, label: `${c.nome} · ${c.funcao}` }))} />
            </Field>
            <Field label="Telefone (WhatsApp)" req full hint="DDD + número; o DDI 55 é assumido. Depois de gravado o número aparece sempre mascarado." erro={erroForm && /elefone/.test(erroForm) ? erroForm : undefined}>
              <Input value={vinculo.telefone} onChange={(e) => setVinculo((v) => v && { ...v, telefone: e.target.value })} placeholder="62 99999-1234" inputMode="tel" autoComplete="off" />
            </Field>
          </div>
          <Alert tone="info">Contexto: <b>interno (EIFF Central)</b>. O servidor gera o código e o mostra uma única vez nesta tela; se já houver um pedido pendente para este número, ele é invalidado.</Alert>
          {erroForm && !/elefone/.test(erroForm) && <Alert tone="bad">{erroForm}</Alert>}
          <div className="actions" style={{ justifyContent: 'flex-end' }}>
            <button className="btn" onClick={() => setVinculo(null)} disabled={enviando}>Cancelar</button>
            <button className="btn primary" onClick={() => void solicitar(vinculo, false)} disabled={enviando}>{enviando ? 'Gerando…' : 'Gerar código'}</button>
          </div>
        </Modal>
      )}

      {renovando && (
        <Modal title="Gerar novo código" onClose={() => !enviando && setRenovando(null)}>
          <Alert tone="warn"><b>O código anterior de {pessoaDe(renovando)} ({renovando.telefoneMascarado}) deixa de valer imediatamente.</b> Um código novo será mostrado uma única vez.</Alert>
          <p className="small muted">Por segurança o número completo não é exibido nem guardado no navegador: digite-o de novo para confirmar que é o mesmo aparelho.</p>
          <RenovarForm identidade={renovando} enviando={enviando} erro={erroForm} onCancelar={() => setRenovando(null)}
            onConfirmar={(telefone) => void solicitar({ tipo: renovando.profileId ? 'usuario' : 'colaborador', pessoaId: renovando.profileId ?? renovando.workerId ?? '', telefone }, true)} />
        </Modal>
      )}

      {revogando && (
        <Modal title="Revogar identidade" onClose={() => !enviando && setRevogando(null)}>
          <Alert tone="warn">Revogar <b>{pessoaDe(revogando.id)}</b> ({revogando.id.telefoneMascarado}) é definitivo: o número deixa de agir na Central e só volta por um novo vínculo.</Alert>
          <div className="form">
            <Field label="Motivo" req full erro={erroForm ?? undefined}>
              <Input value={revogando.motivo} onChange={(e) => setRevogando((r) => r && { ...r, motivo: e.target.value })} placeholder="ex.: aparelho perdido, desligamento, troca de chip" maxLength={500} />
            </Field>
          </div>
          <div className="actions" style={{ justifyContent: 'flex-end' }}>
            <button className="btn" onClick={() => setRevogando(null)} disabled={enviando}>Cancelar</button>
            <button className="btn primary" onClick={() => void revogar()} disabled={enviando}>{enviando ? 'Revogando…' : 'Revogar'}</button>
          </div>
        </Modal>
      )}
      {toastEl}
    </>
  );
}

function RenovarForm({ identidade, enviando, erro, onCancelar, onConfirmar }: { identidade: IdentidadeTela; enviando: boolean; erro: string | null; onCancelar: () => void; onConfirmar: (telefone: string) => void }) {
  const [telefone, setTelefone] = useState('');
  return (
    <>
      <div className="form">
        <Field label={`Telefone (${identidade.telefoneMascarado})`} req full erro={erro ?? undefined}>
          <Input value={telefone} onChange={(e) => setTelefone(e.target.value)} placeholder="62 99999-1234" inputMode="tel" autoComplete="off" />
        </Field>
      </div>
      <div className="actions" style={{ justifyContent: 'flex-end' }}>
        <button className="btn" onClick={onCancelar} disabled={enviando}>Cancelar</button>
        <button className="btn primary" onClick={() => onConfirmar(telefone.trim())} disabled={enviando || !telefone.trim()}>{enviando ? 'Gerando…' : 'Invalidar o anterior e gerar novo'}</button>
      </div>
    </>
  );
}
