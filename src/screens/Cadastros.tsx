import React, { useState } from 'react';
import type { Alocacao, CategoriaFuncao, Cenario, ContaFinanceira, FuncaoColaborador, LocalTrabalho, Params, PlanoConta, TipoLancamento } from '../core/types';
import { conflitosAlocacao, localDoColaborador } from '../core/equipe';
import { actions, pode, useStore } from '../data/store';
import { Badge, Field, Input, Modal, Money, NumberInput, PageHead, Select, Tabs, data, money, tentar, useToast } from '../ui/components';

const GRUPOS_FLUXO = ['Receitas Operacionais', 'Outras Entradas', 'Financiamento e Capital', 'Custos Diretos de Obras', 'Despesas com Pessoal', 'Despesas Administrativas', 'Despesas Comerciais', 'Despesas Operacionais', 'Tributos', 'Serviço da Dívida', 'Investimentos', 'Outras Saídas'];
const GRUPOS_DRE = ['Receita Operacional', 'Deduções da Receita', 'Outras Receitas Operacionais', 'Outras Receitas', 'Custos Diretos', 'Despesas com Pessoal', 'Despesas Administrativas', 'Despesas Comerciais', 'Despesas Operacionais', 'Outras Despesas', 'Tributos', 'Resultado Financeiro', 'Não DRE'];
const CLASSES = ['Operacional', 'Custo direto', 'Despesa indireta', 'Tributo', 'Financeiro', 'Financiamento', 'Investimento', 'Capital', 'Não operacional'];

