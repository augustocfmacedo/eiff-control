// Gestão de Solicitações de Projeto (E11.2A): Comercial → Engenharia → Comercial.
//
// A tela só apresenta e coleta a intenção: regras em src/core/comercial/pedidoProjeto.ts, gravação pelo repositório
// (src/core/comercial/pedidosRepositorio.ts). Sem persistência homologada: só a demonstração local, EM MEMÓRIA, com
// faixa explícita; no modo remoto tudo fica desabilitado com o motivo. A Engenharia recebe a visão técnica
// (`visaoTecnica`): sem oportunidade, sem vínculos, sem nada comercial.
import React, { useMemo, useState } from 'react';
import './central.css';
import { escopoCentral } from '../../core/comercial/acesso';
import {
  ACOES_PEDIDO, CAMPOS_TECNICOS, COM_QUEM, FILAS_TECNICAS, NOME_FILA_TECNICA, filaTecnica, type FilaTecnica, EQUIPES_TECNICAS, ErroPedido, NOME_DOCUMENTO, NOME_ORIGEM_LEAD, NOME_RESULTADO, NOME_SITUACAO_DOCUMENTO, NOME_SITUACAO_PEDIDO,
  NOME_SITUACAO_PRAZO, ORIGENS_LEAD, PRIORIDADES, REGRAS_ACAO, SITUACOES_DOCUMENTO, SITUACOES_FINAIS, TIPOS_DOCUMENTO, TIPOS_SOLICITACAO, divergenciaDeEstagio,
  motivoBloqueio, prazoVigente, resumoPedidos, situacaoPrazo, visaoTecnica, type ChaveTecnica, type DadosAcao, type EntradaPedido, type EventoPedido, type OrigemLead,
  type PedidoProjeto, type PedidoTecnico, type Prioridade, type ResultadoEncerramento, type SituacaoDocumento, type SituacaoPedido, type SituacaoPrazo, type TipoDocumento, type TipoSolicitacao,
} from '../../core/comercial/pedidoProjeto';
import { MARCA_EXEMPLO_PEDIDOS, semearExemploPedidos } from '../../core/comercial/pedidosExemplo';
import { novaIntencao } from '../../core/comercial/pedidosRepositorio';
import { NOME_ESTAGIO } from '../../core/radar/padroes';
import type { Usuario } from '../../core/types';
import { ORGANIZACAO_LOCAL, PERSISTENCIA_PENDENTE, fontesDosPedidos, limparDemonstracaoPedidos, repositorioPedidos, useHojeOperacional, usePedidosVersao } from '../../data/pedidosProjeto';
import { useStore } from '../../data/store';
import { Badge, Empty, Field, KpiStrip, Link, Modal, PageHead, Select, data, dataHora, useToast, type Tone } from '../../ui/components';
import { Icon } from '../../ui/icons';
import { navegar } from '../../ui/router';
import { Tabela, type Coluna } from '../../ui/Tabela';

type Acao = (typeof ACOES_PEDIDO)[number];
type Linha = PedidoTecnico & { oportunidadeTitulo?: string };

const TOM_SITUACAO: Record<SituacaoPedido, Tone> = { SOLICITADO: 'info', TRIAGEM_TECNICA: 'info', DADOS_PENDENTES: 'warn', EM_DESENVOLVIMENTO: 'info', ENTREGUE: 'ok', ENCERRADO: 'muted', CANCELADO: 'muted' };
const TOM_PRAZO: Record<SituacaoPrazo, Tone> = { concluido: 'muted', sem_prazo: 'muted', no_prazo: 'ok', vence_logo: 'warn', atrasado: 'bad' };
// filtros do Comercial (gestão) e filas da Engenharia (FILAS_TECNICAS): a Engenharia nunca vê os filtros comerciais
const FILTROS_COMERCIAL = ['abertas', 'engenharia', 'comercial', 'atrasadas', 'encerradas', 'todas'] as const;
type Filtro = (typeof FILTROS_COMERCIAL)[number] | FilaTecnica;
const NOME_FILTRO: Record<Filtro, string> = { abertas: 'Abertas', engenharia: 'Com a Engenharia', comercial: 'Com o Comercial', atrasadas: 'Atrasadas', encerradas: 'Encerradas ou canceladas', todas: 'Todas', triagem: NOME_FILA_TECNICA.triagem, atribuidas: NOME_FILA_TECNICA.atribuidas, devolvidas: NOME_FILA_TECNICA.devolvidas };
// rótulos curtos para a faixa de indicadores (cabem a 800 px); o nome completo vai na dica
const ROTULO_CURTO_FILA: Record<FilaTecnica, string> = { triagem: 'A triar', atribuidas: 'Minhas', devolvidas: 'Com o Comercial', encerradas: 'Encerradas' };
const rotaPedido = (id: string) => `/comercial/projetos/${encodeURIComponent(id)}`;
const fmtDado = (c: (typeof CAMPOS_TECNICOS)[number], v: string | number) => (c.tipo === 'numero' ? `${Number(v).toLocaleString('pt-BR')}${'unidade' in c ? ` ${c.unidade}` : ''}` : String(v));
const dataCurta = (s?: string) => (s ? (s.length > 10 ? dataHora(s) : data(s)) : '—');

