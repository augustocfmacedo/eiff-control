// Caixa no formato da planilha: lista unica (data, descricao, departamento, entra, sai, situacao, saldo) com lancamento em
// linha e Previsto/Pago num clique, e ao lado o saldo previsto dia a dia. Os numeros vem de livroCaixa (src/core/caixa.ts);
// toda gravacao passa pelas acoes do store (lancarCaixa, pagarCaixa, estornarLiquidacoes, editarLinhaCaixa, excluirLancamento).
import { useMemo, useState } from 'react';
import { addDays, calcLancamentos } from '../core/engine';
import { DEPARTAMENTOS, livroCaixa, type LinhaCaixa } from '../core/caixa';
import { centralDF } from '../core/cfo';
import { BriefingDF, ConversaDF, PedidosDF } from './DiretorFinanceiro';
import { actions, obrasVisiveis, pode, useStore } from '../data/store';
import { Sparkline } from '../ui/charts';
import { Badge, Empty, Field, KpiHero, KpiStrip, Modal, MoedaInput, PageHead, Select, money, tentar, useToast, type Tone } from '../ui/components';
import { Tabela, type Coluna } from '../ui/Tabela';
import { navegar } from '../ui/router';

const d = (s?: string) => (s ? s.split('-').reverse().join('/') : '—');
const dCurta = (s: string) => s.split('-').reverse().slice(0, 2).join('/');
const TOM: Record<LinhaCaixa['situacao'], Tone> = { Pago: 'ok', Previsto: 'info', Vencido: 'bad', 'Em aprovação': 'warn', Rascunho: 'muted', Extrato: 'warn' };
const HORIZONTES = [{ value: '30', label: 'Próximos 30 dias' }, { value: '60', label: 'Próximos 60 dias' }, { value: '90', label: 'Próximos 90 dias' }, { value: '365', label: 'Próximos 12 meses' }];

interface Rascunho { data: string; descricao: string; departamento: string; codigoObra: string; entra: number; sai: number; pago: boolean }
interface Edicao { id: string; data: string; descricao: string; departamento: string; codigoObra: string; valor: number; tipo: 'Entrada' | 'Saída' }