export default function Cadastros({ aba0 }: { aba0?: string }) {
  const { ds, usuario } = useStore();
  const { toast, el } = useToast();
  const [aba, setAba] = useState<'plano' | 'contas' | 'funcoes' | 'alocacoes' | 'parametros' | 'usuarios' | 'dados'>((aba0 as 'plano') ?? 'plano');
  const [funcao, setFuncao] = useState<FuncaoColaborador | null>(null);
  const [aloc, setAloc] = useState<Alocacao | null>(null);
  const [filtroAloc, setFiltroAloc] = useState<{ obra: string; vigentes: boolean; colaborador: string }>({ obra: '', vigentes: true, colaborador: '' });
  const hoje = ds.params.dataBase;
  const podeAlocar = pode(usuario, 'editar_obra');
  const nomeColab = (id: string) => ds.colaboradores.find((c) => c.id === id)?.nome ?? id;
  const rotuloLocal = (a: { local: LocalTrabalho; codigoObra?: string }) => a.local === 'Obra' ? `${a.codigoObra} · ${ds.obras.find((o) => o.codigo === a.codigoObra)?.nome ?? ''}` : a.local;
  const vigente = (a: Alocacao) => a.de <= hoje && (!a.ate || a.ate >= hoje);
  const alocacoesFiltradas = (ds.alocacoes ?? []).filter((a) => (!filtroAloc.obra || a.codigoObra === filtroAloc.obra) && (!filtroAloc.vigentes || vigente(a) || a.de > hoje) && (!filtroAloc.colaborador || a.colaboradorId === filtroAloc.colaborador)).sort((a, b) => nomeColab(a.colaboradorId).localeCompare(nomeColab(b.colaboradorId)) || a.de.localeCompare(b.de));
  const conflitosDe = aloc ? conflitosAlocacao(ds.alocacoes ?? [], aloc) : [];
  const [pc, setPc] = useState<{ item: PlanoConta; original?: string } | null>(null);
  const [conta, setConta] = useState<ContaFinanceira | null>(null);
  const [params, setParams] = useState<Params>(ds.params);
  const podeCad = pode(usuario, 'editar_cadastros');
  const podeParams = pode(usuario, 'editar_parametros');
  const usoCategoria = (c: string) => ds.lancamentos.filter((l) => l.categoria === c).length;

  return (
    <>
      <PageHead title="Cadastros mestres e parâmetros" subtitle="Plano de contas com mapas de fluxo e DRE, contas financeiras, parâmetros de cenário, reserva e alçadas, usuários e escopos." />
      <Tabs value={aba} onChange={setAba} items={[{ id: 'plano', label: `Plano de contas (${ds.planoContas.length})` }, { id: 'contas', label: 'Contas financeiras' }, { id: 'funcoes', label: `Funções (${(ds.funcoes ?? []).filter((f) => f.ativa).length})` }, { id: 'alocacoes', label: `Alocações (${(ds.alocacoes ?? []).filter(vigente).length} vigentes)` }, { id: 'parametros', label: 'Parâmetros e alçadas' }, { id: 'usuarios', label: 'Usuários e permissões' }, { id: 'dados', label: 'Dados e migração' }]} />

      {aba === 'plano' && (
        <div className="card table-wrap">
          {podeCad && <div className="actions" style={{ marginBottom: 8 }}><button className="btn primary sm" onClick={() => setPc({ item: { categoria: '', tipo: 'Saída', grupoFluxo: 'Despesas Administrativas', grupoDre: 'Despesas Administrativas', classe: 'Despesa indireta', orientacao: '', ativa: true } })}>+ Categoria</button></div>}
          <table><thead><tr><th>Categoria</th><th>Tipo</th><th>Grupo de fluxo</th><th>Grupo DRE</th><th>Classe</th><th>Orientação de uso</th><th>Uso</th></tr></thead><tbody>
            {ds.planoContas.map((p) => <tr key={p.categoria} className={podeCad ? 'clickable' : ''} onClick={() => podeCad && setPc({ item: p, original: p.categoria })}><td><b>{p.categoria}</b> {!p.ativa && <Badge tone="muted">inativa</Badge>}</td><td>{p.tipo}</td><td>{p.grupoFluxo}</td><td>{p.grupoDre}</td><td>{p.classe}</td><td className="muted small">{p.orientacao}</td><td className="num">{usoCategoria(p.categoria)}</td></tr>)}
          </tbody></table>
        </div>
      )}

      {aba === 'contas' && (
        <div className="card table-wrap">
          {podeCad && <div className="actions" style={{ marginBottom: 8 }}><button className="btn primary sm" onClick={() => setConta({ id: `CTA-${String(ds.contas.length + 1).padStart(3, '0')}`, registro: 'Real', instituicao: '', conta: '', tipo: 'Conta corrente', saldoInicial: 0, reservaVinculada: 0, ativa: true })}>+ Conta</button></div>}
          <table><thead><tr><th>ID</th><th>Registro</th><th>Instituição</th><th>Conta</th><th>Tipo</th><th>Saldo abertura (dia anterior à data-base)</th><th>Reserva vinculada</th><th>Ativa</th></tr></thead><tbody>
            {ds.contas.map((c) => <tr key={c.id} className={podeCad ? 'clickable' : ''} onClick={() => podeCad && setConta(c)}><td>{c.id}</td><td>{c.registro}</td><td>{c.instituicao}</td><td>{c.conta}</td><td>{c.tipo}</td><td>{pode(usuario, 'ver_bancos') ? <Money v={c.saldoInicial} /> : '•••'}</td><td>{pode(usuario, 'ver_bancos') ? <Money v={c.reservaVinculada} /> : '•••'}</td><td>{c.ativa ? 'Sim' : 'Não'}</td></tr>)}
          </tbody></table>
        </div>
      )}

      {aba === 'funcoes' && (
        <div className="card table-wrap">
          <p className="small muted">Catálogo de funções dos colaboradores: categoria (fábrica, canteiro ou escritório) e custo/hora padrão sugerido ao cadastrar. Inativar preserva o histórico de quem já tem a função.</p>
          {podeCad && <div className="actions" style={{ marginBottom: 8 }}><button className="btn primary sm" onClick={() => setFuncao({ id: '', nome: '', categoria: 'Canteiro', descricao: '', ativa: true })}>Nova função</button></div>}
          {!(ds.funcoes ?? []).length && <p className="small muted">Nenhuma função cadastrada. As funções digitadas livremente nos colaboradores continuam válidas; cadastre-as aqui para padronizar nome e custo/hora.</p>}
          {!!(ds.funcoes ?? []).length && <table><thead><tr><th>Função</th><th>Categoria</th><th>Custo/hora padrão</th><th>Colaboradores</th><th>Descrição</th><th>Situação</th></tr></thead><tbody>
            {[...ds.funcoes].sort((a, b) => Number(b.ativa) - Number(a.ativa) || a.nome.localeCompare(b.nome)).map((f) => { const n = ds.colaboradores.filter((c) => c.ativo && c.funcao === f.nome).length; return <tr key={f.id} className={podeCad ? 'clickable' : ''} onClick={() => podeCad && setFuncao(f)}><td><b>{f.nome}</b></td><td>{f.categoria}</td><td>{f.custoHoraPadrao !== undefined ? money(f.custoHoraPadrao) : <span className="muted">—</span>}</td><td>{n}</td><td className="small">{f.descricao}</td><td>{f.ativa ? <Badge tone="ok">ativa</Badge> : <Badge tone="muted">inativa</Badge>}</td></tr>; })}
          </tbody></table>}
        </div>
      )}

      {aba === 'alocacoes' && (
        <div className="card table-wrap">
          <p className="small muted">Onde cada colaborador está por período: obra, fábrica ou escritório, com percentual de dedicação. A alocação vigente define quem aparece no diário do dia e no custo de cada obra; sem alocação vale o local e a obra padrão do cadastro do colaborador.</p>
          <div className="actions" style={{ marginBottom: 8, flexWrap: 'wrap' }}>
            {podeAlocar && <button className="btn primary sm" disabled={!ds.colaboradores.some((c) => c.ativo)} title={ds.colaboradores.some((c) => c.ativo) ? undefined : 'Cadastre colaboradores ativos em Equipe antes de alocar'} onClick={() => setAloc({ id: '', colaboradorId: ds.colaboradores.find((c) => c.ativo)?.id ?? '', local: 'Obra', codigoObra: ds.obras.find((o) => o.status === 'Em execução')?.codigo ?? ds.obras[0]?.codigo, de: hoje, percentual: 1, observacoes: '' })}>Nova alocação</button>}
            <Select value={filtroAloc.colaborador} onChange={(v) => setFiltroAloc({ ...filtroAloc, colaborador: v })} allowEmpty="Todos os colaboradores" options={[...ds.colaboradores].filter((c) => c.ativo).sort((a, b) => a.nome.localeCompare(b.nome)).map((c) => ({ value: c.id, label: c.nome }))} />
            <Select value={filtroAloc.obra} onChange={(v) => setFiltroAloc({ ...filtroAloc, obra: v })} allowEmpty="Todas as obras" options={ds.obras.map((o) => ({ value: o.codigo, label: `${o.codigo} · ${o.nome}` }))} />
            <label className="small" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><input type="checkbox" checked={filtroAloc.vigentes} onChange={(e) => setFiltroAloc({ ...filtroAloc, vigentes: e.target.checked })} /> Só vigentes e futuras</label>
          </div>
          {!ds.colaboradores.some((c) => c.ativo) && <p className="small muted">Nenhum colaborador ativo: cadastre a equipe em Equipe › Colaboradores antes de alocar.</p>}
          {!alocacoesFiltradas.length && <p className="small muted">Nenhuma alocação {filtroAloc.vigentes ? 'vigente ou futura' : ''} com esses filtros. Enquanto não houver alocações, o diário do dia usa o local e a obra padrão de cada colaborador.</p>}
          {!!alocacoesFiltradas.length && <table><thead><tr><th>Colaborador</th><th>Função</th><th>Local</th><th>De</th><th>Até</th><th>Dedicação</th><th>Situação</th><th>Observações</th></tr></thead><tbody>
            {alocacoesFiltradas.map((a) => { const c = ds.colaboradores.find((x) => x.id === a.colaboradorId); const sit = vigente(a) ? <Badge tone="ok">vigente</Badge> : a.de > hoje ? <Badge tone="info">futura</Badge> : <Badge tone="muted">encerrada</Badge>; return <tr key={a.id} className={podeAlocar ? 'clickable' : ''} onClick={() => podeAlocar && setAloc(a)}><td><b>{c?.nome ?? a.colaboradorId}</b>{c && !c.ativo && <> <Badge tone="muted">inativo</Badge></>}</td><td className="small">{c?.funcao}</td><td>{rotuloLocal(a)}</td><td>{data(a.de)}</td><td>{a.ate ? data(a.ate) : <span className="muted">em aberto</span>}</td><td>{Math.round(a.percentual * 100)}%</td><td>{sit}</td><td className="small">{a.observacoes}</td></tr>; })}
          </tbody></table>}
          <h3 style={{ marginTop: 16 }}>Hoje ({data(hoje)}): onde está cada colaborador ativo</h3>
          <table className="small"><thead><tr><th>Colaborador</th><th>Função</th><th>Local hoje</th><th>Dedicação</th><th>Origem</th></tr></thead><tbody>
            {[...ds.colaboradores].filter((c) => c.ativo && (!filtroAloc.colaborador || c.id === filtroAloc.colaborador)).sort((a, b) => a.nome.localeCompare(b.nome)).map((c) => { const l = localDoColaborador(ds, c, hoje); if (filtroAloc.obra && l.codigoObra !== filtroAloc.obra) return null; return <tr key={c.id}><td>{c.nome}</td><td>{c.funcao}</td><td>{l.local === 'Obra' && !l.codigoObra ? 'Obra (qualquer)' : rotuloLocal(l)}</td><td>{Math.round(l.percentual * 100)}%</td><td>{l.origem === 'alocacao' ? <Badge tone="ok">alocação</Badge> : <Badge tone="muted">cadastro</Badge>}</td></tr>; })}
          </tbody></table>
        </div>
      )}

      {aba === 'parametros' && (
        <div className="card">
          <div className="form">
            <Field label="Organização"><Input value={params.organizacao} disabled={!podeParams} onChange={(e) => setParams({ ...params, organizacao: e.target.value })} /></Field>
            <Field label="Empresa"><Input value={params.empresa} disabled={!podeParams} onChange={(e) => setParams({ ...params, empresa: e.target.value })} /></Field>
            <Field label="Data-base automática" hint="Ativa: acompanha o dia de hoje (rotina normal). Desativada: fica fixa para fechamento ou simulação"><Select value={params.dataBaseAutomatica ? 'Sim' : 'Não'} disabled={!podeParams} onChange={(v) => setParams({ ...params, dataBaseAutomatica: v === 'Sim' })} options={['Sim', 'Não']} /></Field>
            <Field label="Data-base do modelo" req hint={params.dataBaseAutomatica ? 'Avança sozinha a cada dia' : 'Fixa até você alterar'}><Input type="date" value={params.dataBase} disabled={!podeParams || !!params.dataBaseAutomatica} onChange={(e) => setParams({ ...params, dataBase: e.target.value })} /></Field>
            <Field label="Cenário selecionado"><Select value={params.cenario} disabled={!podeParams} onChange={(v) => setParams({ ...params, cenario: v as Cenario })} options={['Conservador', 'Base', 'Otimista']} /></Field>
            <Field label="Reserva operacional mínima" hint="DEC-09: meta consolidada a definir pela Diretoria"><NumberInput value={params.reservaMinima} disabled={!podeParams} onChange={(v) => setParams({ ...params, reservaMinima: v })} /></Field>
            <Field label="Incluir dados demonstrativos?"><Select value={params.incluirDemo ? 'Sim' : 'Não'} disabled={!podeParams} onChange={(v) => setParams({ ...params, incluirDemo: v === 'Sim' })} options={['Não', 'Sim']} /></Field>
            <Field label="Responsável pelo modelo"><Input value={params.responsavel} disabled={!podeParams} onChange={(e) => setParams({ ...params, responsavel: e.target.value })} /></Field>
            <Field label="Versão"><Input value={params.versao} disabled={!podeParams} onChange={(e) => setParams({ ...params, versao: e.target.value })} /></Field>
          </div>
          <h3 style={{ marginTop: 16 }}>Fatores de cenário (versionados, nunca escondidos em fórmulas)</h3>
          <table style={{ maxWidth: 600 }}><thead><tr><th>Cenário</th><th>Fator entradas</th><th>Fator saídas</th></tr></thead><tbody>
            {(['Conservador', 'Base', 'Otimista'] as Cenario[]).map((c) => <tr key={c}><td>{c}</td><td><input type="number" step="0.01" disabled={!podeParams} value={params.fatores[c].entradas} onChange={(e) => setParams({ ...params, fatores: { ...params.fatores, [c]: { ...params.fatores[c], entradas: Number(e.target.value) } } })} /></td><td><input type="number" step="0.01" disabled={!podeParams} value={params.fatores[c].saidas} onChange={(e) => setParams({ ...params, fatores: { ...params.fatores, [c]: { ...params.fatores[c], saidas: Number(e.target.value) } } })} /></td></tr>)}
          </tbody></table>
          <h3 style={{ marginTop: 16 }}>Alçadas e tolerâncias (DEC-03: confirmar com Diretoria/Financeiro)</h3>
          <div className="form">
            <Field label="LIMITE_GESTOR_OBRA" hint="Saída até este valor, dentro do orçamento, não exige aprovação"><NumberInput value={params.alcadas.limiteGestorObra} disabled={!podeParams} onChange={(v) => setParams({ ...params, alcadas: { ...params.alcadas, limiteGestorObra: v } })} /></Field>
            <Field label="LIMITE_FINANCEIRO" hint="Acima disso entra a Diretoria"><NumberInput value={params.alcadas.limiteFinanceiro} disabled={!podeParams} onChange={(v) => setParams({ ...params, alcadas: { ...params.alcadas, limiteFinanceiro: v } })} /></Field>
            <Field label="LIMITE_DIRETORIA" hint="Acima disso exige aprovadores adicionais"><NumberInput value={params.alcadas.limiteDiretoria} disabled={!podeParams} onChange={(v) => setParams({ ...params, alcadas: { ...params.alcadas, limiteDiretoria: v } })} /></Field>
            <Field label="DESVIO_ORCAMENTO_PERMITIDO (%)"><NumberInput value={Math.round(params.alcadas.desvioOrcamentoPermitido * 100)} disabled={!podeParams} onChange={(v) => setParams({ ...params, alcadas: { ...params.alcadas, desvioOrcamentoPermitido: v / 100 } })} /></Field>
            <Field label="TOLERANCIA_CONCILIACAO (R$)"><NumberInput value={params.alcadas.toleranciaConciliacao} disabled={!podeParams} onChange={(v) => setParams({ ...params, alcadas: { ...params.alcadas, toleranciaConciliacao: v } })} /></Field>
            <Field label="SLA_APROVACAO (horas)"><NumberInput value={params.alcadas.slaAprovacaoHoras} disabled={!podeParams} onChange={(v) => setParams({ ...params, alcadas: { ...params.alcadas, slaAprovacaoHoras: v } })} /></Field>
          </div>
          {podeParams && <div className="actions" style={{ marginTop: 12 }}><button className="btn primary" onClick={() => tentar(() => actions.salvarParametros(params), toast, () => toast('Parâmetros salvos e auditados.'))}>Salvar parâmetros</button><button className="btn" onClick={() => setParams(ds.params)}>Descartar</button></div>}
        </div>
      )}

      {aba === 'usuarios' && (
        <div className="card">
          <p className="small muted">Usuários e escopos demonstrativos (DEC-02 pendente). Na versão Supabase, o login usa auth + MFA para Administrador, Diretoria e Financeiro, e o escopo é aplicado por RLS.</p>
          <table><thead><tr><th>Nome</th><th>E-mail</th><th>Papel</th><th>Escopo de obras</th><th>Ativo</th><th></th></tr></thead><tbody>
            {ds.usuarios.map((u) => <tr key={u.id}><td><b>{u.nome}</b></td><td>{u.email}</td><td><Badge tone="info">{u.papel}</Badge></td><td className="small">{u.obras === '*' ? 'Todas as empresas/obras autorizadas' : u.obras.join(', ') || 'nenhuma'}</td><td>{u.ativo ? 'Sim' : 'Não'}</td><td>{u.id !== usuario.id && <button className="btn sm" onClick={() => actions.trocarUsuario(u.id)}>Entrar como</button>}</td></tr>)}
          </tbody></table>
          <h3 style={{ marginTop: 16 }}>Matriz resumida (seção 7 do blueprint)</h3>
          <table className="small"><thead><tr><th>Ação</th><th>Papéis</th></tr></thead><tbody>
            {[['Ver saldos e transações bancárias', 'Administrador, Diretoria, Financeiro, Contabilidade, Auditoria'], ['Criar/editar lançamentos', 'Administrador, Diretoria, Financeiro, Gestor de obra, Engenharia, Compras'], ['Liquidar e conciliar', 'Administrador, Financeiro'], ['Aprovar (por etapa da alçada)', 'Gestor de obra → Financeiro → Diretoria'], ['Atualizar execução física / ETC', 'Gestor de obra, Engenharia, Financeiro'], ['Fechar período / reabrir', 'Financeiro / Diretoria'], ['Plano de contas, contas, parâmetros', 'Administrador, Financeiro (parâmetros também Diretoria)'], ['Auditoria', 'Somente leitura, temporário, registrado']].map(([a, p]) => <tr key={a}><td>{a}</td><td>{p}</td></tr>)}
          </tbody></table>
        </div>
      )}

      {aba === 'dados' && (
        <div className="card">
          <h2>Dados e migração</h2>
          <dl className="kv">
            <dt>Fonte inicial</dt><dd>Fluxo_de_Caixa_EIFF.xlsx (script <code>npm run migrate:planilha</code>)</dd>
            <dt>Lançamentos / obras / contas</dt><dd>{ds.lancamentos.length} / {ds.obras.length} / {ds.contas.length}</dd>
            <dt>Liquidações / transações / aprovações</dt><dd>{ds.liquidacoes.length} / {ds.transacoes.length} / {ds.aprovacoes.length}</dd>
            <dt>Eventos de auditoria</dt><dd>{ds.auditoria.length}</dd>
            <dt>Persistência</dt><dd>navegador local (localStorage). Na fase 1 os mesmos dados migram para Supabase/PostgreSQL com as migrations em <code>supabase/migrations</code>.</dd>
          </dl>
          <div className="actions" style={{ marginTop: 12 }}>
            {pode(usuario, 'exportar') && <button className="btn" onClick={() => tentar(() => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([actions.exportarJson()], { type: 'application/json' })); a.download = 'eiff-control-dados.json'; a.click(); }, toast)}>Exportar JSON</button>}
            {pode(usuario, 'administrar') && <label className="btn">Importar JSON<input type="file" accept=".json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (!f) return; f.text().then((t) => tentar(() => actions.importarJson(t), toast, () => toast('Dados importados.'))); }} /></label>}
            {pode(usuario, 'administrar') && <button className="btn danger" onClick={() => window.confirm('Descartar todas as alterações locais e recarregar os dados da planilha?') && tentar(() => actions.restaurarPlanilha(), toast, () => toast('Dados da planilha restaurados.'))}>Restaurar dados da planilha</button>}
          </div>
        </div>
      )}

      {pc && (
        <Modal title={pc.original ? `Categoria ${pc.original}` : 'Nova categoria'} onClose={() => setPc(null)}>
          {pc.original && usoCategoria(pc.original) > 0 && <div className="alert warn">Categoria usada em {usoCategoria(pc.original)} lançamento(s): alterar grupos muda o fluxo e a DRE retroativamente. Valide os mapeamentos.</div>}
          <div className="form">
            <Field label="Categoria" req><Input value={pc.item.categoria} onChange={(e) => setPc({ ...pc, item: { ...pc.item, categoria: e.target.value } })} /></Field>
            <Field label="Tipo"><Select value={pc.item.tipo} onChange={(v) => setPc({ ...pc, item: { ...pc.item, tipo: v as TipoLancamento } })} options={['Entrada', 'Saída']} /></Field>
            <Field label="Grupo de fluxo" req><Select value={pc.item.grupoFluxo} onChange={(v) => setPc({ ...pc, item: { ...pc.item, grupoFluxo: v } })} options={GRUPOS_FLUXO} /></Field>
            <Field label="Grupo DRE" req><Select value={pc.item.grupoDre} onChange={(v) => setPc({ ...pc, item: { ...pc.item, grupoDre: v } })} options={GRUPOS_DRE} /></Field>
            <Field label="Classe"><Select value={pc.item.classe} onChange={(v) => setPc({ ...pc, item: { ...pc.item, classe: v } })} options={CLASSES} /></Field>
            <Field label="Ativa"><Select value={pc.item.ativa ? 'Sim' : 'Não'} onChange={(v) => setPc({ ...pc, item: { ...pc.item, ativa: v === 'Sim' } })} options={['Sim', 'Não']} /></Field>
            <Field label="Orientação de uso" full><Input value={pc.item.orientacao} onChange={(e) => setPc({ ...pc, item: { ...pc.item, orientacao: e.target.value } })} /></Field>
          </div>
          <div className="foot"><button className="btn" onClick={() => setPc(null)}>Cancelar</button><button className="btn primary" onClick={() => tentar(() => actions.salvarPlanoConta(pc.item, pc.original), toast, () => setPc(null))}>Salvar</button></div>
        </Modal>
      )}
      {funcao && (
        <Modal title={funcao.id ? `Função ${funcao.nome}` : 'Nova função'} onClose={() => setFuncao(null)}>
          <div className="form">
            <Field label="Nome" req hint="Único no catálogo; é o texto que aparece no cadastro do colaborador"><Input value={funcao.nome} onChange={(e) => setFuncao({ ...funcao, nome: e.target.value })} /></Field>
            <Field label="Categoria"><Select value={funcao.categoria} onChange={(v) => setFuncao({ ...funcao, categoria: v as CategoriaFuncao })} options={['Fábrica', 'Canteiro', 'Escritório']} /></Field>
            <Field label="Custo/hora padrão (R$)" hint="Sugerido ao cadastrar um colaborador com esta função; não altera quem já existe"><NumberInput value={funcao.custoHoraPadrao ?? 0} onChange={(v) => setFuncao({ ...funcao, custoHoraPadrao: v > 0 ? v : undefined })} /></Field>
            <Field label="Situação"><Select value={funcao.ativa ? 'Ativa' : 'Inativa'} onChange={(v) => setFuncao({ ...funcao, ativa: v === 'Ativa' })} options={['Ativa', 'Inativa']} /></Field>
            <Field label="Descrição" full><Input value={funcao.descricao} onChange={(e) => setFuncao({ ...funcao, descricao: e.target.value })} /></Field>
          </div>
          <div className="foot"><button className="btn" onClick={() => setFuncao(null)}>Cancelar</button><button className="btn primary" onClick={() => tentar(() => actions.salvarFuncao(funcao), toast, () => { setFuncao(null); toast('Função salva.'); })}>Salvar</button></div>
        </Modal>
      )}
      {aloc && (
        <Modal title={aloc.id ? `Alocação de ${nomeColab(aloc.colaboradorId)}` : 'Nova alocação'} onClose={() => setAloc(null)}>
          {conflitosDe.length > 0 && <div className="alert warn">Soma das alocações no período passaria de 100%: {conflitosDe.map((x) => `${rotuloLocal(x)} ${Math.round(x.percentual * 100)}% (${data(x.de)}${x.ate ? ` a ${data(x.ate)}` : ' em aberto'})`).join('; ')}. Ajuste percentuais ou datas.</div>}
          <div className="form">
            <Field label="Colaborador" req><Select value={aloc.colaboradorId} onChange={(v) => setAloc({ ...aloc, colaboradorId: v })} options={[...ds.colaboradores].filter((c) => c.ativo || c.id === aloc.colaboradorId).sort((a, b) => a.nome.localeCompare(b.nome)).map((c) => ({ value: c.id, label: `${c.nome} · ${c.funcao}` }))} /></Field>
            <Field label="Local" req><Select value={aloc.local} onChange={(v) => setAloc({ ...aloc, local: v as LocalTrabalho, codigoObra: v === 'Obra' ? aloc.codigoObra ?? ds.obras[0]?.codigo : undefined })} options={['Obra', 'Fábrica', 'Escritório']} /></Field>
            {aloc.local === 'Obra' && <Field label="Obra" req><Select value={aloc.codigoObra ?? ''} onChange={(v) => setAloc({ ...aloc, codigoObra: v })} options={ds.obras.map((o) => ({ value: o.codigo, label: `${o.codigo} · ${o.nome}` }))} /></Field>}
            <Field label="De" req><Input type="date" value={aloc.de} onChange={(e) => setAloc({ ...aloc, de: e.target.value })} /></Field>
            <Field label="Até" hint="Vazio = em aberto, vale até ser encerrada"><Input type="date" value={aloc.ate ?? ''} onChange={(e) => setAloc({ ...aloc, ate: e.target.value || undefined })} /></Field>
            <Field label="Dedicação (%)" req hint="Parte da jornada dedicada a este local; a soma no período não passa de 100%"><NumberInput value={Math.round(aloc.percentual * 100)} onChange={(v) => setAloc({ ...aloc, percentual: Math.min(100, Math.max(0, v)) / 100 })} /></Field>
            <Field label="Observações" full><Input value={aloc.observacoes} onChange={(e) => setAloc({ ...aloc, observacoes: e.target.value })} /></Field>
          </div>
          <div className="foot">
            {aloc.id && !aloc.ate && <button className="btn" onClick={() => tentar(() => actions.salvarAlocacao({ ...aloc, ate: hoje }), toast, () => { setAloc(null); toast('Alocação encerrada hoje.'); })}>Encerrar hoje</button>}
            {aloc.id && <button className="btn danger" onClick={() => window.confirm('Excluir esta alocação? O histórico do diário não muda.') && tentar(() => actions.excluirAlocacao(aloc.id), toast, () => { setAloc(null); toast('Alocação excluída.'); })}>Excluir</button>}
            <button className="btn" onClick={() => setAloc(null)}>Cancelar</button>
            <button className="btn primary" onClick={() => tentar(() => actions.salvarAlocacao(aloc), toast, () => { setAloc(null); toast('Alocação salva.'); })}>Salvar</button>
          </div>
        </Modal>
      )}
      {conta && (
        <Modal title={`Conta ${conta.id}`} onClose={() => setConta(null)}>
          <div className="form">
            <Field label="ID"><Input value={conta.id} onChange={(e) => setConta({ ...conta, id: e.target.value })} /></Field>
            <Field label="Registro"><Select value={conta.registro} onChange={(v) => setConta({ ...conta, registro: v as ContaFinanceira['registro'] })} options={['Real', 'Exemplo']} /></Field>
            <Field label="Instituição" req><Input value={conta.instituicao} onChange={(e) => setConta({ ...conta, instituicao: e.target.value })} /></Field>
            <Field label="Conta"><Input value={conta.conta} onChange={(e) => setConta({ ...conta, conta: e.target.value })} /></Field>
            <Field label="Tipo"><Select value={conta.tipo} onChange={(v) => setConta({ ...conta, tipo: v })} options={['Caixa', 'Conta corrente', 'Aplicação', 'Cartão', 'Outra']} /></Field>
            <Field label="Saldo de abertura" hint="Saldo no início do dia informado ao lado"><NumberInput value={conta.saldoInicial} onChange={(v) => setConta({ ...conta, saldoInicial: v })} /></Field>
            <Field label="Data do saldo de abertura" req hint="Os movimentos do extrato e os lançamentos contam a partir deste dia"><Input type="date" value={conta.saldoInicialData ?? ds.params.dataBase} onChange={(e) => setConta({ ...conta, saldoInicialData: e.target.value || undefined })} /></Field>
            <Field label="Reserva vinculada"><NumberInput value={conta.reservaVinculada} onChange={(v) => setConta({ ...conta, reservaVinculada: v })} /></Field>
            <Field label="Ativa"><Select value={conta.ativa ? 'Sim' : 'Não'} onChange={(v) => setConta({ ...conta, ativa: v === 'Sim' })} options={['Sim', 'Não']} /></Field>
          </div>
          <div className="foot"><button className="btn" onClick={() => setConta(null)}>Cancelar</button><button className="btn primary" onClick={() => tentar(() => actions.salvarConta(conta), toast, () => setConta(null))}>Salvar</button></div>
        </Modal>
      )}
      {el}
      <span hidden>{money(0)}</span>
    </>
  );
}