export default function PedidosProjeto({ p2, query }: { p2?: string; query: URLSearchParams }) {
  const { ds, usuario, modo } = useStore();
  usePedidosVersao();
  const escopo = escopoCentral(usuario);
  const integral = escopo.nivel === 'integral';
  const repo = repositorioPedidos(modo);
  const remoto = repo.adaptador !== 'memoria';
  const { fontes, demonstracao } = useMemo(() => fontesDosPedidos(ds), [ds]);
  const org = ORGANIZACAO_LOCAL;
  // data OPERACIONAL (São Paulo); a data-base financeira (ds.params.dataBase) não comanda prazos de solicitação
  const hoje = useHojeOperacional();
  const nomeUsuario = (id?: string) => (id ? ds.usuarios.find((u) => u.id === id)?.nome ?? id : '—');
  const nomeEmpresa = (id: string) => { const e = fontes.radar.empresas.find((x) => x.id === id); return e ? e.nomeFantasia ?? e.razaoSocial : 'empresa não encontrada'; };
  const todos = repo.listar(usuario, org);
  // a Engenharia nunca recebe a solicitação inteira: só a visão técnica
  const linhas: Linha[] = todos.map((p) => ({ ...visaoTecnica(p, nomeEmpresa(p.empresaId)), ...(integral ? { oportunidadeTitulo: fontes.radar.oportunidades.find((o) => o.id === p.oportunidadeId)?.titulo } : {}) }));

  const faixa = (
    <>
      {remoto
        ? <div className="cgc-demo" role="note"><Icon name="aviso" size={16} /><span><b>Persistência não homologada.</b> {PERSISTENCIA_PENDENTE} Nenhuma ação está disponível aqui até a migration ser aprovada.</span></div>
        : <div className="cgc-demo" role="note"><Icon name="aviso" size={16} /><span><b>{MARCA_EXEMPLO_PEDIDOS}.</b> As solicitações vivem só nesta aba: recarregar apaga.{demonstracao ? ' Empresas e oportunidades são as fictícias da demonstração da Central.' : ''}</span></div>}
      {!integral && <div className="cgc-lacuna" role="note"><b>Visão técnica.</b> {escopo.motivo}</div>}
    </>
  );

  if (p2 === 'novo') {
    if (!integral) return <div className="cgc"><PageHead title="Nova solicitação de projeto" />{faixa}<Empty icone="aviso" titulo="Só o Comercial abre solicitações">Seu perfil vê e trata as solicitações encaminhadas à Engenharia.</Empty></div>;
    return <div className="cgc"><PageHead title="Nova solicitação de projeto" subtitle="Encaminhamento formal à Engenharia, vinculado à oportunidade." />{faixa}<Formulario query={query} usuario={usuario} fontes={fontes} remoto={remoto} hoje={hoje} usuarios={ds.usuarios} /></div>;
  }
  if (p2) {
    const p = linhas.find((x) => x.id === p2);
    const completo = integral ? todos.find((x) => x.id === p2) : undefined;
    return <div className="cgc">{faixa}{p ? <Detalhe p={p} completo={completo} usuario={usuario} integral={integral} remoto={remoto} hoje={hoje} nomeUsuario={nomeUsuario} usuarios={ds.usuarios} eventos={repo.eventos(usuario, org, p.id)} estagio={completo ? fontes.radar.oportunidades.find((o) => o.id === completo.oportunidadeId)?.estagio : undefined} orcamentos={fontes.orcamentos as { id: string; codigo?: string; titulo?: string }[]} />
      : <Empty icone="vazio" titulo="Solicitação não encontrada" acao={<Link className="btn sm" to="/comercial/projetos">Voltar à lista</Link>}>Ela não existe nesta demonstração (recarregar a página apaga a memória) ou não é visível para o seu perfil.</Empty>}</div>;
  }
  return (
    <div className="cgc">
      <PageHead title="Solicitações de projeto" subtitle={<>Comercial → Engenharia → Comercial. Hoje {data(hoje)} (data de operação, não a data-base financeira).</>}>
        {integral && <button className="btn sm primary" disabled={remoto} title={remoto ? PERSISTENCIA_PENDENTE : undefined} onClick={() => navegar('/comercial/projetos/novo')}>Nova solicitação</button>}
        {!remoto && integral && todos.length === 0 && demonstracao && <button className="btn sm" onClick={() => {
          const eng = ds.usuarios.find((u) => u.papel === 'Engenharia' && u.ativo);
          if (eng) semearExemploPedidos(repo, { organizacaoId: org, fontes, comercial: usuario, engenharia: eng, hoje });
        }}>Carregar exemplo</button>}
        {!remoto && todos.length > 0 && integral && <button className="btn sm" onClick={() => limparDemonstracaoPedidos()}>Limpar demonstração</button>}
      </PageHead>
      {faixa}
      <Lista linhas={linhas} usuario={usuario} integral={integral} hoje={hoje} nomeUsuario={nomeUsuario} filtroInicial={(query.get('filtro') as Filtro) ?? (integral ? 'abertas' : 'triagem')} />
    </div>
  );
}

/* ---------------------------------------------------------------- lista */

