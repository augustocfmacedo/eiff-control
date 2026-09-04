// Assistente do sistema: monta o conhecimento (regras, licoes, processos, rotinas, setores) para o modelo e oferece
// uma busca local nas licoes quando o servico de IA nao esta configurado. Sem dependencia de rede aqui.

import { LICOES, PROCESSOS, ROTINAS, TRILHAS, type Licao } from './capacitacao';
import { SETORES } from './ebook';
import type { Papel } from './types';

export interface MensagemChat { papel: 'usuario' | 'assistente'; texto: string; licoes?: string[]; origem?: 'ia' | 'local' }
export interface ContextoAssistente { papel: Papel; nome: string; tela?: string; obra?: string; dataBase?: string; resumo?: string }

const REGRAS_GERAIS = [
  'Valores são sempre positivos; o tipo (Entrada/Saída) dá o sinal. Caixa usa data de realização ou vencimento; DRE usa competência.',
  'Saída acima do limite do gestor de obra, fora do orçamento da obra ou que leve o caixa abaixo da reserva mínima exige aprovação Gestor → Financeiro → Diretoria. Solicitante não decide a própria solicitação.',
  'Movimento bancário é fato: "Lançar a partir da transação" cria lançamento realizado, liquidado e conciliado, sem alçada. OFX não repete transações (FITID).',
  'Nada financeiro é apagado: cancelamento ou estorno com motivo. Período fechado bloqueia alterações; só Diretoria/Administrador reabrem.',
  'Custo previsto do serviço: custo orçado próprio › custo direto do orçamento executivo contratado › receita × (1 − margem alvo). EAC = pago + comprometido em aberto + ETC não comprometido.',
  'Faturamento direto ao cliente: compra que o cliente paga ao fornecedor; conta no comprometido da obra e abate o contrato global; fora do caixa, fluxo, DRE e aging da EIFF.',
  'Avanço físico do serviço, em ordem: Concluído; lista de materiais em kg (fabricação × peso + montagem × (1 − peso), peso padrão 0,6); ordens de produção; boletins de medição; quantidade informada; % faturado.',
  'Fábrica: estações Corte, Furação, Montagem e ponteamento, Solda, Pintura (= fabricado), Expedição (= expedido). Canteiro: Recebimento, Pré-montagem, Içamento, Fixação/torqueamento, Liberação (= montado). Meta 17,5 HH/t fábrica e 26 HH/t campo.',
  'Estoque de aço em kg: entrada exige corrida para aço estrutural; consumo por lote com custo médio do lote; sobra devolve; ajuste com justificativa; estorno é movimento inverso.',
  'Pedido de compra: emitir gera lançamento previsto (vencimento = data + prazo) que passa pelas alçadas; receber pode atualizar o preço do insumo.',
];

const PAPEIS_PERMISSOES: Record<Papel, string> = {
  Administrador: 'tudo, inclusive usuários e parâmetros',
  Diretoria: 'aprovar (etapa Diretoria), editar obras e ETC, parâmetros, reabrir período, ver bancos e auditoria; não liquida nem concilia',
  Financeiro: 'lançar, liquidar, conciliar, aprovar (etapa Financeiro), fechar período, cadastros, ver bancos',
  'Gestor de obra': 'editar obras e serviços, lançar custos da obra, aprovar (etapa Gestor), comprar, orçar, apontar produção; não vê bancos',
  Engenharia: 'orçar, lista de materiais, ordens e apontamentos, comprar, lançar; não aprova nem vê bancos',
  Compras: 'pedidos de compra, estoque, lançar; não aprova',
  Contabilidade: 'ver bancos, DRE, auditoria, comentar; não lança nem aprova',
  Auditoria: 'somente leitura de bancos e auditoria',
};

const resumoLicao = (l: Licao) => `### ${l.titulo} [id ${l.id}] (tela ${l.rota}, ${l.area})
Objetivo: ${l.objetivo}
Passos: ${l.passos.map((p, i) => `${i + 1}) ${p}`).join(' ')}
${l.obrigatorios.length ? `Exige: ${l.obrigatorios.join('; ')}.` : ''}
${l.regras.length ? `Regras: ${l.regras.join(' ')}` : ''}
${l.erros.length ? `Erros comuns: ${l.erros.join(' ')}` : ''}`;

