// E-book por setor: capitulos com introducao, conceitos, licoes (do modulo de capacitacao), processos, rotinas e perguntas
// frequentes. Gera HTML autocontido para leitura e impressao em PDF (A4). Tambem alimenta o assistente.

import { LICOES, PROCESSOS, ROTINAS, type AreaLicao, type Licao, type Processo, type Rotina } from './capacitacao';
import type { Papel } from './types';

export interface Setor {
  id: string;
  titulo: string;
  subtitulo: string;
  papeis: Papel[]; // rotinas incluidas
  areas: AreaLicao[]; // licoes incluidas
  processos: string[]; // ids
  introducao: string[]; // paragrafos
  conceitos: { termo: string; definicao: string }[];
  faq: { pergunta: string; resposta: string }[];
}

export const SETORES: Setor[] = [
  {
    id: 'obras', titulo: 'Obras e contratos', subtitulo: 'Gestão do contrato, serviços, medições e avanço físico', papeis: ['Gestor de obra'], areas: ['Base', 'Obras'], processos: ['proc-medicao-recebimento', 'proc-projeto-montagem'],
    introducao: [
      'A obra é a unidade de resultado da EIFF. Tudo o que a empresa compra, fabrica, monta, fatura e paga se liga a uma obra e, dentro dela, a um serviço do cronograma físico-financeiro. Por isso o gestor de obra é o dono da Obra 360: é ali que receita, custo previsto, comprometido, custo final estimado e margem se encontram.',
      'O contrato define a receita e a forma de faturar. Na Smart Fit, por exemplo, 65% do contrato global é pago pelo cliente direto aos fornecedores: esses valores não passam pelo caixa da EIFF, mas as compras feitas nessa modalidade abatem o saldo do contrato e precisam ser controladas. O sistema faz essa separação sozinho quando o lançamento ou o pedido é marcado como faturamento direto.',
      'O avanço físico é medido em quilos sempre que houver lista de materiais: fabricado e montado sobre o peso total. Serviços sem lista avançam por ordens de produção, por boletins de medição ou pela quantidade executada. Esse avanço alimenta a curva S, o painel executivo e a comparação entre físico e financeiro que mostra se a obra está "queimando" caixa à frente da execução.',
      'A rotina do gestor tem três marcos: o dia (diário de obra e apontamentos fechados), a semana (boletins, demandas e revisão do comprometido) e o mês (eventos de medição enviados à fiscalização e revisão da estimativa a concluir).',
    ],
    conceitos: [
      { termo: 'Receita da obra', definicao: 'Valor do contrato que pertence à EIFF, líquido do que o cliente fatura direto.' },
      { termo: 'Custo previsto', definicao: 'Custo orçado próprio; senão, custo direto do orçamento executivo contratado; senão, receita × (1 − margem alvo).' },
      { termo: 'Comprometido', definicao: 'Soma dos lançamentos previstos e realizados da obra, inclusive pedidos emitidos e compras com faturamento direto.' },
      { termo: 'Orçamento disponível', definicao: 'Custo previsto menos comprometido. Negativo significa que a obra já comprometeu mais do que o orçado.' },
      { termo: 'ETC e EAC', definicao: 'ETC é a estimativa do que falta gastar; EAC (custo final estimado) = pago + comprometido em aberto + ETC não comprometido.' },
      { termo: 'Margem projetada', definicao: 'Receita − EAC, em valor e em percentual da receita.' },
      { termo: 'Evento de medição', definicao: 'Marco do contrato com critério, documentos exigidos, valor bruto, parcela direta, parcela da construtora e retenção.' },
      { termo: 'Boletim de medição', definicao: 'Registro incremental da quantidade executada de um serviço, com data, descrição e evidência.' },
      { termo: 'Peso da fabricação', definicao: 'Parcela do avanço da estrutura atribuída à fábrica (padrão 60%); o restante é montagem.' },
    ],
    faq: [
      { pergunta: 'A margem da obra aparece 100%. Está errado?', resposta: 'Não há custo previsto nem ETC informados. Contrate o orçamento executivo ou informe o custo orçado dos serviços e a estimativa a concluir.' },
      { pergunta: 'Lancei um custo e ele não aparece no serviço.', resposta: 'O lançamento foi salvo sem serviço. Edite e informe obra e serviço; o custo passa a compor o comprometido do serviço.' },
      { pergunta: 'Posso medir um serviço de estrutura metálica pelo boletim?', resposta: 'Se o serviço tem lista de materiais ou ordens, o avanço é automático e o boletim é ignorado. Use o boletim só em serviços sem lista.' },
      { pergunta: 'O que fazer quando o cliente aprova um evento?', resposta: 'Marque o evento como Aprovado na aba Medições e avise o Financeiro: ele emite a nota e lança a receita a receber vinculada à obra e ao serviço.' },
    ],
  },
  {
    id: 'orcamento', titulo: 'Orçamento e engenharia', subtitulo: 'Catálogo, composições, orçamento executivo e lista de materiais', papeis: ['Engenharia'], areas: ['Base', 'Engenharia'], processos: ['proc-orcamento-contrato'],
    introducao: [
      'O orçamento executivo é a espinha dorsal do controle: dele saem o custo previsto de cada serviço, a curva ABC que orienta as compras e o preço de venda com BDI. O sistema usa a base pública SINAPI (Caixa) como referência e composições próprias da EIFF para o que a SINAPI não cobre: estrutura metálica por quilo, pinos, chumbadores, isopainel, transporte e subempreitadas.',
      'Cada composição é uma receita: coeficientes de insumos ou de outras composições. O custo unitário é a soma de coeficiente × preço, calculada de forma recursiva. As composições próprias de estrutura (EIFF-FAB-KG, EIFF-MON-KG) carregam índices de horas-homem por tonelada que hoje são estimativas e devem ser substituídos pela produtividade real apontada na fábrica e no canteiro.',
      'Contratar um orçamento congela seus itens, grava o custo orçado da obra e gera ou atualiza os serviços do contrato. A partir daí o orçamento vira a régua contra a qual compras e custos são comparados.',
      'A engenharia também entrega a lista de materiais em quilos, importada do Tekla ou SolidWorks, que dirige a fabricação, a expedição, a montagem e o avanço físico.',
    ],
    conceitos: [
      { termo: 'Insumo', definicao: 'Material, mão de obra, equipamento ou serviço com unidade, preço, data e fonte do preço.' },
      { termo: 'Composição', definicao: 'Conjunto de coeficientes de insumos e composições que produz uma unidade de serviço.' },
      { termo: 'BDI', definicao: 'Percentual sobre o custo direto que cobre despesas indiretas, impostos e lucro. Preço de venda = custo × (1 + BDI).' },
      { termo: 'Curva ABC', definicao: 'Classificação por acumulado de custo: A até 80%, B até 95%, C o restante.' },
      { termo: 'Preço de venda informado', definicao: 'Em propostas fechadas, o preço do item vem do contrato e a margem é calculada contra o custo das composições.' },
      { termo: 'Conjunto (marca)', definicao: 'Peça ou subconjunto de montagem da lista de materiais, com quantidade, peso unitário e perfil.' },
    ],
    faq: [
      { pergunta: 'Posso importar a TCPO?', resposta: 'Só o que a EIFF exportar da sua licença. A base embutida é a SINAPI, que é pública.' },
      { pergunta: 'Como atualizo o preço do aço?', resposta: 'Na aba Insumos, com data e fonte. Ou automaticamente ao receber um pedido de compra com "atualizar preço" marcado.' },
      { pergunta: 'A lista de materiais mudou de revisão.', resposta: 'Reimporte: marcas existentes são atualizadas, novas são criadas. Conjuntos já fabricados não são excluídos.' },
    ],
  },
  {
    id: 'fabrica', titulo: 'Fábrica e montagem', subtitulo: 'Apontamento por estação, romaneio e produtividade', papeis: ['Gestor de obra', 'Engenharia'], areas: ['Base', 'Fábrica e montagem'], processos: ['proc-projeto-montagem', 'proc-equipe'],
    introducao: [
      'A fábrica trabalha por estações: Corte, Furação, Montagem e ponteamento, Solda, Pintura e Expedição. O canteiro, por Recebimento, Pré-montagem, Içamento, Fixação e Liberação. Cada dia, cada estação aponta o que processou em quilos, peças e conjuntos, e as horas de cada colaborador que trabalhou nela.',
      'Três estações concluem marcos da lista de materiais: Pintura marca o conjunto como fabricado, Expedição (ou o romaneio) como expedido e Liberação como montado. É assim que o avanço físico da estrutura anda sozinho na Obra 360, sem ninguém digitar percentuais.',
      'A produtividade é lida em quilos por hora-homem, por estação, por colaborador e por dia, contra a meta das composições: 17,5 HH por tonelada na fábrica e 26 HH por tonelada em campo. O custo de mão de obra real sai das horas apontadas vezes o custo/hora do colaborador.',
      'O romaneio documenta cada carga: transportadora, placa, motorista, conjuntos e peso. É o elo entre fábrica e canteiro e a base para conferir o recebimento em obra.',
    ],
    conceitos: [
      { termo: 'Estação', definicao: 'Posto de trabalho da linha; as etapas das ordens de fabricação têm os mesmos nomes.' },
      { termo: 'Apontamento de estação', definicao: 'Registro diário e imutável de kg, peças, conjuntos e horas por colaborador em uma estação.' },
      { termo: 'kg/HH', definicao: 'Quilos processados divididos pelas horas-homem apontadas.' },
      { termo: 'Romaneio', definicao: 'Documento de expedição de uma carga, com conjuntos e peso; emitir marca os conjuntos como expedidos.' },
      { termo: 'Ordem de produção', definicao: 'Lote de fabricação ou montagem em kg ou t, cujas etapas acumulam as quantidades apontadas.' },
    ],
    faq: [
      { pergunta: 'Apontei a estação errada.', resposta: 'Exclua o apontamento com motivo e aponte de novo. A exclusão desfaz os marcos nos conjuntos; a ordem é corrigida pelo novo apontamento.' },
      { pergunta: 'O colaborador não aparece na lista de horas.', resposta: 'O cadastro dele precisa estar ativo e com local Fábrica (linha de fabricação) ou Obra (montagem).' },
      { pergunta: 'Sem lista de materiais dá para apontar?', resposta: 'Sim, pelo peso em kg. Mas o avanço por conjunto e a rastreabilidade só funcionam com a lista importada.' },
    ],
  },
  {
    id: 'estoque', titulo: 'Estoque de aço', subtitulo: 'Entradas com corrida, consumo por lote, sobras e rastreabilidade', papeis: ['Compras'], areas: ['Base', 'Estoque'], processos: ['proc-compra-pagamento'],
    introducao: [
      'Todo aço estrutural entra no estoque com o número da corrida e o certificado de qualidade. Isso permite responder, para qualquer conjunto montado na obra, de qual corrida, usina e nota fiscal veio o material, exigência de documentação técnica e de tratamento de não conformidades.',
      'O estoque é medido em quilos e organizado por item (perfil, chapa, tubo) e por lote (corrida). O corte consome de um lote específico, citando a ordem e os conjuntos cortados; a sobra devolve o retalho ao mesmo lote. O custo por quilo do consumo é o custo médio do lote, e a soma de consumos menos sobras por serviço é o custo real de material que a Obra 360 mostra.',
      'Movimentos nunca são apagados: um erro é corrigido por estorno, que cria o movimento inverso e fica na auditoria. Ajustes de inventário exigem justificativa.',
    ],
    conceitos: [
      { termo: 'Corrida (heat)', definicao: 'Número da corrida de aço da usina, impresso no certificado; identifica o lote.' },
      { termo: 'Lote', definicao: 'Item + corrida. Tem saldo por local (fábrica ou obra) e custo médio próprio.' },
      { termo: 'Custo médio móvel', definicao: 'A cada entrada, novo custo = (saldo × custo atual + entrada × preço) ÷ (saldo + entrada).' },
      { termo: 'Sobra', definicao: 'Retalho que volta ao estoque, abatendo o consumo da obra.' },
      { termo: 'Estorno', definicao: 'Movimento inverso de outro; entrada já consumida não pode ser estornada.' },
    ],
    faq: [
      { pergunta: 'Não tenho a corrida de um consumível.', resposta: 'Consumíveis, telhas e "outros" não exigem corrida. Só aço estrutural (perfis, chapas, tubos, barras, cantoneiras).' },
      { pergunta: 'O saldo do lote ficou negativo?', resposta: 'O sistema não permite: o consumo é recusado quando excede o saldo do lote no local escolhido. Confira o local (fábrica ou obra).' },
    ],
  },
  {
    id: 'equipe', titulo: 'Equipe e produtividade', subtitulo: 'Cadastro, apontamento diário, tarefas e modo campo', papeis: ['Gestor de obra'], areas: ['Base', 'Equipe'], processos: ['proc-equipe'],
    introducao: [
      'A equipe é a origem do custo de mão de obra e da produtividade. Cada colaborador tem função, vínculo, equipe, local de trabalho, custo/hora com encargos e jornada. O apontamento diário registra presença, horas, horas extras, produção e ocorrências, e pode ser feito do celular no modo campo.',
      'Fechar o dia é um ato de controle: depois de fechado, só gestor, financeiro, diretoria ou administrador alteram. Horas apontadas vezes custo/hora viram o custo de mão de obra do dia por obra, que substitui os índices estimados das composições.',
      'As tarefas no quadro kanban organizam o que não é rotina: pendências de projeto, compras urgentes, correções. Tarefa sem prazo nunca aparece como atrasada; use prazos.',
    ],
    conceitos: [
      { termo: 'Custo/hora', definicao: '(Salário + encargos) ÷ horas mensais; é o que o sistema usa para custear horas apontadas.' },
      { termo: 'Diário do dia', definicao: 'Apontamento por local e data com a equipe pré-preenchida.' },
      { termo: 'Modo campo', definicao: 'Versão do sistema para celular com Dia, Tarefas, Checklist e Produção.' },
    ],
    faq: [
      { pergunta: 'Alguém saiu da empresa.', resposta: 'Desative o colaborador; não exclua, para preservar o histórico de horas e custo.' },
      { pergunta: 'Quem pode fechar o dia?', resposta: 'Quem aponta; a alteração depois do fechamento é restrita a gestor, financeiro, diretoria e administrador.' },
    ],
  },
  {
    id: 'compras', titulo: 'Compras e suprimentos', subtitulo: 'Pedidos, recebimento, preços e orçado × comprado', papeis: ['Compras'], areas: ['Base', 'Compras', 'Estoque'], processos: ['proc-compra-pagamento'],
    introducao: [
      'Compras é a porta de entrada do custo. Todo pedido nasce ligado a uma obra e a um serviço, com itens vinculados ao catálogo de insumos para que o preço cotado seja comparado ao orçado. Emitir o pedido gera o compromisso financeiro (lançamento previsto) que passa pelas alçadas: o comprometido da obra só cresce depois da aprovação.',
      'Receber o material fecha o ciclo físico e pode levar o preço pago ao catálogo, atualizando o orçamento executivo com preços reais. Para aço, o recebimento continua no Estoque, com a corrida do certificado.',
      'O comparativo orçado × comprado mostra, por insumo, quanto já foi comprado contra a explosão do orçamento contratado, o preço médio contra o orçado e o que foi comprado fora do orçamento.',
    ],
    conceitos: [
      { termo: 'Pedido de compra', definicao: 'Rascunho editável até emitir; emitido gera lançamento previsto e congela os itens.' },
      { termo: 'Faturamento direto', definicao: 'O cliente paga o fornecedor; abate o contrato global e não passa pelo caixa da EIFF.' },
      { termo: 'Explosão de insumos', definicao: 'Quantidades de insumos calculadas a partir das composições do orçamento contratado.' },
    ],
    faq: [
      { pergunta: 'O pedido emitido não aparece no comprometido.', resposta: 'Está aguardando aprovação de alçada. Acompanhe em Central de aprovações › Minhas solicitações.' },
      { pergunta: 'Preciso cancelar um pedido já pago.', resposta: 'Não é possível cancelar com o lançamento realizado; o Financeiro estorna a liquidação primeiro.' },
    ],
  },
  {
    id: 'financeiro', titulo: 'Financeiro e tesouraria', subtitulo: 'Lançamentos, alçadas, liquidação, conciliação, caixa e fechamento', papeis: ['Financeiro'], areas: ['Base', 'Financeiro'], processos: ['proc-compra-pagamento', 'proc-medicao-recebimento', 'proc-fechamento'],
    introducao: [
      'O financeiro opera a base única de lançamentos: cada compromisso tem tipo, categoria, competência, vencimento, obra e serviço. O sinal vem do tipo, o valor é sempre positivo. O caixa usa a data de realização ou o vencimento; a DRE usa a competência.',
      'A governança está nas alçadas: saídas acima do limite do gestor, fora do orçamento da obra ou que levem o caixa abaixo da reserva mínima passam por Gestor, Financeiro e Diretoria. O solicitante nunca decide a própria solicitação. Alterações relevantes reabrem a aprovação.',
      'O movimento bancário é fato. O extrato OFX entra sem repetir transações (identificador do banco), as sugestões de conciliação aparecem por pontuação e o que não estava previsto vira lançamento realizado, liquidado e conciliado em um clique. Liquidar exige evidência; divergências exigem justificativa.',
      'O mês fecha com os checks verdes ou divergências justificadas. Período fechado não aceita alteração retroativa; só a Diretoria reabre, com motivo.',
    ],
    conceitos: [
      { termo: 'Competência', definicao: 'Mês a que a receita ou despesa pertence; base da DRE.' },
      { termo: 'Alçada', definicao: 'Limites por papel que definem quem aprova uma saída (parâmetros em Cadastros).' },
      { termo: 'Liquidação', definicao: 'Registro do pagamento ou recebimento com data, valor, conta e evidência; pode ser parcial.' },
      { termo: 'Conciliação', definicao: 'Casamento entre transação do extrato e título do sistema.' },
      { termo: 'Reserva mínima', definicao: 'Saldo de caixa abaixo do qual novas saídas exigem aprovação e o painel alerta.' },
      { termo: 'Aging', definicao: 'Títulos vencidos por faixa de dias, a pagar e a receber.' },
    ],
    faq: [
      { pergunta: 'Importei o OFX duas vezes.', resposta: 'Nada se repete: as transações já importadas são descartadas pelo identificador do banco e o sistema informa quantas eram duplicadas.' },
      { pergunta: 'Paguei um valor diferente do título.', resposta: 'Liquide pelo valor pago e registre a justificativa da divergência; o saldo restante continua em aberto ou é baixado conforme o caso.' },
      { pergunta: 'Preciso alterar um lançamento de mês fechado.', resposta: 'Peça à Diretoria a reabertura do período com motivo, faça a alteração e feche de novo.' },
    ],
  },
  {
    id: 'direcao', titulo: 'Direção e controladoria', subtitulo: 'Painel, fluxos, DRE, auditoria e parâmetros', papeis: ['Diretoria', 'Contabilidade', 'Auditoria', 'Administrador'], areas: ['Base', 'Direção e controladoria', 'Administração'], processos: ['proc-fechamento', 'proc-orcamento-contrato'],
    introducao: [
      'A direção lê o sistema em três camadas: o painel executivo (caixa de hoje, menor saldo das 13 semanas, vencidos, margem das obras, alertas), a Obra 360 de cada contrato (EAC e margem projetada) e a DRE por competência. O fluxo de 24 meses e os cenários projetam o caixa sem alterar a base.',
      'A controladoria garante que os números sejam confiáveis: categorias e competências corretas, conciliação completa, fechamento mensal e trilha de auditoria de tudo o que foi alterado, com quem, quando, antes, depois e motivo.',
      'Os parâmetros (alçadas, desvio de orçamento permitido, reserva mínima, SLA de aprovação) são decisões da direção e mudam o comportamento do sistema para toda a equipe. Papéis e obras dos usuários definem o que cada um vê e pode fazer.',
    ],
    conceitos: [
      { termo: 'Painel executivo', definicao: 'Visão diária de caixa, obras, aprovações e alertas, com atalhos para a origem.' },
      { termo: 'Cenário', definicao: 'Conjunto de premissas para simular o fluxo sem alterar os lançamentos.' },
      { termo: 'Segregação de funções', definicao: 'Quem pede não aprova; quem lança não liquida sem evidência; quem fecha não reabre.' },
      { termo: 'Auditoria', definicao: 'Registro imutável de cada ação no app e no banco.' },
    ],
    faq: [
      { pergunta: 'O caixa caiu mas a DRE mostra lucro.', resposta: 'Caixa e competência são regimes diferentes: recebimentos a prazo, retenções e pagamentos antecipados explicam a diferença. Compare o fluxo de 13 semanas com a DRE do mês.' },
      { pergunta: 'Como mudar o limite de aprovação do gestor?', resposta: 'Cadastros › Parâmetros e alçadas. Solicitações novas já seguem o novo limite.' },
    ],
  },
];