function Lista({ linhas, usuario, integral, hoje, nomeUsuario, filtroInicial }: { linhas: Linha[]; usuario: Usuario; integral: boolean; hoje: string; nomeUsuario: (id?: string) => string; filtroInicial: Filtro }) {
  const filtros: readonly Filtro[] = integral ? FILTROS_COMERCIAL : FILAS_TECNICAS;
  const [filtro, setFiltro] = useState<Filtro>(filtros.includes(filtroInicial) ? filtroInicial : filtros[0]);
  const [busca, setBusca] = useState('');
  const [tipo, setTipo] = useState('');
  const r = resumoPedidos(linhas as unknown as PedidoProjeto[], hoje);
  const atrasadasMinhas = linhas.filter((p) => filaTecnica(p, usuario) === 'atribuidas' && situacaoPrazo(p, hoje) === 'atrasado').length;
  const passa = (p: Linha, f: Filtro) => {
    if (!integral) return filaTecnica(p, usuario) === f;
    const aberta = !SITUACOES_FINAIS.includes(p.situacao);
    switch (f) {
      case 'abertas': return aberta;
      case 'engenharia': return aberta && COM_QUEM[p.situacao] === 'Engenharia';
      case 'comercial': return aberta && COM_QUEM[p.situacao] === 'Comercial';
      case 'atrasadas': return aberta && situacaoPrazo(p, hoje) === 'atrasado';
      case 'encerradas': return !aberta;
      default: return true;
    }
  };
  const vazio = linhas.length ? 'Nenhuma solicitação neste filtro.' : integral ? 'Nenhuma solicitação ainda. Abra a partir de uma oportunidade (botão «Nova solicitação» ou no dossiê da Central).' : 'Nenhuma solicitação na fila de triagem nem atribuída a você.';
  const termo = busca.trim().toLowerCase();
  const vis = linhas.filter((p) => passa(p, filtro) && (!tipo || p.tipo === tipo) && (!termo || `${p.codigo} ${p.empresaNome} ${p.oportunidadeTitulo ?? ''} ${p.tipo}`.toLowerCase().includes(termo)));
  const cols: Coluna<Linha>[] = [
    { titulo: 'Código', ordenar: (p) => p.codigo, largura: 90 }, { titulo: 'Empresa', ordenar: (p) => p.empresaNome }, { titulo: 'Tipo', ordenar: (p) => p.tipo },
    { titulo: 'Situação', ordenar: (p) => p.situacao }, { titulo: 'Com quem' }, { titulo: 'Responsável técnico', ordenar: (p) => nomeUsuario(p.responsavelTecnicoId) },
    { titulo: 'Prazo', ordenar: (p) => prazoVigente(p) ?? '9' }, { titulo: 'Prioridade', ordenar: (p) => PRIORIDADES.indexOf(p.prioridade) }, { titulo: 'Pendências', num: true, ordenar: (p) => p.pendencias.filter((x) => x.aberta).length },
  ];
  return (
    <>
      {integral ? <KpiStrip itens={[
        { label: 'Abertas', value: String(r.abertas) }, { label: 'Com a Engenharia', value: String(r.comEngenharia) }, { label: 'Com o Comercial', value: String(r.comComercial), hint: 'dados pendentes ou entrega a confirmar', tone: r.comComercial ? 'warn' : undefined },
        { label: 'Atrasadas', value: String(r.atrasadas), tone: r.atrasadas ? 'neg' : undefined }, { label: 'Vencem em 2 dias', value: String(r.venceLogo), tone: r.venceLogo ? 'warn' : undefined }, { label: 'Pendências abertas', value: String(r.pendenciasAbertas) },
      ]} /> : <KpiStrip itens={[
        ...FILAS_TECNICAS.map((f) => ({ label: ROTULO_CURTO_FILA[f], hint: NOME_FILA_TECNICA[f], value: String(linhas.filter((p) => filaTecnica(p, usuario) === f).length) })),
        { label: 'Minhas atrasadas', value: String(atrasadasMinhas), tone: atrasadasMinhas ? 'neg' : undefined },
      ]} />}
      <div className="card">
        <div className="chips" role="group" aria-label="Filtrar solicitações">
          {filtros.map((f) => <button key={f} className={`chip ${filtro === f ? 'on' : ''}`} aria-pressed={filtro === f} onClick={() => setFiltro(f)}>{NOME_FILTRO[f]}<span className="n">{linhas.filter((p) => passa(p, f)).length}</span></button>)}
        </div>
        <div className="cgc-busca-dossie" style={{ marginBottom: 10 }}>
          <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por código, empresa ou tipo" aria-label="Buscar solicitação" />
          <Select value={tipo} onChange={setTipo} options={[...TIPOS_SOLICITACAO]} allowEmpty="Todos os tipos" aria-label="Filtrar por tipo" />
        </div>
        {/* tela estreita: cartões com o essencial e acesso ao detalhe; a tabela fica para telas largas */}
        <ul className="pp-cartoes" aria-label="Solicitações">
          {vis.length === 0 ? <li className="small muted">{vazio}</li> : vis.map((p) => { const pz = situacaoPrazo(p, hoje); const pend = p.pendencias.filter((x) => x.aberta).length; return (
            <li key={p.id}><Link to={rotaPedido(p.id)} className="pp-cartao">
              <span className="pp-cartao-topo"><b>{p.codigo}</b>{p.versaoTipo > 1 && <span className="small muted"> v{p.versaoTipo}</span>}<Badge tone={TOM_SITUACAO[p.situacao]}>{NOME_SITUACAO_PEDIDO[p.situacao]}</Badge></span>
              <span className="pp-cartao-empresa">{p.empresaNome}</span>
              <span className="small muted">{p.tipo} · {p.prioridade}{pend ? ` · ${pend} pendência(s)` : ''}</span>
              <span className="small">com {COM_QUEM[p.situacao] === 'Comercial' ? 'o Comercial' : COM_QUEM[p.situacao] === 'Engenharia' ? 'a Engenharia' : '—'} · prazo {dataCurta(prazoVigente(p))} {pz !== 'concluido' && pz !== 'sem_prazo' && <Badge tone={TOM_PRAZO[pz]}>{NOME_SITUACAO_PRAZO[pz]}</Badge>}</span>
            </Link></li>); })}
        </ul>
        <div className="pp-tabela">
        <Tabela colunas={cols} linhas={vis} chave={(p) => p.id} onLinha={(p) => navegar(rotaPedido(p.id))} vazio={vazio}
          linha={(p) => { const pz = situacaoPrazo(p, hoje); return (<>
            <td><b>{p.codigo}</b>{p.versaoTipo > 1 && <span className="small muted"> v{p.versaoTipo}</span>}</td>
            <td>{p.empresaNome}{p.oportunidadeTitulo && <div className="small muted">{p.oportunidadeTitulo}</div>}</td>
            <td className="small">{p.tipo}</td>
            <td><Badge tone={TOM_SITUACAO[p.situacao]}>{NOME_SITUACAO_PEDIDO[p.situacao]}</Badge></td>
            <td className="small">{COM_QUEM[p.situacao]}</td>
            <td className="small">{p.responsavelTecnicoId ? nomeUsuario(p.responsavelTecnicoId) : <span className="muted">{p.equipeTecnica ?? 'não atribuído'}</span>}</td>
            <td className="small">{dataCurta(prazoVigente(p))} {pz !== 'concluido' && pz !== 'sem_prazo' && <Badge tone={TOM_PRAZO[pz]}>{NOME_SITUACAO_PRAZO[pz]}</Badge>}</td>
            <td className="small">{p.prioridade}</td>
            <td className="small" style={{ textAlign: 'right' }}>{p.pendencias.filter((x) => x.aberta).length || '—'}</td>
          </>); }} />
        </div>
      </div>
    </>
  );
}

/* ---------------------------------------------------------------- formulário */

