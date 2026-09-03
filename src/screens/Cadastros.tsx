import React, { useState } from 'react';
import type { Cenario, ContaFinanceira, Params, PlanoConta, TipoLancamento } from '../core/types';
import { actions, pode, useStore } from '../data/store';
import { Badge, Field, Input, Modal, Money, NumberInput, PageHead, Select, Tabs, money, tentar, useToast } from '../ui/components';

const GRUPOS_FLUXO = ['Receitas Operacionais', 'Outras Entradas', 'Financiamento e Capital', 'Custos Diretos de Obras', 'Despesas com Pessoal', 'Despesas Administrativas', 'Despesas Comerciais', 'Despesas Operacionais', 'Tributos', 'Serviço da Dívida', 'Investimentos', 'Outras Saídas'];
const GRUPOS_DRE = ['Receita Operacional', 'Deduções da Receita', 'Outras Receitas Operacionais', 'Outras Receitas', 'Custos Diretos', 'Despesas com Pessoal', 'Despesas Administrativas', 'Despesas Comerciais', 'Despesas Operacionais', 'Outras Despesas', 'Tributos', 'Resultado Financeiro', 'Não DRE'];
const CLASSES = ['Operacional', 'Custo direto', 'Despesa indireta', 'Tributo', 'Financeiro', 'Financiamento', 'Investimento', 'Capital', 'Não operacional'];

export default function Cadastros({ aba0 }: { aba0?: string }) {
  const { ds, usuario } = useStore();
  const { toast, el } = useToast();
  const [aba, setAba] = useState<'plano' | 'contas' | 'parametros' | 'usuarios' | 'dados'>((aba0 as 'plano') ?? 'plano');
  const [pc, setPc] = useState<{ item: PlanoConta; original?: string } | null>(null);
  const [conta, setConta] = useState<ContaFinanceira | null>(null);
  const [params, setParams] = useState<Params>(ds.params);
  const podeCad = pode(usuario, 'editar_cadastros');
  const podeParams = pode(usuario, 'editar_parametros');
  const usoCategoria = (c: string) => ds.lancamentos.filter((l) => l.categoria === c).length;

  return (
    <>
      <PageHead title="Cadastros mestres e parâmetros" subtitle="Plano de contas com mapas de fluxo e DRE, contas financeiras, parâmetros de cenário, reserva e alçadas, usuários e escopos." />
      <Tabs value={aba} onChange={setAba} items={[{ id: 'plano', label: `Plano de contas (${ds.planoContas.length})` }, { id: 'contas', label: 'Contas financeiras' }, { id: 'parametros', label: 'Parâmetros e alçadas' }, { id: 'usuarios', label: 'Usuários e permissões' }, { id: 'dados', label: 'Dados e migração' }]} />

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