/** Prompt de sistema com todo o conhecimento do sistema; estatico (cacheavel) + contexto do usuario. */
export function montarConhecimento(): string {
  return [
    'Você é o assistente do EIFF Control, sistema de gestão da EIFF Engenharia (estruturas metálicas): financeiro, tesouraria, obras, orçamentos, compras, estoque de aço, fábrica e montagem, equipe. Responda em português do Brasil, de forma direta e prática, dizendo em qual tela e com quais passos a pessoa resolve o que perguntou, e quais campos o sistema exige. Quando citar uma tela use a rota entre colchetes, ex.: [#/lancamentos]. Quando uma lição se aplica, cite-a como [[id-da-licao]]. Se a pergunta for sobre um valor ou dado específico que você não tem, diga onde ver no sistema. Não invente regras: se não souber, diga que não consta no manual e sugira falar com o Administrador.',
    '## Regras de negócio', ...REGRAS_GERAIS.map((r) => `- ${r}`),
    '## Papéis e permissões', ...Object.entries(PAPEIS_PERMISSOES).map(([p, d]) => `- ${p}: ${d}`),
    '## Menu (rotas)', '- / Painel executivo · /inbox Minha caixa de entrada · /capacitacao Capacitação · /central Central de obras · /obras Obras e contratos (Obra 360 em /obras/CODIGO) · /orcamentos Orçamentos e composições · /producao Fábrica e montagem · /estoque Estoque de aço · /equipe Equipe e produtividade · /campo Modo campo · /compras Compras e pedidos · /pagar Contas a pagar · /receber Contas a receber · /lancamentos Lançamentos · /aprovacoes Central de aprovações · /posicao Posição diária · /fluxo13 Fluxo 13 semanas · /fluxo24 Fluxo 24 meses · /conciliacao Bancos e conciliação · /dividas Dívidas · /dre DRE gerencial · /checks Checks e fechamento · /cadastros Cadastros e parâmetros · /auditoria Auditoria',
    '## Setores', ...SETORES.map((s) => `### ${s.titulo}\n${s.introducao.join(' ')}\nConceitos: ${s.conceitos.map((c) => `${c.termo}: ${c.definicao}`).join(' | ')}\nFAQ: ${s.faq.map((f) => `P: ${f.pergunta} R: ${f.resposta}`).join(' | ')}`),
    '## Lições', ...LICOES.map(resumoLicao),
    '## Trilhas por papel', ...Object.entries(TRILHAS).map(([p, ids]) => `- ${p}: ${ids.join(', ')}`),
    '## Processos', ...PROCESSOS.map((p) => `### ${p.titulo}\n${p.objetivo}\n${p.etapas.map((e, i) => `${i + 1}. ${e.papel}: ${e.titulo} — ${e.descricao}`).join('\n')}`),
    '## Rotinas', ...Object.entries(ROTINAS).map(([p, r]) => `- ${p}: dia: ${r.diaria.map((x) => x.texto).join('; ') || '—'} | semana: ${r.semanal.map((x) => x.texto).join('; ') || '—'} | mês: ${r.mensal.map((x) => x.texto).join('; ') || '—'}`),
  ].join('\n');
}

export function montarContexto(c: ContextoAssistente): string {
  return [`## Quem pergunta`, `Nome: ${c.nome}. Papel: ${c.papel} (${PAPEIS_PERMISSOES[c.papel]}).`, c.tela ? `Tela atual: ${c.tela}.` : '', c.obra ? `Obra em foco: ${c.obra}.` : '', c.dataBase ? `Data-base do sistema: ${c.dataBase}.` : '', c.resumo ? `Situação atual: ${c.resumo}` : ''].filter(Boolean).join('\n');
}