function Formulario({ query, usuario, fontes, remoto, hoje, usuarios }: { query: URLSearchParams; usuario: Usuario; fontes: ReturnType<typeof fontesDosPedidos>['fontes']; remoto: boolean; hoje: string; usuarios: Usuario[] }) {
  const repo = repositorioPedidos(remoto ? 'remoto' : 'local');
  const { toast, el } = useToast();
  // a intenção nasce UMA vez por formulário aberto: clicar duas vezes em Encaminhar não cria duas solicitações
  const [intencao] = useState(novaIntencao);
  const ativas = fontes.radar.oportunidades.filter((o) => !['WON', 'LOST', 'NURTURE'].includes(o.estagio));
  const [empresaId, setEmpresaId] = useState(query.get('empresa') ?? '');
  const [oportunidadeId, setOportunidadeId] = useState(query.get('oportunidade') ?? '');
  const [origem, setOrigem] = useState<OrigemLead>((query.get('origem') as OrigemLead) ?? 'RADAR');
  const [tipo, setTipo] = useState<TipoSolicitacao>('Estudo preliminar');
  const [prioridade, setPrioridade] = useState<Prioridade>('Normal');
  const [prazo, setPrazo] = useState('');
  const [responsavel, setResponsavel] = useState(usuario.id);
  const [equipe, setEquipe] = useState('');
  const [thread, setThread] = useState(query.get('conversa') ?? '');
  const [registro, setRegistro] = useState(query.get('evidencia') ?? '');
  const [submissao, setSubmissao] = useState(query.get('submissao') ?? '');
  const [dados, setDados] = useState<Partial<Record<ChaveTecnica, string>>>({});
  const [docs, setDocs] = useState<Partial<Record<TipoDocumento, SituacaoDocumento>>>({});
  const [erro, setErro] = useState<string | undefined>();

  const empresas = fontes.radar.empresas.filter((e) => ativas.some((o) => o.empresaId === e.id)).sort((a, b) => (a.nomeFantasia ?? a.razaoSocial).localeCompare(b.nomeFantasia ?? b.razaoSocial));
  const ops = ativas.filter((o) => o.empresaId === empresaId);
  // vínculos SÓ por id oficial ligado à empresa: conversa cujo contato já aponta para a empresa; evidência promovida para ela
  const contatosDaEmpresa = new Set((fontes.inbox?.contatos ?? []).filter((c) => c.empresaRadarId === empresaId).map((c) => c.id));
  const threads = (fontes.inbox?.threads ?? []).filter((t) => contatosDaEmpresa.has(t.contatoId));
  const submissoes = (fontes.inbox?.mensagens ?? []).filter((m) => threads.some((t) => t.id === m.threadId) && m.externalMessageId && typeof m.meta?.['formulario'] === 'string');
  const evidencias = fontes.radar.registrosFonte.filter((r) => r.statusIntake === 'RESOLVED' && r.entidadeId === empresaId);
  const responsaveis = usuarios.filter((u) => u.ativo && (u.papel === 'Administrador' || u.papel === 'Diretoria'));

  const [faltaVinculo, setFaltaVinculo] = useState(false);
  const enviar = (e: React.FormEvent) => {
    e.preventDefault();
    // orientação antes da regra: sem empresa e oportunidade escolhidas, diz o que fazer (e marca os campos)
    if (!empresaId || !oportunidadeId) { setFaltaVinculo(true); setErro('Escolha a empresa e a oportunidade do Radar a que a solicitação pertence.'); return; }
    setFaltaVinculo(false);
    const entrada: EntradaPedido = {
      empresaId, oportunidadeId, origemLead: origem, tipo, prioridade, ...(prazo ? { prazoSolicitado: prazo } : {}), responsavelComercialId: responsavel, ...(equipe ? { equipeTecnica: equipe } : {}),
      vinculos: { ...(thread ? { inboxThreadId: thread } : {}), ...(registro ? { registroFonteId: registro } : {}), ...(submissao ? { submissaoId: submissao } : {}) },
      dados: Object.fromEntries(Object.entries(dados).map(([k, v]) => [k, CAMPOS_TECNICOS.find((c) => c.chave === k)?.tipo === 'numero' && v !== '' ? Number(String(v).replace(',', '.')) : v])) as EntradaPedido['dados'],
      documentos: docs,
    };
    try {
      const r = repo.criar(entrada, usuario, { organizacaoId: ORGANIZACAO_LOCAL, intencao, fontes });
      toast(r.repetida ? `${r.pedido.codigo} já tinha sido encaminhada (clique repetido).` : `${r.pedido.codigo} encaminhada à Engenharia.`);
      navegar(rotaPedido(r.pedido.id));
    } catch (x) { setErro(x instanceof ErroPedido ? x.message : String(x)); }
  };

  const campo = (c: (typeof CAMPOS_TECNICOS)[number]) => {
    const v = dados[c.chave] ?? '';
    const set = (x: string) => setDados((d) => ({ ...d, [c.chave]: x }));
    const req = 'obrigatorio' in c && c.obrigatorio;
    return (
      <Field key={c.chave} label={`${c.rotulo}${'unidade' in c ? ` (${c.unidade})` : ''}`} req={req} full={c.tipo === 'texto_longo'} hint="declarado pelo cliente">
        {c.tipo === 'opcao' ? <Select value={v} onChange={set} options={[...c.opcoes]} allowEmpty="não informado" />
          : c.tipo === 'texto_longo' ? <textarea rows={3} value={v} onChange={(e) => set(e.target.value)} />
            : <input value={v} inputMode={c.tipo === 'numero' ? 'decimal' : undefined} maxLength={c.chave === 'uf' ? 2 : 200} onChange={(e) => set(c.chave === 'uf' ? e.target.value.toUpperCase() : e.target.value)} />}
      </Field>
    );
  };

  return (
    <form onSubmit={enviar} className="pp-form">
      {el}
      <div className="card">
        <h2>Identificação</h2>
        <div className="form">
          <Field label="Empresa (Radar)" req erro={faltaVinculo && !empresaId ? 'Escolha a empresa' : undefined}><Select value={empresaId} onChange={(v) => { setEmpresaId(v); setOportunidadeId(''); setThread(''); setRegistro(''); setSubmissao(''); }} options={empresas.map((e) => ({ value: e.id, label: e.nomeFantasia ?? e.razaoSocial }))} allowEmpty="escolha a empresa" /></Field>
          <Field label="Oportunidade" req erro={faltaVinculo && !oportunidadeId ? 'Escolha a oportunidade' : undefined} hint="só oportunidades ativas desta empresa"><Select value={oportunidadeId} onChange={setOportunidadeId} options={ops.map((o) => ({ value: o.id, label: `${o.titulo} · ${NOME_ESTAGIO[o.estagio]}` }))} allowEmpty={empresaId ? 'escolha a oportunidade' : 'escolha a empresa antes'} /></Field>
          <Field label="Origem do lead" req><Select value={origem} onChange={(v) => setOrigem(v as OrigemLead)} options={ORIGENS_LEAD.map((o) => ({ value: o, label: NOME_ORIGEM_LEAD[o] }))} /></Field>
          <Field label="Tipo de solicitação" req><Select value={tipo} onChange={(v) => setTipo(v as TipoSolicitacao)} options={[...TIPOS_SOLICITACAO]} /></Field>
          <Field label="Responsável comercial" req><Select value={responsavel} onChange={setResponsavel} options={responsaveis.map((u) => ({ value: u.id, label: `${u.nome} · ${u.papel}` }))} /></Field>
          <Field label="Prioridade" req><Select value={prioridade} onChange={(v) => setPrioridade(v as Prioridade)} options={[...PRIORIDADES]} /></Field>
          <Field label="Prazo solicitado"><input type="date" value={prazo} min={hoje} onChange={(e) => setPrazo(e.target.value)} /></Field>
        </div>
        <h3 style={{ marginTop: 'var(--space-4)' }}>Vínculos oficiais <span className="small muted">(só por id; nunca por nome)</span></h3>
        <div className="form">
          <Field label="Conversa do EIFF Inbox" hint={threads.length ? 'conversas cujo contato já aponta para esta empresa' : 'nenhuma conversa ligada a esta empresa'}><Select value={thread} onChange={setThread} options={threads.map((t) => ({ value: t.id, label: `${t.assunto} · ${t.id.slice(0, 8)}` }))} allowEmpty="sem vínculo" disabled={!threads.length} /></Field>
          <Field label="Submissão do simulador" hint={submissoes.length ? 'envios do formulário nessas conversas' : 'nenhuma submissão ligada'}><Select value={submissao} onChange={setSubmissao} options={submissoes.map((m) => ({ value: m.externalMessageId!, label: `${String(m.meta?.['formulario'])} · ${dataHora(m.em)}` }))} allowEmpty="sem vínculo" disabled={!submissoes.length} /></Field>
          <Field label="Evidência do Lead Engine" hint={evidencias.length ? 'candidatos promovidos por pessoa para esta empresa' : 'nenhuma evidência promovida'}><Select value={registro} onChange={setRegistro} options={evidencias.map((r) => ({ value: r.id, label: `${r.externoId ?? r.id}` }))} allowEmpty="sem vínculo" disabled={!evidencias.length} /></Field>
        </div>
      </div>
      <div className="card" style={{ marginTop: 'var(--space-4)' }}>
        <h2>Dados técnicos <Badge tone="warn">declarados pelo cliente</Badge></h2>
        <p className="small muted">Tudo o que entra aqui nasce como declaração do cliente. Só a Engenharia marca um dado como validado, na triagem.</p>
        <div className="form">{CAMPOS_TECNICOS.map(campo)}</div>
      </div>
      <div className="grid cols-2" style={{ marginTop: 'var(--space-4)' }}>
        <div className="card">
          <h2>Documentos necessários</h2>
          <div className="form">{TIPOS_DOCUMENTO.map((t) => <Field key={t} label={NOME_DOCUMENTO[t]}><Select value={docs[t] ?? 'nao_necessario'} onChange={(v) => setDocs((d) => ({ ...d, [t]: v as SituacaoDocumento }))} options={(['nao_necessario', 'pendente', 'recebido'] as SituacaoDocumento[]).map((s) => ({ value: s, label: NOME_SITUACAO_DOCUMENTO[s] }))} /></Field>)}</div>
        </div>
        <div className="card">
          <h2>Responsabilidade</h2>
          <div className="form">
            <Field label="Equipe técnica sugerida"><Select value={equipe} onChange={setEquipe} options={[...EQUIPES_TECNICAS]} allowEmpty="a Engenharia define" /></Field>
            <Field label="Situação ao encaminhar"><input value="Solicitado (com a Engenharia)" readOnly /></Field>
          </div>
          <p className="small muted">Responsável técnico, prazo de entrega, pendências e histórico são definidos pela Engenharia depois do encaminhamento.</p>
        </div>
      </div>
      {erro && <div className="alert bad" role="alert" style={{ marginTop: 'var(--space-4)' }}>{erro}</div>}
      <div className="actions" style={{ marginTop: 'var(--space-4)' }}>
        <button type="submit" className="btn primary" disabled={remoto} title={remoto ? PERSISTENCIA_PENDENTE : undefined}>Encaminhar à Engenharia</button>
        <Link className="btn" to="/comercial/projetos">Cancelar</Link>
      </div>
    </form>
  );
}