export default function Caixa() {
  const { ds, usuario } = useStore();
  const hoje = ds.params.dataBase;
  const vazio: Rascunho = { data: hoje, descricao: '', departamento: 'Obra', codigoObra: '', entra: 0, sai: 0, pago: false };
  const [horizonte, setHorizonte] = useState('30');
  const [dep, setDep] = useState('');
  const [soAberto, setSoAberto] = useState(false);
  const [novo, setNovo] = useState<Rascunho>(vazio);
  const [erros, setErros] = useState<string[]>([]);
  const [edicao, setEdicao] = useState<Edicao | null>(null);
  const [estorno, setEstorno] = useState<{ id: string; motivo: string } | null>(null);
  const [exclusao, setExclusao] = useState<{ id: string; motivo: string } | null>(null);
  const { toast, el } = useToast();
  const verBancos = pode(usuario, 'ver_bancos');
  const ate = addDays(hoje, Number(horizonte));
  const livro = useMemo(() => livroCaixa(ds, ate, calcLancamentos(ds), { verBancos }), [ds, ate, verBancos]);
  const obras = useMemo(() => obrasVisiveis(usuario, ds.obras).filter((o) => o.status !== 'Cancelada' && o.status !== 'Concluída'), [usuario, ds.obras]);
  const linhas = useMemo(() => livro.linhas.filter((x) => (!dep || x.departamento === dep) && (!soAberto || x.situacao !== 'Pago')), [livro, dep, soAberto]);
  // Diretor Financeiro dentro da Caixa: briefing do dia e pedidos da equipe para decidir (so para quem decide: ve bancos e aprova)
  const diretoria = verBancos && pode(usuario, 'aprovar');
  const central = useMemo(() => (diretoria ? centralDF(ds) : null), [ds, diretoria]);
  const CHAVE_CONVERSA = 'eiff-control:caixa:conversa';
  const [conversa, setConversa] = useState(() => { try { return sessionStorage.getItem(CHAVE_CONVERSA) === '1'; } catch { return false; } });
  const alternarConversa = () => setConversa((v) => { try { sessionStorage.setItem(CHAVE_CONVERSA, v ? '0' : '1'); } catch { /* ignore */ } return !v; });
  const podeLancar = pode(usuario, 'editar_lancamento');
  const podePagar = pode(usuario, 'liquidar');
  if (!verBancos) return <Empty titulo="Caixa restrito">O caixa mostra saldos e é restrito a Financeiro, Diretoria, Contabilidade e Auditoria.</Empty>;

  const deps = DEPARTAMENTOS.map((x) => x.id);
  const lancar = () => {
    const tipo = novo.entra > 0 ? 'Entrada' : 'Saída';
    const valor = novo.entra > 0 ? novo.entra : novo.sai;
    if (novo.entra > 0 && novo.sai > 0) { setErros(['Preencha só Entra ou só Sai.']); return; }
    tentar(() => {
      const r = actions.lancarCaixa({ data: novo.data, descricao: novo.descricao, departamento: novo.departamento, tipo, valor, pago: novo.pago, codigoObra: novo.codigoObra || undefined });
      const avisos = [r.aprovacaoAberta ? 'foi para aprovação (fica fora do saldo até a decisão)' : '', r.categoriaAjustada ? 'categoria genérica: escolha a obra para classificar como custo/receita da obra' : ''].filter(Boolean);
      toast(`${r.lancamento.id} lançado${r.pago ? ' e pago' : ''}${avisos.length ? ` · ${avisos.join(' · ')}` : ''}.`);
    }, (m) => setErros([m]), () => { setErros([]); setNovo({ ...vazio, data: novo.data, departamento: novo.departamento }); });
  };
  const pagar = (x: LinhaCaixa) => tentar(() => actions.pagarCaixa(x.lancamentoId, x.data < hoje ? x.data : hoje), toast, () => toast(`${x.lancamentoId} marcado como ${x.tipo === 'Entrada' ? 'recebido' : 'pago'}.`));
  const editar = (x: LinhaCaixa) => {
    const l = ds.lancamentos.find((y) => y.id === x.lancamentoId);
    if (!l) return;
    setEdicao({ id: l.id, data: l.vencimento, descricao: l.descricao, departamento: x.departamento, codigoObra: l.codigoObra, valor: l.valorBruto, tipo: x.tipo });
  };

  const colunas: Coluna<LinhaCaixa>[] = [
    { titulo: 'Data', largura: 52 },
    { titulo: 'Descrição' },
    { titulo: 'Departamento', largura: 96 },
    { titulo: 'Entra', num: true, largura: 104 },
    { titulo: 'Sai', num: true, largura: 104 },
    { titulo: 'Situação', largura: 116 },
    { titulo: 'Saldo', num: true, largura: 110 },
  ];
  // clique na linha: previsto abre a edicao rapida; pago (ou quem nao edita) abre o lancamento completo
  const abrir = (x: LinhaCaixa) => (x.situacao === 'Extrato' ? navegar('/conciliacao') : x.situacao !== 'Pago' && podeLancar ? editar(x) : navegar(`/lancamentos/${x.lancamentoId}`));
  const linha = (x: LinhaCaixa) => (
    <>
      <td title={x.situacao === 'Vencido' ? `venceu em ${d(x.data)}` : undefined} className={x.situacao === 'Vencido' ? 'neg' : ''}>{dCurta(x.data)}</td>
      <td>
        <div>{x.descricao}</div>
        <div className="small muted">{x.lancamentoId}{x.codigoObra ? ` · ${x.codigoObra}` : ''}{x.contraparte && x.contraparte !== x.descricao ? ` · ${x.contraparte}` : ''}{x.nota ? ` · ${x.nota}` : ''}</div>
      </td>
      <td>{x.departamento}</td>
      <td className="num pos">{x.entra ? money(x.entra) : ''}</td>
      <td className="num neg">{x.sai ? money(x.sai) : ''}</td>
      <td>
        {x.situacao === 'Pago' || x.situacao === 'Previsto' || x.situacao === 'Vencido'
          ? <button className={`badge ${TOM[x.situacao]} caixa-situacao`} disabled={x.situacao === 'Pago' ? !podePagar || x.conciliado : !podePagar}
              title={!podePagar ? 'Seu perfil não registra pagamentos (permissão de liquidar: Financeiro ou Administrador)' : x.situacao === 'Pago' ? (x.conciliado ? 'Conciliado com o extrato: desfaça a conciliação para estornar' : 'Clique para desfazer o pagamento') : 'Clique para marcar como pago'}
              onClick={(e) => { e.stopPropagation(); if (x.situacao === 'Pago') setEstorno({ id: x.lancamentoId, motivo: '' }); else pagar(x); }}>
              {x.situacao === 'Pago' ? (x.tipo === 'Entrada' ? 'Recebido' : 'Pago') : x.situacao}{x.conciliado ? ' · conciliado' : ''}
            </button>
          : <Badge tone={TOM[x.situacao]}>{x.situacao}</Badge>}
      </td>
      <td className={`num ${x.saldo !== undefined && x.saldo < livro.reserva ? 'neg' : ''}`}>{x.saldo !== undefined ? money(x.saldo) : <span className="muted small">fora do saldo</span>}</td>
    </>
  );

  const valores30 = livro.dias.map((x) => x.saldo);
  const abaixo = livro.dias.filter((x) => x.abaixoReserva);
  return (
    <>
      <PageHead title="Caixa" subtitle={<>Do jeito da planilha: o que entra, o que sai e o saldo dia a dia. Começa no marco de {d(livro.marco)} com {money(livro.saldoAbertura)} de saldo inicial. Pago entra na data em que foi pago; previsto, no vencimento.</>}>
        <Select value={horizonte} onChange={setHorizonte} options={HORIZONTES} aria-label="Horizonte" />
        <button className="btn no-print" onClick={() => window.print()}>Imprimir</button>
      </PageHead>
      {el}

      {central && <BriefingDF c={central} acoes={<>
        <button className={`btn sm${conversa ? ' primary' : ''}`} aria-expanded={conversa} onClick={alternarConversa}>{conversa ? 'Fechar a conversa' : 'Perguntar ao Diretor'}</button>
        <button className="btn sm" onClick={() => navegar('/diretor')}>Abrir a Central</button>
      </>} />}
      {central && conversa && <div className="card df-card-chat caixa-conversa"><ConversaDF key={usuario.id} veCaixa /></div>}
      {central && <PedidosDF c={central} vazio={false} />}

      <div className="hero-grid">
        <KpiHero label="Saldo hoje" value={money(livro.saldoHoje)} hint={livro.extratoAte ? `extrato até ${d(livro.extratoAte)} + o que já foi pago e recebido e ainda não está nele · o mesmo do Diretor Financeiro` : `abertura de ${money(livro.saldoAbertura)} em ${d(livro.marco)} + o que já foi pago e recebido · o mesmo do Diretor Financeiro`} tone={livro.saldoHoje < livro.reserva ? 'bad' : undefined}
          secundarios={[
            { label: 'No banco (extrato)', value: livro.extratoAte ? money(livro.saldoBanco) : 'sem extrato' },
            { label: 'Daqui a 7 dias', value: money(livro.previsto7), tone: livro.previsto7 < livro.reserva ? 'neg' : undefined },
            { label: 'Daqui a 30 dias', value: money(livro.previsto30), tone: livro.previsto30 < livro.reserva ? 'neg' : undefined },
          ]}>
          <Sparkline valores={valores30} referencia={livro.reserva || undefined} rotulos={livro.dias.map((x) => dCurta(x.data))} />
        </KpiHero>
        <KpiHero label="Menor saldo no período" value={money(livro.menor.saldo)} hint={`em ${d(livro.menor.data)}${livro.reserva ? ` · reserva mínima ${money(livro.reserva)}` : ''}`} tone={livro.menor.saldo < 0 ? 'bad' : livro.menor.saldo < livro.reserva ? 'warn' : 'ok'}
          secundarios={[{ label: `Saldo em ${dCurta(livro.ate)}`, value: money(livro.saldoFinal) }]} />
      </div>
      <KpiStrip itens={[
        { label: 'Entradas previstas', value: money(livro.entradasPrevistas), tone: 'pos' },
        { label: 'Saídas previstas', value: money(livro.saidasPrevistas), tone: 'neg' },
        { label: 'Pagamentos vencidos', value: money(livro.vencidosPagar), tone: livro.vencidosPagar ? 'neg' : undefined, hint: 'contam no saldo de hoje' },
        { label: 'Recebimentos vencidos', value: money(livro.vencidosReceber), tone: livro.vencidosReceber ? 'warn' : undefined, hint: 'fora do saldo até entrar' },
      ]} />
      {livro.extratoAte === undefined && <div className="alert info">Ainda não há extrato importado depois do marco. Importe o OFX em Bancos e conciliação para conferir o saldo e marcar os pagos automaticamente.</div>}
      {abaixo.length > 0 && <div className="alert warn">O saldo fica abaixo da reserva mínima em {abaixo.length} dia(s), a partir de {d(abaixo[0].data)}.</div>}

      <div className="caixa-layout">
        <div className="card">
          {podeLancar && (
            <div className="caixa-novo no-print" onKeyDown={(e) => { if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'BUTTON') { e.preventDefault(); lancar(); } }}>
              <Field label="Data"><input type="date" value={novo.data} onChange={(e) => setNovo({ ...novo, data: e.target.value })} /></Field>
              <Field label="Descrição"><input value={novo.descricao} placeholder="ex.: Passagem Tiago" onChange={(e) => setNovo({ ...novo, descricao: e.target.value })} /></Field>
              <Field label="Departamento"><Select value={novo.departamento} onChange={(v) => setNovo({ ...novo, departamento: v })} options={deps} /></Field>
              <Field label="Obra"><Select value={novo.codigoObra} onChange={(v) => setNovo({ ...novo, codigoObra: v })} allowEmpty="—" options={obras.map((o) => ({ value: o.codigo, label: o.nome }))} /></Field>
              <Field label="Entra"><MoedaInput value={novo.entra} onChange={(v) => setNovo({ ...novo, entra: v })} /></Field>
              <Field label="Sai"><MoedaInput value={novo.sai} onChange={(v) => setNovo({ ...novo, sai: v })} /></Field>
              <label className="caixa-pago"><input type="checkbox" checked={novo.pago} onChange={(e) => setNovo({ ...novo, pago: e.target.checked })} disabled={!podePagar || novo.data > hoje} /> Já pago</label>
              <button className="btn primary" onClick={lancar}>Lançar</button>
              {erros.length > 0 && <div className="caixa-erros erro" role="alert">{erros.join(' ')}</div>}
            </div>
          )}
          <div className="row caixa-filtros no-print">
            <Select value={dep} onChange={setDep} allowEmpty="Todos os departamentos" options={deps} aria-label="Departamento" />
            <label className="small"><input type="checkbox" checked={soAberto} onChange={(e) => setSoAberto(e.target.checked)} /> Só o que falta pagar/receber</label>
            <span className="small muted">Clique na linha para editar · na situação para marcar pago</span>
          </div>
          <Tabela colunas={colunas} linhas={linhas} chave={(x) => x.chave} linha={linha} onLinha={abrir} altura="70vh" className="caixa-tabela"
            vazio={<Empty titulo="Nada no período">Lance a primeira linha acima ou aumente o horizonte.</Empty>}
            csv={{ nome: 'caixa', cabecalho: ['Data', 'Lançamento', 'Descrição', 'Departamento', 'Obra', 'Entra', 'Sai', 'Situação', 'Saldo'], linha: (x) => [d(x.data), x.lancamentoId, x.descricao, x.departamento, x.codigoObra, x.entra || '', x.sai || '', x.situacao, x.saldo ?? ''] }} />
        </div>

        <div className="caixa-lateral">
          <div className="card">
            <h2>Saldo previsto por dia</h2>
            <div className="table-wrap caixa-dias">
              <table>
                <thead><tr><th>Dia</th><th className="num">Entra</th><th className="num">Sai</th><th className="num">Saldo</th></tr></thead>
                <tbody>{livro.dias.filter((x, i) => i === 0 || x.entra || x.sai || i === livro.dias.length - 1).map((x) => (
                  <tr key={x.data} className={x.data === livro.menor.data ? 'destaque' : ''}>
                    <td>{dCurta(x.data)}{x.data === hoje ? ' (hoje)' : ''}</td>
                    <td className="num pos">{x.entra ? money(x.entra) : ''}</td>
                    <td className="num neg">{x.sai ? money(x.sai) : ''}</td>
                    <td className={`num ${x.abaixoReserva ? 'neg' : ''}`}><b>{money(x.saldo)}</b></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <p className="small muted">Só aparecem os dias com movimento; o saldo não muda nos demais.</p>
          </div>
          <div className="card">
            <h2>Por departamento</h2>
            <table>
              <thead><tr><th>Departamento</th><th className="num">Entra</th><th className="num">Sai</th></tr></thead>
              <tbody>{livro.porDepartamento.map((x) => (
                <tr key={x.departamento} className="clickable" onClick={() => setDep(dep === x.departamento ? '' : x.departamento)}>
                  <td>{x.departamento}</td><td className="num pos">{x.entra ? money(x.entra) : ''}</td><td className="num neg">{x.sai ? money(x.sai) : ''}</td>
                </tr>
              ))}</tbody>
            </table>
            <p className="small muted">Pago + previsto do marco até {d(livro.ate)}. Clique para filtrar a lista.</p>
          </div>
        </div>
      </div>

      {edicao && (
        <Modal title={`Editar ${edicao.id}`} onClose={() => setEdicao(null)}>
          <div className="form">
            <Field label="Data"><input type="date" value={edicao.data} onChange={(e) => setEdicao({ ...edicao, data: e.target.value })} /></Field>
            <Field label={edicao.tipo === 'Entrada' ? 'Entra' : 'Sai'}><MoedaInput value={edicao.valor} onChange={(v) => setEdicao({ ...edicao, valor: v })} /></Field>
            <Field label="Descrição" full><input value={edicao.descricao} onChange={(e) => setEdicao({ ...edicao, descricao: e.target.value })} /></Field>
            <Field label="Departamento"><Select value={edicao.departamento} onChange={(v) => setEdicao({ ...edicao, departamento: v })} options={deps} /></Field>
            <Field label="Obra"><Select value={edicao.codigoObra} onChange={(v) => setEdicao({ ...edicao, codigoObra: v })} allowEmpty="—" options={obras.map((o) => ({ value: o.codigo, label: o.nome }))} /></Field>
          </div>
          <div className="row" style={{ justifyContent: 'space-between', marginTop: 16 }}>
            <button className="btn danger" onClick={() => { setExclusao({ id: edicao.id, motivo: '' }); setEdicao(null); }}>Excluir</button>
            <div className="row">
              <button className="btn" onClick={() => setEdicao(null)}>Cancelar</button>
              <button className="btn primary" onClick={() => tentar(() => actions.editarLinhaCaixa(edicao.id, { data: edicao.data, descricao: edicao.descricao, departamento: edicao.departamento, valor: edicao.valor, codigoObra: edicao.codigoObra || undefined }), toast, () => { toast(`${edicao.id} atualizado.`); setEdicao(null); })}>Salvar</button>
            </div>
          </div>
        </Modal>
      )}
      {estorno && (
        <Modal title={`Desfazer pagamento de ${estorno.id}`} onClose={() => setEstorno(null)}>
          <p>O pagamento é estornado (fica registrado na auditoria) e a linha volta a <b>previsto</b>.</p>
          <Field label="Motivo" req full><input autoFocus value={estorno.motivo} onChange={(e) => setEstorno({ ...estorno, motivo: e.target.value })} placeholder="ex.: marquei pago por engano" /></Field>
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
            <button className="btn" onClick={() => setEstorno(null)}>Cancelar</button>
            <button className="btn primary" onClick={() => tentar(() => actions.estornarLiquidacoes(estorno.id, estorno.motivo), toast, () => { toast(`${estorno.id} voltou a previsto.`); setEstorno(null); })}>Desfazer pagamento</button>
          </div>
        </Modal>
      )}
      {exclusao && (
        <Modal title={`Excluir ${exclusao.id}`} onClose={() => setExclusao(null)}>
          <p>A linha sai do caixa, do fluxo e da DRE. Nada é apagado: o lançamento fica no filtro "Excluídos" e na auditoria.</p>
          <Field label="Motivo" req full><input autoFocus value={exclusao.motivo} onChange={(e) => setExclusao({ ...exclusao, motivo: e.target.value })} placeholder="ex.: lançado em duplicidade" /></Field>
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
            <button className="btn" onClick={() => setExclusao(null)}>Cancelar</button>
            <button className="btn danger" onClick={() => tentar(() => actions.excluirLancamento(exclusao.id, exclusao.motivo), toast, () => { toast(`${exclusao.id} excluído.`); setExclusao(null); })}>Excluir</button>
          </div>
        </Modal>
      )}
    </>
  );
}