export const setor = (id: string) => SETORES.find((s) => s.id === id);
export const licoesDoSetor = (s: Setor): Licao[] => LICOES.filter((l) => s.areas.includes(l.area));
export const processosDoSetor = (s: Setor): Processo[] => s.processos.map((id) => PROCESSOS.find((p) => p.id === id)!).filter(Boolean);
export const rotinasDoSetor = (s: Setor): { papel: Papel; rotina: Rotina }[] => s.papeis.map((papel) => ({ papel, rotina: ROTINAS[papel] }));

// ---------------------------------------------------------------------------
// HTML autocontido (leitura no navegador e impressao em PDF)
// ---------------------------------------------------------------------------
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const lista = (itens: string[], tag: 'ul' | 'ol' = 'ul') => (itens.length ? `<${tag}>${itens.map((i) => `<li>${esc(i)}</li>`).join('')}</${tag}>` : '');

const CSS = `
:root{color-scheme:light}
body{margin:0;font-family:Manrope,"Segoe UI",system-ui,sans-serif;color:#151515;background:#f4f2ee;line-height:1.5}
.page{max-width:860px;margin:0 auto;padding:40px 48px 80px;background:#fff}
.capa{min-height:90vh;display:flex;flex-direction:column;justify-content:space-between;border-bottom:6px solid #c7431b;margin-bottom:40px;padding-bottom:30px}
.marca{display:flex;align-items:center;gap:12px;font-weight:800;letter-spacing:.06em;font-size:22px}
.marca i{display:inline-block;width:8px;height:26px;background:#c7431b;border-radius:2px}
.capa h1{font-size:40px;line-height:1.1;margin:0 0 8px}
.capa .sub{font-size:18px;color:#555}
.capa .meta{color:#777;font-size:13px}
h2{font-size:24px;margin:44px 0 10px;padding-top:14px;border-top:2px solid #e6e2da;color:#151515}
h3{font-size:15px;margin:22px 0 6px;text-transform:uppercase;letter-spacing:.08em;color:#c7431b}
h4{font-size:15px;margin:18px 0 6px}
p{margin:6px 0 10px}
ul,ol{margin:4px 0 12px;padding-left:22px}
li{margin:4px 0}
.cap{background:#faf8f4;border:1px solid #e6e2da;border-radius:10px;padding:16px 20px;margin:14px 0}
.tag{display:inline-block;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#c7431b;background:#fbeae4;border-radius:6px;padding:2px 8px;margin-right:6px}
.tag.cinza{color:#555;background:#eeece7}
.exige{color:#7a4a00;background:#fff4dd;border-radius:6px;padding:8px 12px;font-size:14px}
.regras li::marker{color:#c7431b}
table{border-collapse:collapse;width:100%;font-size:14px;margin:8px 0 14px}
th,td{border-bottom:1px solid #e6e2da;text-align:left;padding:6px 8px;vertical-align:top}
th{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#666}
.sumario li{margin:2px 0}
.rodape{margin-top:60px;color:#888;font-size:12px;border-top:1px solid #e6e2da;padding-top:10px}
.faq dt{font-weight:700;margin-top:10px}
.faq dd{margin:2px 0 0 0}
.quebra{page-break-before:always}
@media print{body{background:#fff}.page{padding:0;max-width:none}.capa{min-height:95vh}h2{page-break-after:avoid}.cap,tr{page-break-inside:avoid}}
`;