/* ---------------------------------------------------------------- detalhe */

function Detalhe({ p, completo, usuario, integral, remoto, hoje, nomeUsuario, usuarios, eventos, estagio, orcamentos }: {
  p: Linha; completo?: PedidoProjeto; usuario: Usuario; integral: boolean; remoto: boolean; hoje: string; nomeUsuario: (id?: string) => string; usuarios: Usuario[];
  eventos: EventoPedido[]; estagio?: Parameters<typeof divergenciaDeEstagio>[1]; orcamentos: { id: string; codigo?: string; titulo?: string }[];
}) {
  const [acao, setAcao] = useState<Acao | undefined>();
  const { toast, el } = useToast();
  const pz = situacaoPrazo(p, hoje);
  const divergencia = integral ? divergenciaDeEstagio(p, estagio) : undefined;
  const bloqueios = ACOES_PEDIDO.map((a) => ({ a, motivo: remoto ? PERSISTENCIA_PENDENTE : motivoBloqueio(usuario, p, a) }));
  const disponiveis = bloqueios.filter((b) => !b.motivo);
  const final = SITUACOES_FINAIS.includes(p.situacao);
  return (
    <>
      {el}
      <div className="cgc-dossie-cab">
        <div>
          <div className="small muted"><Link to="/comercial/projetos">Solicitações de projeto</Link> › {p.codigo}</div>
          <h1 style={{ margin: '4px 0' }}>{p.codigo} · {p.empresaNome}</h1>
          <div className="small muted">{p.tipo}{p.versaoTipo > 1 ? ` · versão ${p.versaoTipo}` : ''} · prioridade {p.prioridade} · aberta em {dataHora(p.criadoEm)} por {nomeUsuario(p.criadoPor)}</div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <Badge tone={TOM_SITUACAO[p.situacao]}>{NOME_SITUACAO_PEDIDO[p.situacao]}</Badge>
          {!final && <Badge tone="info">com {COM_QUEM[p.situacao] === 'Comercial' ? 'o Comercial' : 'a Engenharia'}</Badge>}
          <Badge tone={TOM_PRAZO[pz]}>{NOME_SITUACAO_PRAZO[pz]}{prazoVigente(p) ? ` · ${data(prazoVigente(p)!)}` : ''}</Badge>
        </div>
      </div>

      <div className="card" style={{ marginTop: 'var(--space-4)' }}>
        <h2>Próximas ações</h2>
        {final ? <p className="small muted">{NOME_SITUACAO_PEDIDO[p.situacao]}: a solicitação não admite alteração. Para retomar, abra uma nova (versão seguinte).</p>
          : disponiveis.length === 0 ? <p className="small muted">Nenhuma ação sua agora: a solicitação está com {COM_QUEM[p.situacao] === 'Comercial' ? 'o Comercial' : 'a Engenharia'}.</p>
            : <div className="actions" style={{ flexWrap: 'wrap', gap: 8 }}>{disponiveis.map(({ a }) => <button key={a} className={`btn sm ${['entregar', 'encerrar', 'assumir_desenvolvimento', 'responder_pendencias', 'iniciar_triagem'].includes(a) ? 'primary' : ''}`} onClick={() => setAcao(a)} title={REGRAS_ACAO[a].descricao}>{REGRAS_ACAO[a].rotulo}</button>)}</div>}
        {!final && <details className="small" style={{ marginTop: 8 }}><summary>Por que outras ações estão indisponíveis</summary>
          <ul className="cgc-lista">{bloqueios.filter((b) => b.motivo).map((b) => <li key={b.a}><span>{REGRAS_ACAO[b.a].rotulo}</span><span className="small muted">{b.motivo}</span></li>)}</ul></details>}
        {divergencia && <div className="cgc-lacuna"><b>Oportunidade no Radar:</b> {NOME_ESTAGIO[estagio!]}; pela situação da solicitação o estágio sugerido é <b>{NOME_ESTAGIO[divergencia]}</b>. Nada muda sozinho: atualize no <Link to={`/radar/empresas/${completo?.empresaId}`}>Radar</Link> se fizer sentido.</div>}
      </div>

      <div className="grid cols-2" style={{ marginTop: 'var(--space-4)' }}>
        <div className="card">
          <h2>Identificação</h2>
          <dl className="kv">
            <dt>Empresa</dt><dd>{p.empresaNome}</dd>
            {integral && completo && <><dt>Oportunidade</dt><dd>{p.oportunidadeTitulo ?? completo.oportunidadeId}{estagio ? ` · ${NOME_ESTAGIO[estagio]}` : ''} · <Link to={`/comercial/gestao?dossie=${encodeURIComponent(`empresa:${completo.empresaId}`)}`}>dossiê</Link></dd></>}
            <dt>Origem do lead</dt><dd>{NOME_ORIGEM_LEAD[p.origemLead]}</dd>
            <dt>Tipo</dt><dd>{p.tipo}{p.versaoTipo > 1 ? ` (versão ${p.versaoTipo})` : ''}</dd>
            <dt>Responsável comercial</dt><dd>{nomeUsuario(p.responsavelComercialId)}</dd>
            <dt>Prioridade</dt><dd>{p.prioridade}</dd>
            <dt>Prazo solicitado</dt><dd>{dataCurta(p.prazoSolicitado)}</dd>
            {integral && completo && <><dt>Vínculos oficiais</dt><dd className="small">{[completo.vinculos.inboxThreadId && `conversa ${completo.vinculos.inboxThreadId}`, completo.vinculos.submissaoId && `submissão ${completo.vinculos.submissaoId}`, completo.vinculos.registroFonteId && `evidência ${completo.vinculos.registroFonteId}`, completo.vinculos.orcamentoId && `orçamento ${orcamentos.find((o) => o.id === completo.vinculos.orcamentoId)?.codigo ?? completo.vinculos.orcamentoId}`].filter(Boolean).join(' · ') || 'nenhum além da oportunidade'}</dd></>}
          </dl>
        </div>
        <div className="card">
          <h2>Responsabilidade</h2>
          <dl className="kv">
            <dt>Equipe técnica</dt><dd>{p.equipeTecnica ?? '—'}</dd>
            <dt>Responsável técnico</dt><dd>{p.responsavelTecnicoId ? nomeUsuario(p.responsavelTecnicoId) : 'não atribuído'}</dd>
            <dt>Prazo de entrega</dt><dd>{dataCurta(p.prazoEntrega)}</dd>
            <dt>Com quem está</dt><dd>{COM_QUEM[p.situacao]}</dd>
            {p.motivo && <><dt>Último motivo</dt><dd>{p.motivo}</dd></>}
            {p.resultado && <><dt>Resultado</dt><dd>{NOME_RESULTADO[p.resultado.tipo]}</dd></>}
          </dl>
        </div>
      </div>

      <div className="card" style={{ marginTop: 'var(--space-4)' }}>
        <h2>Dados técnicos</h2>
        <p className="small muted"><Badge tone="warn">declarado</Badge> = como o cliente informou, não verificado · <Badge tone="ok">validado</Badge> = conferido pela Engenharia.</p>
        <dl className="kv">{CAMPOS_TECNICOS.filter((c) => p.dados[c.chave]).map((c) => { const d = p.dados[c.chave]!; return <React.Fragment key={c.chave}><dt>{c.rotulo}</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{fmtDado(c, d.dado)} {d.situacao === 'validado' ? <Badge tone="ok" title={`por ${nomeUsuario(d.validadoPor)} em ${dataCurta(d.validadoEm)}`}>validado</Badge> : <Badge tone="warn">declarado</Badge>}</dd></React.Fragment>; })}</dl>
      </div>

      <div className="grid cols-2" style={{ marginTop: 'var(--space-4)' }}>
        <div className="card">
          <h2>Documentos</h2>
          <ul className="cgc-lista">{TIPOS_DOCUMENTO.map((t) => { const d = p.documentos[t]; return <li key={t}><span>{NOME_DOCUMENTO[t]}{d.referencia && <span className="sub">{d.referencia}</span>}</span><Badge tone={d.situacao === 'validado' ? 'ok' : d.situacao === 'pendente' ? 'warn' : d.situacao === 'recebido' ? 'info' : 'muted'}>{NOME_SITUACAO_DOCUMENTO[d.situacao]}</Badge></li>; })}</ul>
          <p className="small muted">Os arquivos ainda não são guardados aqui: o armazenamento de documentos de projeto vem com a persistência.</p>
        </div>
        <div className="card">
          <h2>Pendências</h2>
          {p.pendencias.length === 0 ? <p className="small muted">Nenhuma pendência registrada.</p>
            : <ul className="cgc-lista">{p.pendencias.map((x) => <li key={x.id}><span>{x.descricao}<span className="sub">pedida por {nomeUsuario(x.criadaPor)} em {dataCurta(x.criadaEm)}{x.resposta ? ` · resposta: ${x.resposta}` : ''}</span></span><Badge tone={x.aberta ? 'warn' : 'ok'}>{x.aberta ? 'aberta' : 'respondida'}</Badge></li>)}</ul>}
        </div>
      </div>

      {p.entrega && <div className="card" style={{ marginTop: 'var(--space-4)' }}>
        <h2>Entrega técnica</h2>
        <dl className="kv"><dt>Entregue em</dt><dd>{dataHora(p.entrega.em)} por {nomeUsuario(p.entrega.por)}</dd><dt>Resumo</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{p.entrega.resumo}</dd><dt>Resultados</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{p.entrega.resultados}</dd>{p.entrega.referencias.length > 0 && <><dt>Referências</dt><dd>{p.entrega.referencias.join(' · ')}</dd></>}</dl>
        {integral && p.situacao === 'ENTREGUE' && <p className="small muted">Para continuar: confirme o recebimento e siga para o orçamento em <Link to="/orcamentos">Orçamentos e composições</Link> ou registre que o cliente não seguiu.</p>}
      </div>}

      <div className="card" style={{ marginTop: 'var(--space-4)' }}>
        <h2>Histórico de encaminhamentos</h2>
        <ul className="cgc-linha-tempo">{[...eventos].reverse().map((e) => <li key={e.id} className={e.de !== e.para ? 'estagio' : ''}>
          <div><b>{e.acao === 'criar' ? 'Solicitação aberta' : REGRAS_ACAO[e.acao as Acao].rotulo}</b>{e.de && e.de !== e.para ? ` · ${NOME_SITUACAO_PEDIDO[e.de]} → ${NOME_SITUACAO_PEDIDO[e.para]}` : ''}</div>
          <div className="quando">{dataHora(e.em)} · {nomeUsuario(e.por)} ({e.papel})</div>
          {(e.motivo || e.detalhe) && <div className="det">{[e.motivo && `Motivo: ${e.motivo}`, e.detalhe].filter(Boolean).join('\n')}</div>}
        </li>)}</ul>
      </div>

      {acao && <AcaoModal acao={acao} p={p} usuario={usuario} usuarios={usuarios} orcamentos={orcamentos} hoje={hoje} onClose={() => setAcao(undefined)} onOk={(m) => { setAcao(undefined); toast(m); }} />}
    </>
  );
}