// ---------------------------------------------------------------------------
// Busca local (sem IA): pontua licoes pelas palavras da pergunta
// ---------------------------------------------------------------------------
const normalizar = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const PARADAS = new Set(['como', 'para', 'que', 'uma', 'um', 'de', 'do', 'da', 'dos', 'das', 'o', 'a', 'os', 'as', 'e', 'ou', 'no', 'na', 'nos', 'nas', 'em', 'por', 'com', 'sem', 'ser', 'fazer', 'faco', 'faço', 'devo', 'posso', 'preciso', 'onde', 'qual', 'quais', 'quando', 'meu', 'minha', 'esta', 'este', 'isso', 'sistema', 'tela']);
const SINONIMOS: Record<string, string[]> = { despesa: ['lancamento', 'saida', 'pagar'], pagamento: ['liquidar', 'liquidacao', 'pagar'], receita: ['receber', 'entrada', 'faturamento'], extrato: ['ofx', 'conciliar', 'conciliacao', 'banco'], nota: ['nf', 'documento', 'evidencia'], aprovar: ['aprovacao', 'alcada'], peso: ['kg', 'quilos', 'materiais'], corte: ['consumo', 'estoque', 'lote'], corrida: ['estoque', 'rastreabilidade', 'certificado'], funcionario: ['colaborador', 'equipe'], horas: ['apontamento', 'estacao', 'produtividade'], carga: ['romaneio', 'expedicao'], fechar: ['fechamento', 'periodo', 'checks'], pedido: ['compra', 'compras', 'fornecedor'], proposta: ['orcamento', 'bdi', 'composicao'], medir: ['medicao', 'boletim', 'avanco'] };

export function buscarLocal(pergunta: string, papel?: Papel, max = 3): { licoes: Licao[]; texto: string } {
  const termos = normalizar(pergunta).split(/[^a-z0-9]+/).filter((t) => t.length > 2 && !PARADAS.has(t));
  const expand = new Set(termos);
  for (const t of termos) for (const s of SINONIMOS[t] ?? []) expand.add(s);
  const trilha = papel ? new Set(TRILHAS[papel]) : null;
  const pont = LICOES.map((l) => {
    const titulo = normalizar(l.titulo); const corpo = normalizar([l.objetivo, ...l.passos, ...l.regras, ...l.erros, l.area].join(' '));
    let p = 0;
    for (const t of expand) { if (titulo.includes(t)) p += 5; const n = corpo.split(t).length - 1; p += Math.min(n, 4); }
    if (trilha?.has(l.id)) p += 1;
    return { l, p };
  }).filter((x) => x.p > 0).sort((a, b) => b.p - a.p).slice(0, max);
  const licoes = pont.map((x) => x.l);
  if (!licoes.length) return { licoes, texto: 'Não encontrei uma lição sobre isso. Veja a aba Processos em Capacitação [#/capacitacao] ou pergunte ao Administrador.' };
  const l = licoes[0];
  const texto = [`**${l.titulo}** (tela [${l.rota}])`, l.objetivo, '', ...l.passos.map((p, i) => `${i + 1}. ${p}`), l.obrigatorios.length ? `\nO sistema exige: ${l.obrigatorios.join(' · ')}.` : '', l.regras.length ? `\nRegras: ${l.regras.join(' ')}` : '', licoes.length > 1 ? `\nVeja também: ${licoes.slice(1).map((x) => `[[${x.id}]]`).join(', ')}` : ''].join('\n');
  return { licoes, texto };
}

/** Sugestoes iniciais por papel. */
export function sugestoesPara(papel: Papel): string[] {
  const base = ['O que devo fazer hoje?', 'Como corrijo um lançamento errado?'];
  const por: Partial<Record<Papel, string[]>> = {
    Financeiro: ['Como importar o extrato OFX?', 'Paguei valor diferente do título, e agora?', 'Como fechar o mês?'],
    'Gestor de obra': ['Como medir o avanço de um serviço?', 'Como apontar a produção da fábrica?', 'Por que a margem da obra está em 100%?'],
    Engenharia: ['Como contratar um orçamento?', 'Como reimportar a lista de materiais?', 'Onde ajusto o índice de HH/t?'],
    Compras: ['Como emitir um pedido de compra?', 'Como dar entrada no aço com a corrida?', 'O que é faturamento direto?'],
    Diretoria: ['O que o painel executivo mostra?', 'Como aprovar uma solicitação?', 'Como reabrir um período fechado?'],
    Contabilidade: ['Por que o caixa e a DRE não batem?', 'Onde vejo a auditoria de um estorno?'],
    Auditoria: ['Onde vejo quem alterou um lançamento?', 'O que é conciliação completa?'],
    Administrador: ['Como cadastrar um usuário e suas obras?', 'Como mudar a alçada do gestor?'],
  };
  return [...base, ...(por[papel] ?? [])];
}