function htmlLicao(l: Licao, n: string): string {
  return `<div class="cap"><h4>${esc(n)} ${esc(l.titulo)} <span class="tag cinza">${l.minutos} min</span><span class="tag cinza">tela ${esc(l.rota)}</span></h4>
<p><b>Objetivo.</b> ${esc(l.objetivo)}</p>
<h3>Como fazer</h3>${lista(l.passos, 'ol')}
${l.obrigatorios.length ? `<div class="exige"><b>O sistema exige:</b> ${l.obrigatorios.map(esc).join(' · ')}.</div>` : ''}
${l.regras.length ? `<h3>Regras automáticas</h3><ul class="regras">${l.regras.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
${l.erros.length ? `<h3>Erros comuns</h3>${lista(l.erros)}` : ''}
<h3>Para conferir o entendimento</h3><ol>${l.verificacao.map((v) => `<li>${esc(v.pergunta)}<br><small>Resposta: ${esc(v.opcoes[v.correta])}</small></li>`).join('')}</ol></div>`;
}

export function gerarHtmlSetor(s: Setor, opts: { empresa?: string; data?: string } = {}): string {
  const licoes = licoesDoSetor(s);
  const procs = processosDoSetor(s);
  const rots = rotinasDoSetor(s);
  const data = opts.data ?? new Date().toISOString().slice(0, 10);
  const areas = [...new Set(licoes.map((l) => l.area))];
  const sumario = ['Introdução', 'Conceitos', ...areas.map((a) => `Lições · ${a}`), 'Processos', 'Rotinas', 'Perguntas frequentes'];
  let n = 0;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(s.titulo)} · Manual EIFF Control</title><style>${CSS}</style></head><body><div class="page">
<div class="capa"><div class="marca"><i></i><i style="height:18px"></i><i style="height:32px"></i> EIFF CONTROL</div>
<div><div class="tag">Manual de operação</div><h1>${esc(s.titulo)}</h1><div class="sub">${esc(s.subtitulo)}</div></div>
<div class="meta">${esc(opts.empresa ?? 'EIFF Engenharia')} · edição de ${data.split('-').reverse().join('/')} · ${licoes.length} lições · ${procs.length} processos · papéis: ${s.papeis.join(', ')}</div></div>
<h2>Sumário</h2><ol class="sumario">${sumario.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>
<h2 class="quebra">1. Introdução</h2>${s.introducao.map((p) => `<p>${esc(p)}</p>`).join('')}
<h2>2. Conceitos</h2><table><tr><th>Termo</th><th>Definição</th></tr>${s.conceitos.map((c) => `<tr><td><b>${esc(c.termo)}</b></td><td>${esc(c.definicao)}</td></tr>`).join('')}</table>
${areas.map((a, i) => `<h2 class="quebra">${i + 3}. Lições · ${esc(a)}</h2>${licoes.filter((l) => l.area === a).map((l) => htmlLicao(l, `${i + 3}.${++n}`)).join('')}`).join('')}
<h2 class="quebra">${areas.length + 3}. Processos</h2>${procs.map((p) => `<div class="cap"><h4>${esc(p.titulo)}</h4><p>${esc(p.objetivo)}</p><table><tr><th>#</th><th>Responsável</th><th>Etapa</th><th>O que acontece</th></tr>${p.etapas.map((e, i) => `<tr><td>${i + 1}</td><td>${esc(e.papel)}</td><td><b>${esc(e.titulo)}</b></td><td>${esc(e.descricao)}</td></tr>`).join('')}</table></div>`).join('')}
<h2>${areas.length + 4}. Rotinas</h2>${rots.map(({ papel, rotina }) => `<div class="cap"><h4>${esc(papel)}</h4><h3>Todo dia</h3>${lista(rotina.diaria.map((x) => x.texto)) || '<p>—</p>'}<h3>Toda semana</h3>${lista(rotina.semanal.map((x) => x.texto)) || '<p>—</p>'}<h3>Todo mês</h3>${lista(rotina.mensal.map((x) => x.texto)) || '<p>—</p>'}</div>`).join('')}
<h2>${areas.length + 5}. Perguntas frequentes</h2><dl class="faq">${s.faq.map((f) => `<dt>${esc(f.pergunta)}</dt><dd>${esc(f.resposta)}</dd>`).join('')}</dl>
<div class="rodape">EIFF Control · manual gerado a partir das regras do sistema em ${data.split('-').reverse().join('/')}. Regras e telas podem evoluir: a versão viva está em Capacitação no próprio sistema.</div>
</div></body></html>`;
}

/** E-book completo: todos os setores em um unico documento. */
export function gerarHtmlCompleto(opts: { empresa?: string; data?: string } = {}): string {
  const partes = SETORES.map((s) => gerarHtmlSetor(s, opts));
  const corpo = partes.map((h) => h.slice(h.indexOf('<div class="page">') + '<div class="page">'.length, h.lastIndexOf('</div></body>'))).join('<div class="quebra"></div>');
  const data = opts.data ?? new Date().toISOString().slice(0, 10);
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Manual completo · EIFF Control</title><style>${CSS}</style></head><body><div class="page">
<div class="capa"><div class="marca"><i></i><i style="height:18px"></i><i style="height:32px"></i> EIFF CONTROL</div><div><div class="tag">Manual de operação</div><h1>Manual completo</h1><div class="sub">Todos os setores: ${SETORES.map((s) => s.titulo).join(', ')}</div></div><div class="meta">${esc(opts.empresa ?? 'EIFF Engenharia')} · edição de ${data.split('-').reverse().join('/')}</div></div>
${corpo}</div></body></html>`;
}