/* ---------------------------------------------------------------- ações */

function AcaoModal({ acao, p, usuario, usuarios, orcamentos, hoje, onClose, onOk }: { acao: Acao; p: Linha; usuario: Usuario; usuarios: Usuario[]; orcamentos: { id: string; codigo?: string; titulo?: string }[]; hoje: string; onClose: () => void; onOk: (m: string) => void }) {
  const repo = repositorioPedidos('local');
  const [intencao] = useState(novaIntencao); // um clique repetido não aplica a ação duas vezes
  const [motivo, setMotivo] = useState('');
  const [nota, setNota] = useState('');
  const [itens, setItens] = useState('');
  const [resposta, setResposta] = useState('');
  const [prazo, setPrazo] = useState(p.prazoEntrega ?? '');
  const [responsavel, setResponsavel] = useState(p.responsavelTecnicoId ?? (usuario.papel === 'Engenharia' ? usuario.id : ''));
  const [equipe, setEquipe] = useState(p.equipeTecnica ?? '');
  const [validar, setValidar] = useState<ChaveTecnica[]>([]);
  const [resumo, setResumo] = useState('');
  const [resultados, setResultados] = useState('');
  const [referencias, setReferencias] = useState('');
  const [resultado, setResultado] = useState<ResultadoEncerramento>('SEGUE_PARA_ORCAMENTO');
  const [orcamento, setOrcamento] = useState('');
  const ladoEng = usuario.papel === 'Engenharia' || usuario.papel === 'Administrador' || usuario.papel === 'Diretoria';
  const ladoCom = usuario.papel !== 'Engenharia';
  // só as situações que este perfil pode escolher; a inicial é a atual se ela estiver entre elas
  const opcoesDoc = SITUACOES_DOCUMENTO.filter((s) => ((s === 'validado' || s === 'nao_necessario') ? ladoEng : ladoCom));
  const inicialDoc = (t: TipoDocumento): SituacaoDocumento => (opcoesDoc.includes(p.documentos[t].situacao) ? p.documentos[t].situacao : opcoesDoc[0]);
  const [doc, setDoc] = useState<TipoDocumento>('arquitetura');
  const [docSit, setDocSit] = useState<SituacaoDocumento>(() => inicialDoc('arquitetura'));
  const [docRef, setDocRef] = useState('');
  const [editar, setEditar] = useState<Partial<Record<ChaveTecnica, string>>>(() => Object.fromEntries(Object.entries(p.dados).map(([k, v]) => [k, String(v!.dado)])));
  const [erro, setErro] = useState<string | undefined>();
  const regra = REGRAS_ACAO[acao];
  const engenheiros = usuarios.filter((u) => u.ativo && u.papel === 'Engenharia');

  const confirmar = () => {
    const d: DadosAcao = { versao: p.versao };
    if (motivo.trim()) d.motivo = motivo;
    if (nota.trim()) d.nota = nota;
    if (acao === 'pedir_dados') d.pendencias = itens.split('\n');
    if (acao === 'responder_pendencias') d.resposta = resposta;
    if (acao === 'assumir_desenvolvimento') d.prazoEntrega = prazo || undefined;
    if (acao === 'iniciar_triagem' || acao === 'atribuir') { if (responsavel) d.responsavelTecnicoId = responsavel; if (equipe) d.equipeTecnica = equipe; }
    if (acao === 'registrar_triagem') d.validar = validar;
    if (acao === 'entregar') d.entrega = { resumo, resultados, referencias: referencias.split('\n').map((x) => x.trim()).filter(Boolean) };
    if (acao === 'encerrar') d.resultado = { tipo: resultado, ...(resultado === 'ORCAMENTO_VINCULADO' && orcamento ? { orcamentoId: orcamento } : {}) };
    if (acao === 'atualizar_documento') d.documento = { tipo: doc, situacao: docSit, ...(docRef.trim() ? { referencia: docRef.trim() } : {}) };
    if (acao === 'editar_dados') d.dados = Object.fromEntries(CAMPOS_TECNICOS.map((c) => [c.chave, c.tipo === 'numero' && editar[c.chave] ? Number(String(editar[c.chave]).replace(',', '.')) : editar[c.chave] ?? ''])) as DadosAcao['dados'];
    try {
      const r = repo.agir(p.id, acao, usuario, d, { organizacaoId: ORGANIZACAO_LOCAL, intencao, orcamentos });
      onOk(r.repetida ? 'Ação já registrada (clique repetido).' : `${regra.rotulo}: feito.`);
    } catch (x) { setErro(x instanceof ErroPedido ? x.message : String(x)); }
  };

  return (
    <Modal title={`${regra.rotulo} · ${p.codigo}`} onClose={onClose}>
      <p className="small muted">{regra.descricao}.</p>
      <div className="form">
        {(acao === 'iniciar_triagem' || acao === 'atribuir') && <>
          <Field label="Equipe técnica"><Select value={equipe} onChange={setEquipe} options={[...EQUIPES_TECNICAS]} allowEmpty="sem equipe" /></Field>
          <Field label="Responsável técnico"><Select value={responsavel} onChange={setResponsavel} options={engenheiros.map((u) => ({ value: u.id, label: u.nome }))} allowEmpty={acao === 'iniciar_triagem' ? 'eu mesmo' : 'escolha'} /></Field>
        </>}
        {acao === 'registrar_triagem' && <Field label="Dados que você conferiu (passam a validados)" full>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 6 }}>{CAMPOS_TECNICOS.filter((c) => p.dados[c.chave] && p.dados[c.chave]!.situacao === 'declarado').map((c) => <label key={c.chave} className="small" style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" style={{ width: 'auto' }} checked={validar.includes(c.chave)} onChange={(e) => setValidar((v) => (e.target.checked ? [...v, c.chave] : v.filter((x) => x !== c.chave)))} />{c.rotulo}</label>)}</div>
        </Field>}
        {acao === 'pedir_dados' && <Field label="O que falta (um por linha)" req full><textarea rows={4} value={itens} onChange={(e) => setItens(e.target.value)} /></Field>}
        {acao === 'responder_pendencias' && <>
          <div className="full small">{p.pendencias.filter((x) => x.aberta).map((x) => <div key={x.id}>• {x.descricao}</div>)}</div>
          <Field label="O que foi providenciado" req full><textarea rows={3} value={resposta} onChange={(e) => setResposta(e.target.value)} /></Field>
        </>}
        {acao === 'assumir_desenvolvimento' && <Field label="Prazo de entrega" req><input type="date" value={prazo} min={hoje} onChange={(e) => setPrazo(e.target.value)} /></Field>}
        {acao === 'entregar' && <>
          <Field label="Resumo da entrega" req full><textarea rows={3} value={resumo} onChange={(e) => setResumo(e.target.value)} /></Field>
          <Field label="Resultados técnicos" req full hint="o que o Comercial precisa para continuar (premissas, quantitativos, ressalvas)"><textarea rows={4} value={resultados} onChange={(e) => setResultados(e.target.value)} /></Field>
          <Field label="Referências (uma por linha)" full hint="nome ou local dos arquivos entregues"><textarea rows={2} value={referencias} onChange={(e) => setReferencias(e.target.value)} /></Field>
        </>}
        {acao === 'encerrar' && <>
          <Field label="Como o atendimento segue" req><Select value={resultado} onChange={(v) => setResultado(v as ResultadoEncerramento)} options={(Object.keys(NOME_RESULTADO) as ResultadoEncerramento[]).map((k) => ({ value: k, label: NOME_RESULTADO[k] }))} /></Field>
          {resultado === 'ORCAMENTO_VINCULADO' && <Field label="Orçamento técnico" req><Select value={orcamento} onChange={setOrcamento} options={orcamentos.map((o) => ({ value: o.id, label: `${o.codigo ?? o.id} · ${o.titulo ?? ''}` }))} allowEmpty="escolha o orçamento" /></Field>}
        </>}
        {acao === 'atualizar_documento' && <>
          <Field label="Documento"><Select value={doc} onChange={(v) => { setDoc(v as TipoDocumento); setDocSit(inicialDoc(v as TipoDocumento)); }} options={TIPOS_DOCUMENTO.map((t) => ({ value: t, label: NOME_DOCUMENTO[t] }))} /></Field>
          <Field label="Situação"><Select value={docSit} onChange={(v) => setDocSit(v as SituacaoDocumento)} options={opcoesDoc.map((s) => ({ value: s, label: NOME_SITUACAO_DOCUMENTO[s] }))} /></Field>
          <Field label="Referência" full hint="ex.: nome do arquivo recebido"><input value={docRef} onChange={(e) => setDocRef(e.target.value)} /></Field>
        </>}
        {acao === 'editar_dados' && CAMPOS_TECNICOS.map((c) => <Field key={c.chave} label={c.rotulo} full={c.tipo === 'texto_longo'} req={'obrigatorio' in c && c.obrigatorio} hint={p.dados[c.chave]?.situacao === 'validado' ? 'validado: se mudar, volta a declarado' : undefined}>
          {c.tipo === 'opcao' ? <Select value={editar[c.chave] ?? ''} onChange={(v) => setEditar((d) => ({ ...d, [c.chave]: v }))} options={[...c.opcoes]} allowEmpty="não informado" />
            : c.tipo === 'texto_longo' ? <textarea rows={3} value={editar[c.chave] ?? ''} onChange={(e) => setEditar((d) => ({ ...d, [c.chave]: e.target.value }))} />
              : <input value={editar[c.chave] ?? ''} inputMode={c.tipo === 'numero' ? 'decimal' : undefined} onChange={(e) => setEditar((d) => ({ ...d, [c.chave]: e.target.value }))} />}
        </Field>)}
        {['registrar_triagem', 'registrar_andamento'].includes(acao) && <Field label={acao === 'registrar_triagem' ? 'Avaliação da triagem' : 'Andamento'} req={acao === 'registrar_andamento'} full><textarea rows={3} value={nota} onChange={(e) => setNota(e.target.value)} /></Field>}
        {(regra.exigeMotivo || (acao === 'encerrar' && resultado === 'NAO_SEGUIU')) && <Field label="Motivo" req full><textarea rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} /></Field>}
      </div>
      {erro && <div className="alert bad" role="alert" style={{ marginTop: 10 }}>{erro}</div>}
      <div className="actions" style={{ marginTop: 12 }}>
        <button className="btn primary" onClick={confirmar}>{regra.rotulo}</button>
        <button className="btn" onClick={onClose}>Voltar</button>
      </div>
    </Modal>
  );
}
