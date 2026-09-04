// Capacitacao: conteudo do modulo de estudo (trilhas por papel, licoes com passos, campos obrigatorios, regras que
// bloqueiam, erros comuns e verificacao), processos ponta a ponta e rotinas diaria/semanal/mensal.
// O conteudo descreve as telas e regras reais do sistema: ao mudar uma regra no store, revisar a licao correspondente.

import type { Papel, Treinamento, Usuario } from './types';

export type AreaLicao = 'Base' | 'Financeiro' | 'Obras' | 'Engenharia' | 'Fábrica e montagem' | 'Estoque' | 'Equipe' | 'Compras' | 'Direção e controladoria' | 'Administração';

export interface Verificacao { pergunta: string; opcoes: string[]; correta: number }

export interface Licao {
  id: string;
  titulo: string;
  area: AreaLicao;
  rota: string; // tela onde a licao acontece
  minutos: number;
  objetivo: string;
  passos: string[]; // como fazer, na ordem
  obrigatorios: string[]; // campos que o sistema exige
  regras: string[]; // o que o sistema bloqueia ou faz sozinho
  erros: string[]; // erros comuns
  verificacao: Verificacao[];
}

export const PAPEIS: Papel[] = ['Administrador', 'Diretoria', 'Financeiro', 'Gestor de obra', 'Engenharia', 'Compras', 'Contabilidade', 'Auditoria'];

export const LICOES: Licao[] = [
  // ---------------------------------------------------------------------- Base
  {
    id: 'base-navegacao', titulo: 'Conhecendo o EIFF Control', area: 'Base', rota: '/', minutos: 8,
    objetivo: 'Entender como o sistema está organizado, o que cada grupo do menu faz e onde encontrar ajuda.',
    passos: [
      'O menu lateral segue a operação: Obras (contratos, orçamentos, fábrica, estoque, equipe), Financeiro (compras, contas, lançamentos, aprovações), Tesouraria (bancos, fluxos, dívidas), Controladoria (DRE, fechamento) e Administração.',
      'O topo mostra a data-base do sistema, o cenário e o resultado dos controles. A data-base avança sozinha para hoje.',
      'O botão de tema alterna entre escuro e claro; o menu pode ser recolhido para ganhar espaço.',
      'Cada tela abre com um indicador principal em destaque, uma faixa de métricas de apoio e as abas de trabalho. Números aparecem alinhados à direita nas tabelas.',
      'Toda ação fica registrada na Auditoria com quem fez, quando e o valor antes e depois. Nada financeiro é apagado: usa-se cancelamento ou estorno.',
    ],
    obrigatorios: [],
    regras: ['O que você vê depende do seu papel e das obras que lhe foram atribuídas em Cadastros › Usuários.', 'Períodos fechados não aceitam alteração de lançamentos.'],
    erros: ['Procurar "excluir" em um lançamento: o caminho é Cancelar ou Estornar, com motivo.', 'Trabalhar com a data-base errada em um teste: confira o topo da tela.'],
    verificacao: [
      { pergunta: 'Como se corrige um lançamento pago por engano?', opcoes: ['Apagando o lançamento', 'Estornando com motivo, que fica na auditoria', 'Editando o valor para zero'], correta: 1 },
      { pergunta: 'Quem define quais obras um usuário enxerga?', opcoes: ['O próprio usuário, na tela de login', 'O cadastro de usuários, em Administração', 'O gestor da obra, na Obra 360'], correta: 1 },
    ],
  },
  {
    id: 'base-caixa-entrada', titulo: 'Minha caixa de entrada', area: 'Base', rota: '/inbox', minutos: 5,
    objetivo: 'Começar o dia pela lista do que depende de você: aprovações do seu papel e tarefas atribuídas.',
    passos: [
      'Abra Minha caixa de entrada. O contador no menu soma aprovações pendentes na sua alçada e tarefas abertas com você.',
      'Aprovações: abra a solicitação, leia o impacto no caixa antes e depois, e decida em Central de aprovações.',
      'Tarefas: mude o status (Aberta, Em andamento, Bloqueada, Concluída) e registre o que faltou quando bloquear.',
      'Volte à caixa ao longo do dia; ela é a fila de trabalho do sistema.',
    ],
    obrigatorios: [],
    regras: ['Só aparecem aprovações cuja etapa atual é do seu papel e que não foram solicitadas por você.'],
    erros: ['Deixar tarefas vencidas abertas: o contador de atraso aparece em Equipe e produtividade.'],
    verificacao: [{ pergunta: 'O que a caixa de entrada mostra?', opcoes: ['Todos os lançamentos do mês', 'Aprovações na minha alçada e tarefas atribuídas a mim', 'O extrato bancário'], correta: 1 }],
  },
  {
    id: 'base-obra360', titulo: 'Lendo a Obra 360', area: 'Base', rota: '/obras', minutos: 12,
    objetivo: 'Interpretar os indicadores da obra: receita, custo previsto, comprometido, EAC, margem, execução física e faturamento direto.',
    passos: [
      'Em Obras e contratos, abra a obra. O herói mostra a margem projetada e a curva de caixa da obra.',
      'Receita = valor do contrato para a EIFF. Custo previsto vem, nesta ordem, do custo orçado próprio, do orçamento executivo contratado ou de receita × (1 − margem alvo).',
      'Comprometido = lançamentos previstos e realizados da obra. Orçamento disponível = custo previsto − comprometido.',
      'EAC (custo final estimado) = pago + comprometido em aberto + ETC não comprometido. Margem projetada = receita − EAC.',
      'Execução física vem dos serviços: lista de materiais em kg, ordens de produção, boletins de medição, quantidade informada ou percentual faturado, nesta prioridade.',
      'Faturamento direto: compras que o cliente paga ao fornecedor. Entram no comprometido da obra e abatem o saldo do contrato global, mas não passam pelo caixa da EIFF.',
      'Abas: Medições (eventos ao cliente), Serviços (cronograma físico-financeiro e Medir), Materiais (lista em kg), Demandas, Fabricação, Montagem, Financeiro e Timeline. Use Imprimir para o relatório.',
    ],
    obrigatorios: [],
    regras: ['A margem projetada fica 100% enquanto não houver custo previsto nem ETC: informe o orçamento ou a estimativa a concluir.'],
    erros: ['Comparar receita bruta do contrato com o custo da EIFF: 65% da Smart Fit é faturado direto pelo cliente.'],
    verificacao: [
      { pergunta: 'Uma compra com faturamento direto ao cliente…', opcoes: ['Entra no caixa da EIFF como saída', 'Abate o saldo do contrato global e conta no comprometido da obra, sem passar pelo caixa', 'Não aparece em lugar nenhum'], correta: 1 },
      { pergunta: 'Como o EAC é calculado?', opcoes: ['Receita − margem alvo', 'Pago + comprometido em aberto + ETC não comprometido', 'Soma dos orçamentos'], correta: 1 },
    ],
  },

  // ----------------------------------------------------------------- Financeiro
  {
    id: 'fin-lancamento', titulo: 'Lançar uma despesa ou receita', area: 'Financeiro', rota: '/lancamentos', minutos: 15,
    objetivo: 'Registrar um compromisso na base única com todos os campos que o motor precisa para caixa, DRE e obra.',
    passos: [
      'Em Lançamentos, clique em Novo. Escolha o tipo (Entrada ou Saída): o sinal vem do tipo, o valor é sempre positivo.',
      'Informe a categoria do plano de contas, a descrição, o fornecedor ou cliente e o documento.',
      'Datas: competência (mês que a despesa pertence, usada na DRE) e vencimento (usado no caixa). A realização é preenchida na liquidação.',
      'Custos de obra: informe a obra e o serviço. Sem serviço, o custo não entra no acompanhamento físico-financeiro.',
      'Marque "Faturamento direto ao cliente" só em compras de obra que o cliente paga direto ao fornecedor.',
      'Salve. Se a saída exigir alçada, o sistema abre a aprovação sozinho e o lançamento fica em validação.',
    ],
    obrigatorios: ['Tipo', 'Categoria', 'Descrição', 'Valor positivo', 'Competência', 'Vencimento', 'Obra e serviço em custo de obra', 'Conta em recebimentos e pagamentos programados'],
    regras: [
      'Saída acima do limite do gestor de obra, fora do orçamento da obra ou que leve o caixa abaixo da reserva mínima passa por aprovação Gestor → Financeiro → Diretoria.',
      'Alteração relevante (valor, datas, categoria, obra) reabre a aprovação.',
      'Período fechado não aceita inclusão nem alteração.',
      'Faturamento direto só em saídas com obra; fica fora do caixa, do fluxo, do DRE e do aging.',
    ],
    erros: ['Lançar valor negativo para representar saída.', 'Esquecer o serviço em custo de obra: a Obra 360 não vê o custo no serviço.', 'Colocar competência igual ao vencimento em despesas de meses anteriores.'],
    verificacao: [
      { pergunta: 'Qual data a DRE usa?', opcoes: ['Vencimento', 'Competência', 'Realização'], correta: 1 },
      { pergunta: 'O que acontece com uma saída acima do limite do gestor?', opcoes: ['É recusada', 'Abre aprovação Gestor → Financeiro → Diretoria e fica em validação', 'É paga automaticamente'], correta: 1 },
    ],
  },
  {
    id: 'fin-aprovacao', titulo: 'Aprovar, rejeitar ou devolver', area: 'Financeiro', rota: '/aprovacoes', minutos: 8,
    objetivo: 'Decidir uma solicitação vendo o impacto no caixa e respeitando a segregação de funções.',
    passos: [
      'Em Central de aprovações › Pendentes, abra a solicitação. O sistema mostra o caixa antes e depois, o orçamento da obra e a etapa atual.',
      'Aprovar avança para a próxima etapa da alçada; Rejeitar encerra; Devolver manda de volta ao solicitante para ajuste.',
      'Rejeitar e devolver exigem justificativa. Ela fica visível ao solicitante e na auditoria.',
      'Acompanhe as suas em Minhas solicitações e o histórico na aba Histórico.',
    ],
    obrigatorios: ['Justificativa ao rejeitar ou devolver'],
    regras: ['O solicitante nunca decide a própria solicitação (o Administrador é a exceção na fase de validação).', 'Cada etapa é decidida pelo papel dela: Gestor de obra, Financeiro, Diretoria.'],
    erros: ['Aprovar sem olhar o "depois" do caixa: o alerta de reserva mínima aparece ali.'],
    verificacao: [{ pergunta: 'Posso aprovar uma solicitação que eu mesmo criei?', opcoes: ['Sim, se for pequena', 'Não: segregação de funções', 'Só no fim do mês'], correta: 1 }],
  },
  {
    id: 'fin-liquidar', titulo: 'Liquidar um título', area: 'Financeiro', rota: '/pagar', minutos: 10,
    objetivo: 'Registrar o pagamento ou recebimento com evidência, inclusive parcial, e estornar quando necessário.',
    passos: [
      'Em Contas a pagar (ou a receber), localize o título pelo vencimento, fornecedor ou obra.',
      'Clique em Liquidar. Informe a data de realização, o valor pago, a conta financeira e a evidência (número do comprovante, NF, boleto).',
      'Liquidação parcial: informe o valor pago; o saldo continua em aberto com o mesmo vencimento.',
      'Errou? Use Estornar informando o motivo; o título volta a aberto e o estorno fica na auditoria.',
      'Prefira liquidar a partir da transação bancária em Bancos e conciliação: já nasce conciliado.',
    ],
    obrigatorios: ['Data', 'Valor maior que zero', 'Conta', 'Evidência (documento)'],
    regras: ['Só Financeiro e Administrador liquidam.', 'Período fechado bloqueia liquidação e estorno.', 'Divergência entre valor previsto e pago exige justificativa.'],
    erros: ['Liquidar sem evidência "para acertar depois": o sistema recusa.', 'Liquidar na data do vencimento em vez da data real do pagamento: o saldo bancário deixa de bater.'],
    verificacao: [{ pergunta: 'O que a liquidação exige além de data, valor e conta?', opcoes: ['Aprovação da Diretoria', 'Evidência (documento)', 'Nada'], correta: 1 }],
  },
  {
    id: 'fin-receber', titulo: 'Contas a receber e faturamento das medições', area: 'Financeiro', rota: '/receber', minutos: 10,
    objetivo: 'Transformar eventos de medição aprovados em títulos a receber e acompanhar retenções.',
    passos: [
      'Os eventos de medição vivem na Obra 360 › Medições, com valor bruto, parcela faturada direto pelo cliente, parcela da construtora e retenção.',
      'Quando o evento é aprovado pela fiscalização, emita a nota e lance a receita em Contas a receber com competência do mês da medição e vencimento conforme o contrato.',
      'Vincule o lançamento à obra e ao serviço para que a receita realizada apareça no acompanhamento.',
      'Retenção contratual é uma receita futura: lance com o vencimento previsto de liberação.',
      'Acompanhe o aging (vencidos por faixa) na própria tela e no painel executivo.',
    ],
    obrigatorios: ['Obra', 'Serviço', 'Competência', 'Vencimento', 'Documento (NF)'],
    regras: ['Faturamento direto + construtora deve ser igual ao valor bruto do evento.', 'A parte faturada direto pelo cliente não vira título a receber da EIFF.'],
    erros: ['Lançar o valor bruto do evento como receita da EIFF quando 65% é direto do cliente.'],
    verificacao: [{ pergunta: 'A parte do evento faturada direto pelo cliente…', opcoes: ['Vira título a receber da EIFF', 'Não vira título da EIFF; só abate o contrato global', 'Vira despesa'], correta: 1 }],
  },
  {
    id: 'fin-ofx', titulo: 'Importar o extrato OFX e conciliar', area: 'Financeiro', rota: '/conciliacao', minutos: 15,
    objetivo: 'Trazer o movimento bancário para o sistema, conciliar com os títulos e lançar o que não estava previsto.',
    passos: [
      'Baixe o OFX no internet banking e, em Bancos e conciliação, escolha a conta e importe o arquivo.',
      'O sistema descarta repetidos pelo identificador do banco (FITID), dentro do arquivo e contra o que já foi importado, e informa quantos entraram.',
      'Para cada transação, veja as sugestões por pontuação (valor, data, histórico) e confirme a conciliação com o título.',
      'Movimento sem título (tarifa, juros, recebimento não previsto): use "Lançar a partir da transação". Nasce realizado, liquidado e conciliado, sem alçada.',
      'Ao final, o saldo bancário da Posição diária deve bater com o extrato: saldo de abertura + transações.',
    ],
    obrigatorios: ['Conta financeira', 'Arquivo OFX'],
    regras: ['Sem FITID a chave passa a ser data + valor + histórico.', 'O mesmo extrato importado em outra conta entra de novo: confira a conta antes.', 'Movimento bancário é fato: não passa por aprovação.'],
    erros: ['Importar o OFX na conta errada.', 'Conciliar um título com valor diferente sem justificar a divergência.'],
    verificacao: [
      { pergunta: 'O que impede transações repetidas na importação?', opcoes: ['Nada, é preciso conferir à mão', 'O FITID do banco, dentro do arquivo e contra o já importado', 'A data-base'], correta: 1 },
      { pergunta: '"Lançar a partir da transação" cria um lançamento…', opcoes: ['Previsto, aguardando aprovação', 'Realizado, liquidado e conciliado, sem alçada', 'Cancelado'], correta: 1 },
    ],
  },
  {
    id: 'fin-posicao', titulo: 'Posição diária e fluxo de 13 semanas', area: 'Financeiro', rota: '/posicao', minutos: 10,
    objetivo: 'Ler o caixa de hoje e a projeção semanal, e agir sobre o menor saldo.',
    passos: [
      'Posição diária: saldo por conta = saldo de abertura + extrato importado, mais os títulos que vencem hoje.',
      'Fluxo 13 semanas: entradas e saídas previstas por semana a partir da data-base, com saldo acumulado e o menor saldo do período.',
      'Use os cenários para simular atraso de recebimento ou antecipação de pagamento sem alterar a base.',
      'Se o menor saldo ficar abaixo da reserva mínima, o painel alerta e as novas saídas passam a exigir aprovação.',
    ],
    obrigatorios: [],
    regras: ['A data do saldo de abertura de cada conta é independente da data-base.', 'Só Diretoria, Financeiro, Contabilidade, Auditoria e Administrador veem bancos.'],
    erros: ['Esquecer de importar o extrato: a posição diária fica defasada.'],
    verificacao: [{ pergunta: 'Como é calculado o saldo bancário na Posição diária?', opcoes: ['Soma dos lançamentos realizados', 'Saldo de abertura + transações do extrato', 'Digitado pelo usuário'], correta: 1 }],
  },
  {
    id: 'fin-dividas', titulo: 'Dívidas e parcelas', area: 'Financeiro', rota: '/dividas', minutos: 6,
    objetivo: 'Cadastrar financiamentos e empréstimos para que as parcelas entrem no fluxo de caixa.',
    passos: ['Em Dívidas, cadastre o contrato com credor, valor, taxa, número de parcelas e primeiro vencimento.', 'As parcelas geram lançamentos previstos que aparecem no fluxo de 13 semanas e 24 meses.', 'Ao pagar, liquide a parcela como qualquer título.'],
    obrigatorios: ['Credor', 'Valor', 'Parcelas', 'Primeiro vencimento'],
    regras: ['Parcelas pagas não podem ser apagadas: estorne.'],
    erros: ['Cadastrar a dívida e também lançar as parcelas à mão: duplica o fluxo.'],
    verificacao: [{ pergunta: 'Onde as parcelas de uma dívida aparecem?', opcoes: ['Só na tela de Dívidas', 'No fluxo de 13 semanas e 24 meses como saídas previstas', 'No DRE como receita'], correta: 1 }],
  },
  {
    id: 'fin-fechamento', titulo: 'Checks e fechamento do período', area: 'Financeiro', rota: '/checks', minutos: 12,
    objetivo: 'Fechar o mês com os controles verdes e travar alterações retroativas.',
    passos: [
      'Em Checks e fechamento, rode os controles: conciliação completa, títulos vencidos sem tratamento, lançamentos sem categoria, saldo bancário × extrato, competências sem lançamentos.',
      'Trate cada item apontado ou registre a justificativa de divergência.',
      'Feche o período. A partir daí lançamentos, liquidações e estornos daquela competência ficam bloqueados.',
      'Precisou corrigir? Só a Diretoria ou o Administrador reabrem, com motivo, e o fechamento é refeito.',
    ],
    obrigatorios: ['Justificativa nas divergências'],
    regras: ['Divergência justificada não bloqueia o fechamento, apenas fica marcada.', 'Só Financeiro e Administrador fecham; Diretoria e Administrador reabrem.'],
    erros: ['Fechar com o extrato do último dia ainda não importado.'],
    verificacao: [{ pergunta: 'Quem reabre um período fechado?', opcoes: ['Qualquer usuário', 'Diretoria ou Administrador, com motivo', 'O Financeiro sem registro'], correta: 1 }],
  },

  // ---------------------------------------------------------------------- Obras
  {
    id: 'obra-contrato', titulo: 'Cadastrar obra e contrato', area: 'Obras', rota: '/obras', minutos: 10,
    objetivo: 'Abrir a obra com os dados do contrato para que receita, faturamento direto e prazo alimentem a Obra 360.',
    passos: [
      'Em Obras e contratos, clique em Nova obra. Informe código (padrão OB-CLIENTE-NN), nome, cliente, cidade/UF e o gestor responsável.',
      'Contrato: valor global, parcela faturada direto pelo cliente, retenção, margem alvo e datas de início e fim contratual.',
      'Salve e cadastre os serviços do cronograma físico-financeiro na aba Serviços, ou contrate um orçamento executivo para gerá-los.',
      'Atribua a obra aos usuários que vão operá-la em Cadastros › Usuários.',
    ],
    obrigatorios: ['Código único', 'Nome', 'Cliente', 'Valor do contrato', 'Margem alvo'],
    regras: ['Enquanto não há orçamento, o custo previsto de cada serviço é receita × (1 − margem alvo).', 'Só Gestor de obra, Financeiro, Diretoria e Administrador editam obras.'],
    erros: ['Cadastrar receitas previstas que somam mais que o saldo do contrato.'],
    verificacao: [{ pergunta: 'Sem orçamento, de onde vem o custo previsto do serviço?', opcoes: ['É zero', 'Receita × (1 − margem alvo)', 'Do extrato'], correta: 1 }],
  },
  {
    id: 'obra-servicos', titulo: 'Serviços e cronograma físico-financeiro', area: 'Obras', rota: '/obras', minutos: 12,
    objetivo: 'Manter os serviços do contrato com quantidade, unidade, receita, custo previsto e peso da fabricação.',
    passos: [
      'Na Obra 360 › Serviços, cada linha é um item do cronograma: código, nome, etapa, quantidade, unidade, receita e custo.',
      'Custo previsto segue a prioridade: custo orçado próprio › custo direto dos itens do orçamento executivo contratado vinculados ao serviço › margem alvo.',
      'Para estrutura metálica, defina o peso da fabricação (padrão 60%): a execução física será fabricação × peso + montagem × (1 − peso).',
      'A coluna Físico mostra a origem do avanço (kg, ordens, medição, quantidade ou faturamento).',
      'Vincule os lançamentos de custo ao serviço para ver orçado × comprometido × pago por serviço.',
    ],
    obrigatorios: ['Código', 'Nome', 'Quantidade e unidade', 'Receita prevista'],
    regras: ['Serviço com lista de materiais avança por kg e ignora o boletim manual.'],
    erros: ['Deixar todos os serviços em "vb": a produtividade e o custo por kg dependem de quantidades reais.'],
    verificacao: [{ pergunta: 'Qual fonte de avanço físico tem prioridade sobre as outras?', opcoes: ['Percentual faturado', 'Lista de materiais em kg', 'Quantidade digitada'], correta: 1 }],
  },
  {
    id: 'obra-medicao-fisica', titulo: 'Medir o avanço físico de um serviço', area: 'Obras', rota: '/obras', minutos: 8,
    objetivo: 'Registrar boletins de medição que somam no avanço do serviço e da obra.',
    passos: [
      'Na Obra 360 › Serviços, clique em Medir no serviço.',
      'Informe a data, a quantidade medida na unidade do serviço (ou o percentual, em serviços por verba), a descrição da frente ou trecho e a evidência (RDO, foto).',
      'O boletim acumula com os anteriores e não passa do total. A primeira medição coloca o serviço Em andamento.',
      'Excluir um boletim exige motivo e fica na auditoria.',
    ],
    obrigatorios: ['Data', 'Quantidade ou %', 'Descrição'],
    regras: ['Não vale para serviços com lista de materiais ou ordens: nesses o avanço é automático.'],
    erros: ['Medir o acumulado em vez do período: o boletim é incremental.'],
    verificacao: [{ pergunta: 'O boletim de medição registra…', opcoes: ['O acumulado até hoje', 'A quantidade executada no período, que se soma às anteriores', 'O valor faturado'], correta: 1 }],
  },
  {
    id: 'obra-medicoes-cliente', titulo: 'Eventos de medição ao cliente', area: 'Obras', rota: '/obras', minutos: 8,
    objetivo: 'Controlar os eventos do contrato: previsto, medido, aprovado e faturado.',
    passos: [
      'Na Obra 360 › Medições estão os eventos do contrato com mês, etapa, critério de medição e valores.',
      'Ao concluir o escopo do evento, mude o status para Medido e anexe os documentos exigidos pelo critério.',
      'Com a aprovação da fiscalização, marque Aprovado; o Financeiro fatura (lição de contas a receber) e o evento passa a Faturado com a NF.',
      'O saldo a medir e os eventos atrasados aparecem na faixa da Obra 360.',
    ],
    obrigatorios: ['Número e evento', 'Valor bruto = direto + construtora'],
    regras: ['Faturamento direto do contrato = soma do faturamento direto dos eventos; é esse saldo que as compras diretas abatem.'],
    erros: ['Marcar Faturado sem NF.'],
    verificacao: [{ pergunta: 'O saldo de faturamento direto do contrato vem de…', opcoes: ['Dos lançamentos', 'Da soma do faturamento direto dos eventos de medição', 'Do orçamento SINAPI'], correta: 1 }],
  },
  {
    id: 'obra-demandas', titulo: 'Demandas e ordens de produção', area: 'Obras', rota: '/central', minutos: 8,
    objetivo: 'Usar a Central de obras para demandas do período e ordens de fabricação e montagem.',
    passos: [
      'Central de obras › Painel analítico mostra a saúde de cada obra; Carteira e serviços lista os serviços ativos.',
      'Demandas: crie com título, responsável, prazo e obra; conclua ou justifique o atraso.',
      'Ordens de fabricação e montagem: descrição, serviço, quantidade e unidade (kg ou t); as etapas são as estações da fábrica ou do canteiro.',
      'As etapas avançam sozinhas pelos apontamentos de estação; avançar à mão só quando não houver apontamento.',
    ],
    obrigatorios: ['Título e responsável da demanda', 'Descrição da ordem'],
    regras: ['Ordem cancelada sai da produção mas fica na auditoria.'],
    erros: ['Criar ordem em "un" para estrutura: use kg ou t para o avanço por peso funcionar.'],
    verificacao: [{ pergunta: 'As etapas de uma ordem de fabricação são…', opcoes: ['Livres', 'As estações: Corte, Furação, Montagem e ponteamento, Solda, Pintura, Expedição', 'Só início e fim'], correta: 1 }],
  },
  {
    id: 'obra-materiais', titulo: 'Lista de materiais em kg', area: 'Obras', rota: '/obras', minutos: 10,
    objetivo: 'Importar a lista de conjuntos do projeto para que fabricação e montagem avancem por peso.',
    passos: [
      'Na Obra 360 › Materiais, clique em Importar. Cole o texto ou envie a planilha exportada do Tekla, SolidWorks ou Excel.',
      'O leitor reconhece as colunas pelo cabeçalho (marca, descrição, perfil, quantidade, peso unitário ou total) em português ou inglês.',
      'Escolha o serviço de estrutura ao qual a lista pertence. Marcas já existentes são atualizadas: reimporte a cada revisão de projeto.',
      'Selecione conjuntos e use Apontar para liberar para fabricação, ou deixe que a fábrica aponte por estação.',
    ],
    obrigatorios: ['Marca única por obra', 'Quantidade', 'Peso unitário maior que zero'],
    regras: ['Montado puxa expedido, que puxa fabricado; nunca acima do total.', 'Conjunto com fabricação apontada não pode ser excluído.'],
    erros: ['Importar peso total na coluna de peso unitário.'],
    verificacao: [{ pergunta: 'O que acontece ao reimportar uma lista revisada?', opcoes: ['Duplica os conjuntos', 'Marcas existentes são atualizadas e novas são criadas', 'A importação é recusada'], correta: 1 }],
  },

  // ----------------------------------------------------------------- Engenharia
  {
    id: 'eng-orcamento', titulo: 'Orçamento executivo com composições', area: 'Engenharia', rota: '/orcamentos', minutos: 20,
    objetivo: 'Montar um orçamento por composições, aplicar BDI, ler a curva ABC e contratar gerando os serviços da obra.',
    passos: [
      'Em Orçamentos e composições › Orçamentos, crie o orçamento com título, obra ou cliente e BDI.',
      'Adicione itens em etapas: composição ou insumo do catálogo, quantidade e unidade. O custo unitário é Σ coeficiente × preço, recursivo.',
      'Preço de venda = custo × (1 + BDI). Em propostas fechadas, informe o preço de venda do item: a margem passa a ser calculada contra o custo.',
      'Curva ABC de insumos e de itens: os 80% (classe A) são o que precisa de cotação e controle de compra.',
      'Vincule cada item ao serviço do contrato. Contratar congela os itens, grava o custo orçado da obra e gera ou atualiza os serviços.',
    ],
    obrigatorios: ['Título', 'Item com composição ou insumo, quantidade e unidade'],
    regras: ['Orçamento Contratado não é editável: crie uma revisão.', 'Item vinculado a serviço alimenta o custo previsto do serviço na Obra 360.'],
    erros: ['Comparar custo SINAPI com preço vendido sem BDI.', 'Esquecer de vincular itens a serviços.'],
    verificacao: [
      { pergunta: 'O que "Contratar" faz?', opcoes: ['Envia e-mail ao cliente', 'Congela os itens, grava o custo orçado e gera os serviços da obra', 'Apaga o orçamento'], correta: 1 },
      { pergunta: 'Classe A da curva ABC são os insumos que…', opcoes: ['Custam mais de R$ 1.000', 'Acumulam 80% do custo', 'Vêm do SINAPI'], correta: 1 },
    ],
  },
  {
    id: 'eng-composicoes', titulo: 'Composições e insumos: revisar os índices', area: 'Engenharia', rota: '/orcamentos', minutos: 12,
    objetivo: 'Manter o catálogo: preços de insumos, coeficientes das composições próprias e origem de cada dado.',
    passos: [
      'Aba Insumos: cada insumo tem código, unidade, tipo (material, mão de obra, equipamento, serviço), preço, data e fonte do preço.',
      'Aba Composições: coeficientes por insumo ou por outra composição. As próprias da EIFF (EIFF-FAB-KG, EIFF-MON-KG, EIFF-EST-KG) têm HH/t e consumo de aço estimados: substitua por apontamento real.',
      'Importar SINAPI: escolha a UF e envie as planilhas da Caixa; insumos e composições casam por origem + código.',
      'Preços pagos em pedidos de compra recebidos podem atualizar o preço vigente do insumo.',
    ],
    obrigatorios: ['Código e descrição', 'Unidade', 'Preço'],
    regras: ['Composição não pode referenciar a si mesma (ciclo).', 'A TCPO é licenciada: só o que o usuário exportar; a SINAPI é pública.'],
    erros: ['Alterar um preço sem informar a fonte e a data.'],
    verificacao: [{ pergunta: 'Como o preço real de compra chega ao catálogo?', opcoes: ['Digitando à mão a cada orçamento', 'Ao receber o pedido de compra com "atualizar preço" marcado', 'Automaticamente do banco'], correta: 1 }],
  },

  // ---------------------------------------------------------- Fabrica e montagem
  {
    id: 'fab-apontar-estacao', titulo: 'Apontar a produção por estação', area: 'Fábrica e montagem', rota: '/producao', minutos: 12,
    objetivo: 'Registrar todo dia o que cada estação processou em kg, peças e horas por colaborador.',
    passos: [
      'Em Fábrica e montagem, clique em Apontar estação. Informe data, obra, linha (Fabricação ou Montagem) e a estação.',
      'Selecione a ordem: a quantidade é acumulada na etapa de mesmo nome da ordem.',
      'Marque os conjuntos processados e a quantidade de peças de cada um. O peso é calculado pela lista; sem lista, informe o peso em kg.',
      'Preencha as horas de cada colaborador que trabalhou na estação (0 a 24 h). A equipe vem do cadastro com local Fábrica ou Obra.',
      'Registre. Pintura marca os conjuntos como fabricados, Expedição como expedidos e Liberação como montados.',
    ],
    obrigatorios: ['Data', 'Obra', 'Estação da linha', 'Peso, peças ou conjuntos', 'Colaboradores cadastrados'],
    regras: ['Apontamento é imutável: para corrigir, exclua com motivo e aponte de novo.', 'Excluir desfaz os marcos nos conjuntos, mas não mexe na ordem: reaponte.'],
    erros: ['Apontar a Pintura sem os conjuntos: o avanço por kg da obra não anda.', 'Esquecer as horas: a produtividade em kg/HH fica em branco.'],
    verificacao: [
      { pergunta: 'Qual estação marca o conjunto como fabricado?', opcoes: ['Corte', 'Pintura', 'Solda'], correta: 1 },
      { pergunta: 'Como corrigir um apontamento errado?', opcoes: ['Editando', 'Excluindo com motivo e apontando de novo', 'Não é possível'], correta: 1 },
    ],
  },
  {
    id: 'fab-romaneio', titulo: 'Emitir o romaneio de expedição', area: 'Fábrica e montagem', rota: '/producao', minutos: 6,
    objetivo: 'Documentar cada carga que sai da fábrica e marcar os conjuntos como expedidos.',
    passos: [
      'Em Fábrica e montagem, com a obra selecionada, clique em Romaneio.',
      'Informe data de saída, transportadora ou veículo, placa, motorista e destino.',
      'Marque os conjuntos e as quantidades da carga; o sistema mostra o já expedido e o peso total.',
      'Emitir marca os conjuntos como expedidos. No canteiro, marque Entregue; Cancelar devolve os conjuntos ao estoque da fábrica.',
    ],
    obrigatorios: ['Transportadora', 'Pelo menos um conjunto'],
    regras: ['Não expede mais que a quantidade total do conjunto.', 'Expedir puxa fabricado, se ainda não apontado.'],
    erros: ['Emitir romaneio sem os conjuntos: só o peso não rastreia.'],
    verificacao: [{ pergunta: 'O que cancelar um romaneio faz?', opcoes: ['Apaga o registro', 'Devolve os conjuntos a não expedidos e fica na auditoria', 'Marca como entregue'], correta: 1 }],
  },
  {
    id: 'fab-produtividade', titulo: 'Ler a produtividade em kg por hora-homem', area: 'Fábrica e montagem', rota: '/producao', minutos: 8,
    objetivo: 'Comparar a produtividade real com a meta das composições e agir na estação ou na equipe.',
    passos: [
      'O herói da tela mostra kg/HH da fábrica e do canteiro no período contra a meta (57 kg/HH na fábrica = 17,5 HH/t; 38 kg/HH em campo = 26 HH/t).',
      'Aba Produtividade: por estação (kg, horas, kg/HH, R$/kg) e por colaborador (horas, kg atribuídos proporcionalmente, % da meta).',
      'Verde atinge a meta, amarelo entre 80% e 100%, vermelho abaixo de 80%.',
      'Custo de mão de obra = horas × custo/hora do colaborador: é o custo real que substitui o índice estimado das composições.',
    ],
    obrigatorios: [],
    regras: ['Sem horas apontadas não há kg/HH.'],
    erros: ['Comparar estações diferentes entre si: compare cada uma com o seu histórico.'],
    verificacao: [{ pergunta: 'De onde vem a meta de kg/HH?', opcoes: ['Do cliente', 'Das composições EIFF-FAB-KG e EIFF-MON-KG (HH por tonelada)', 'Do SINAPI'], correta: 1 }],
  },

  // -------------------------------------------------------------------- Estoque
  {
    id: 'est-entrada', titulo: 'Entrada de aço com corrida e certificado', area: 'Estoque', rota: '/estoque', minutos: 10,
    objetivo: 'Dar entrada no material com rastreabilidade e custo por kg.',
    passos: [
      'Em Estoque de aço › Itens, cadastre o perfil, chapa ou tubo (código, família, descrição, peso unitário, estoque mínimo).',
      'Clique em Entrada. Escolha o item e o local (Fábrica ou Obra).',
      'Escolha o pedido de compra e o item do pedido: fornecedor, NF, quilos e preço são preenchidos.',
      'Informe a corrida (heat number) e o certificado de qualidade. Para aço estrutural a corrida é obrigatória.',
      'Registre. O lote passa a existir com saldo e custo por kg.',
    ],
    obrigatorios: ['Item', 'Quantidade em kg', 'Custo R$/kg', 'Corrida (aço estrutural)'],
    regras: ['Movimentos são imutáveis: erros são corrigidos por estorno.', 'Entrada já consumida não pode ser estornada.'],
    erros: ['Dar entrada por peças em vez de kg.', 'Digitar a corrida com espaços ou minúsculas: o sistema normaliza, mas confira o certificado.'],
    verificacao: [{ pergunta: 'Por que a corrida é obrigatória para perfis e chapas?', opcoes: ['Para calcular o frete', 'Para rastrear de qual certificado veio o aço de cada conjunto', 'Para o SINAPI'], correta: 1 }],
  },
  {
    id: 'est-consumo', titulo: 'Consumo no corte, sobras e ajustes', area: 'Estoque', rota: '/estoque', minutos: 12,
    objetivo: 'Baixar o material usado no corte por lote, obra, ordem e conjunto, e devolver retalhos.',
    passos: [
      'Clique em Consumo. Informe a obra, o serviço e a ordem de fabricação.',
      'Escolha o item e o lote pela corrida: só lotes com saldo no local aparecem. O custo por kg é o do lote.',
      'Marque os conjuntos cortados com esse material e a quantidade de peças de cada um.',
      'Sobra: retalho que volta ao estoque; escolha o lote de origem e o peso.',
      'Ajuste: quantidade com sinal (negativa para baixa) e justificativa obrigatória. Estorno: na lista de movimentos, com motivo.',
    ],
    obrigatorios: ['Obra', 'Item e quantidade', 'Justificativa no ajuste', 'Motivo no estorno'],
    regras: ['Consumo não pode exceder o saldo do lote no local.', 'Custo real de aço por serviço = consumo − sobras, ao custo do lote; aparece na Obra 360.'],
    erros: ['Consumir do saldo geral sem escolher a corrida: perde a rastreabilidade.'],
    verificacao: [{ pergunta: 'Qual custo por kg um consumo recebe?', opcoes: ['O preço SINAPI', 'O custo médio do lote (corrida) escolhido', 'Zero'], correta: 1 }],
  },
  {
    id: 'est-rastreio', titulo: 'Rastreabilidade de corrida', area: 'Estoque', rota: '/estoque', minutos: 5,
    objetivo: 'Responder em segundos de onde veio o aço de um conjunto e onde uma corrida foi usada.',
    passos: ['Aba Rastreabilidade: digite a corrida para ver entradas, saldo, obras e conjuntos que a consumiram.', 'Digite a marca do conjunto para ver as corridas, certificados e fornecedores que entraram nele.', 'Use na entrega da documentação técnica ao cliente e em não conformidades.'],
    obrigatorios: [],
    regras: ['Só consumos que citam conjuntos aparecem na rastreabilidade por marca.'],
    erros: ['Apontar consumo sem conjuntos e depois procurar a corrida pela marca.'],
    verificacao: [{ pergunta: 'Para a rastreabilidade por marca funcionar, o consumo precisa…', opcoes: ['Ter nota fiscal', 'Citar os conjuntos cortados', 'Ser aprovado'], correta: 1 }],
  },

  // --------------------------------------------------------------------- Equipe
  {
    id: 'eq-colaboradores', titulo: 'Cadastro de colaboradores', area: 'Equipe', rota: '/equipe', minutos: 6,
    objetivo: 'Manter a equipe com função, local e custo/hora, base do apontamento e do custo de mão de obra.',
    passos: ['Em Equipe e produtividade, cadastre nome, função, vínculo, equipe, local (Obra, Fábrica, Escritório), custo/hora total (salário + encargos ÷ horas) e jornada.', 'Obra padrão para quem fica fixo em uma obra; usuário de login se ele for usar o modo campo.', 'Desative em vez de excluir quando alguém sair.'],
    obrigatorios: ['Nome', 'Função', 'Custo/hora ≥ 0', 'Jornada > 0'],
    regras: ['Local define em quais apontamentos o colaborador aparece (fábrica ou canteiro).'],
    erros: ['Custo/hora só com salário: sem encargos o custo real fica subestimado.'],
    verificacao: [{ pergunta: 'O custo/hora deve incluir…', opcoes: ['Só o salário', 'Salário mais encargos, dividido pelas horas', 'O valor da diária'], correta: 1 }],
  },
  {
    id: 'eq-apontamento-diario', titulo: 'Apontamento diário e modo campo', area: 'Equipe', rota: '/campo', minutos: 10,
    objetivo: 'Registrar presença, horas, produção e ocorrências do dia, do celular ou do escritório.',
    passos: [
      'Modo campo (celular): seção Dia abre o diário do local pré-preenchido com a equipe; marque presença, horas e horas extras.',
      'Registre a produção do dia (quantidade e unidade por serviço) e as ocorrências (chuva, falta de material, acidente).',
      'Seção Produção: aponta a estação da fábrica direto do chão de fábrica. Checklist: itens de segurança e liberação.',
      'Feche o dia. Apontamento fechado só Gestor, Financeiro, Diretoria ou Administrador alteram.',
    ],
    obrigatorios: ['Data', 'Local'],
    regras: ['Horas apontadas × custo/hora = custo de mão de obra do dia por obra.'],
    erros: ['Fechar o dia antes de registrar as horas extras.'],
    verificacao: [{ pergunta: 'Quem altera um apontamento já fechado?', opcoes: ['Qualquer um', 'Gestor, Financeiro, Diretoria ou Administrador', 'Ninguém'], correta: 1 }],
  },
  {
    id: 'eq-tarefas', titulo: 'Tarefas e quadro kanban', area: 'Equipe', rota: '/equipe', minutos: 5,
    objetivo: 'Distribuir e acompanhar tarefas com responsável e prazo.',
    passos: ['Em Equipe e produtividade › Tarefas, crie a tarefa com título, responsável, prazo e obra.', 'Arraste ou mude o status: Aberta, Em andamento, Bloqueada, Concluída.', 'Tarefas vencidas aparecem no contador do menu; bloqueadas precisam do motivo.'],
    obrigatorios: ['Título', 'Responsável', 'Prazo'],
    regras: [],
    erros: ['Criar tarefas sem prazo: nunca aparecem como atrasadas.'],
    verificacao: [{ pergunta: 'Onde o responsável vê as tarefas dele?', opcoes: ['No DRE', 'Na caixa de entrada e no kanban', 'Na Posição diária'], correta: 1 }],
  },

  // -------------------------------------------------------------------- Compras
  {
    id: 'comp-pedido', titulo: 'Pedido de compra', area: 'Compras', rota: '/compras', minutos: 12,
    objetivo: 'Comprar com rastreio até o financeiro: emitir gera o compromisso e passa pelas alçadas.',
    passos: [
      'Em Compras e pedidos, crie o pedido: obra, serviço, fornecedor, documento da cotação, prazo de pagamento e categoria.',
      'Itens: vincule ao insumo do catálogo para comparar o preço cotado com o orçado e alimentar o orçado × comprado.',
      'Marque faturamento direto quando o cliente pagar o fornecedor.',
      'Emitir gera um lançamento previsto com vencimento = data + prazo, que passa pelas alçadas normais, e congela os itens.',
      'Cancelar cancela o lançamento junto, desde que não pago.',
    ],
    obrigatorios: ['Fornecedor', 'Obra', 'Categoria', 'Itens com quantidade e preço'],
    regras: ['Pedido emitido acima do limite do gestor vai para aprovação antes de contar no comprometido.'],
    erros: ['Emitir sem vincular insumos: o comparativo orçado × comprado fica cego.'],
    verificacao: [{ pergunta: 'O que "Emitir" faz no financeiro?', opcoes: ['Nada', 'Gera um lançamento previsto que passa pelas alçadas', 'Paga o fornecedor'], correta: 1 }],
  },
  {
    id: 'comp-receber', titulo: 'Receber material e atualizar preços', area: 'Compras', rota: '/compras', minutos: 6,
    objetivo: 'Registrar o recebimento parcial ou total e levar o preço pago ao catálogo.',
    passos: ['No pedido emitido, clique em Receber. Informe a data e as quantidades recebidas por item.', 'Marque "atualizar preço do insumo" para gravar o preço pago como vigente, com a fonte "Pedido PC-xxxx · fornecedor".', 'Para aço, dê entrada no Estoque a partir do pedido, com a corrida do certificado.'],
    obrigatorios: ['Data', 'Pelo menos uma quantidade'],
    regras: ['Quantidade recebida não passa da pedida.'],
    erros: ['Receber no pedido e esquecer a entrada no estoque.'],
    verificacao: [{ pergunta: 'Depois de receber aço no pedido, o que falta?', opcoes: ['Nada', 'A entrada no Estoque com a corrida', 'Aprovar de novo'], correta: 1 }],
  },
  {
    id: 'comp-comparativo', titulo: 'Orçado × comprado por insumo', area: 'Compras', rota: '/compras', minutos: 6,
    objetivo: 'Ver quanto de cada insumo orçado já foi comprado e a que preço.',
    passos: ['Aba Orçado × comprado: a explosão de insumos dos orçamentos contratados da obra contra os pedidos ativos.', 'Percentual comprado, preço médio contra orçado e desvio de valor acima do ritmo orçado.', 'Insumos comprados fora do orçamento aparecem em destaque: revise o orçamento ou a compra.'],
    obrigatorios: [],
    regras: ['Só pedidos com insumo vinculado entram.'],
    erros: [],
    verificacao: [{ pergunta: 'Um insumo "fora do orçamento" significa…', opcoes: ['Que está caro', 'Que foi comprado sem constar na explosão do orçamento contratado', 'Que o pedido foi cancelado'], correta: 1 }],
  },

  // ---------------------------------------------------- Direcao e controladoria
  {
    id: 'dir-painel', titulo: 'Painel executivo', area: 'Direção e controladoria', rota: '/', minutos: 8,
    objetivo: 'Ler em um minuto caixa, obras, aprovações e alertas.',
    passos: ['O herói mostra o caixa projetado e o menor saldo das 13 semanas; a faixa traz vencidos, comprometido, margem das obras e pendências.', 'Alertas: reserva mínima, títulos vencidos, eventos de medição atrasados, obras com margem abaixo do alvo.', 'Cada indicador leva à tela de origem ao clicar.'],
    obrigatorios: [],
    regras: ['Faturamento direto não entra no caixa nem no DRE do painel.'],
    erros: [],
    verificacao: [{ pergunta: 'O menor saldo das 13 semanas abaixo da reserva mínima…', opcoes: ['Só aparece no painel', 'Faz novas saídas exigirem aprovação', 'Bloqueia o sistema'], correta: 1 }],
  },
  {
    id: 'dir-fluxo24', titulo: 'Fluxo de 24 meses e cenários', area: 'Direção e controladoria', rota: '/fluxo24', minutos: 6,
    objetivo: 'Projetar o caixa mensal com contratos, dívidas e cenários.',
    passos: ['Fluxo 24 meses agrega entradas e saídas previstas por mês, com saldo acumulado.', 'Cenários alteram premissas (atraso de recebimento, inflação de custo) sem mexer na base.', 'Compare com o DRE por competência para separar caixa de resultado.'],
    obrigatorios: [],
    regras: [],
    erros: [],
    verificacao: [{ pergunta: 'Um cenário…', opcoes: ['Altera os lançamentos', 'Simula premissas sem alterar a base', 'Fecha o período'], correta: 1 }],
  },
  {
    id: 'ctb-dre', titulo: 'DRE gerencial por competência', area: 'Direção e controladoria', rota: '/dre', minutos: 8,
    objetivo: 'Ler o resultado do mês pela competência e entender as diferenças para o caixa.',
    passos: ['O DRE agrupa receitas e custos pelo plano de contas na competência informada nos lançamentos.', 'Diferenças para o caixa: vencimentos em outro mês, retenções, faturamento direto (fora do DRE da EIFF).', 'Categorias sem classificação aparecem nos checks: corrija antes do fechamento.'],
    obrigatorios: [],
    regras: ['Lançamentos cancelados não entram.'],
    erros: ['Interpretar queda de caixa como prejuízo: veja a competência.'],
    verificacao: [{ pergunta: 'O DRE usa…', opcoes: ['A data de pagamento', 'A competência', 'A data-base'], correta: 1 }],
  },
  {
    id: 'aud-auditoria', titulo: 'Auditoria e trilha de alterações', area: 'Direção e controladoria', rota: '/auditoria', minutos: 5,
    objetivo: 'Encontrar quem fez o quê, quando e com qual motivo.',
    passos: ['Em Auditoria, filtre por entidade (lançamento, obra, estoque, produção…), usuário e período.', 'Cada registro guarda o antes e o depois e o motivo quando exigido (estorno, cancelamento, exclusão).', 'O banco também grava a sua própria trilha por gatilho.'],
    obrigatorios: [],
    regras: ['Só Administrador, Diretoria, Financeiro, Contabilidade e Auditoria veem a auditoria.'],
    erros: [],
    verificacao: [{ pergunta: 'Um estorno fica registrado com…', opcoes: ['Só a data', 'Usuário, antes/depois e motivo', 'Nada'], correta: 1 }],
  },
  {
    id: 'adm-cadastros', titulo: 'Cadastros, parâmetros e usuários', area: 'Administração', rota: '/cadastros', minutos: 10,
    objetivo: 'Manter plano de contas, contas financeiras, alçadas, reserva mínima e usuários com papel e obras.',
    passos: [
      'Plano de contas: categorias com tipo e grupo do DRE. Contas financeiras: banco, saldo de abertura e sua data.',
      'Parâmetros e alçadas: limite do gestor de obra, limite do financeiro, desvio de orçamento permitido, reserva mínima, SLA de aprovação e data-base automática.',
      'Usuários: papel (Administrador, Diretoria, Financeiro, Gestor de obra, Engenharia, Compras, Contabilidade, Auditoria) e obras visíveis (todas ou lista).',
      'Ao mudar uma alçada, avise a equipe: solicitações novas já seguem o novo limite.',
    ],
    obrigatorios: ['Categoria com tipo', 'Conta com saldo de abertura e data', 'Usuário com papel'],
    regras: ['Só Administrador e Financeiro editam cadastros; parâmetros também pela Diretoria.'],
    erros: ['Deixar a reserva mínima em zero: o alerta de caixa nunca dispara.'],
    verificacao: [{ pergunta: 'O que a reserva mínima controla?', opcoes: ['O estoque de aço', 'O alerta de caixa e a exigência de aprovação quando o saldo cai abaixo dela', 'O BDI'], correta: 1 }],
  },
];

// ---------------------------------------------------------------------------
// Trilhas por papel (ordem de estudo)
// ---------------------------------------------------------------------------
const BASE = ['base-navegacao', 'base-caixa-entrada', 'base-obra360'];
export const TRILHAS: Record<Papel, string[]> = {
  Administrador: LICOES.map((l) => l.id),
  Diretoria: [...BASE, 'dir-painel', 'fin-aprovacao', 'fin-posicao', 'dir-fluxo24', 'ctb-dre', 'obra-medicoes-cliente', 'fab-produtividade', 'fin-fechamento', 'adm-cadastros', 'aud-auditoria'],
  Financeiro: [...BASE, 'fin-lancamento', 'fin-aprovacao', 'fin-liquidar', 'fin-receber', 'fin-ofx', 'fin-posicao', 'fin-dividas', 'comp-receber', 'ctb-dre', 'fin-fechamento', 'adm-cadastros'],
  'Gestor de obra': [...BASE, 'obra-contrato', 'obra-servicos', 'obra-medicao-fisica', 'obra-medicoes-cliente', 'obra-demandas', 'obra-materiais', 'fab-apontar-estacao', 'fab-romaneio', 'fab-produtividade', 'est-consumo', 'est-rastreio', 'eq-colaboradores', 'eq-apontamento-diario', 'eq-tarefas', 'fin-lancamento', 'comp-pedido', 'fin-aprovacao'],
  Engenharia: [...BASE, 'eng-orcamento', 'eng-composicoes', 'obra-servicos', 'obra-materiais', 'obra-medicao-fisica', 'obra-demandas', 'fab-apontar-estacao', 'fab-produtividade', 'est-consumo', 'est-rastreio', 'comp-pedido'],
  Compras: [...BASE, 'comp-pedido', 'comp-receber', 'comp-comparativo', 'est-entrada', 'est-consumo', 'eng-composicoes', 'fin-lancamento'],
  Contabilidade: [...BASE, 'ctb-dre', 'fin-receber', 'fin-fechamento', 'aud-auditoria'],
  Auditoria: [...BASE, 'aud-auditoria', 'fin-fechamento', 'ctb-dre', 'fin-ofx'],
};

const porId = new Map(LICOES.map((l) => [l.id, l]));
export const licao = (id: string) => porId.get(id);
export const trilhaDe = (papel: Papel): Licao[] => (TRILHAS[papel] ?? []).map((id) => porId.get(id)!).filter(Boolean);

// ---------------------------------------------------------------------------
// Processos ponta a ponta
// ---------------------------------------------------------------------------
export interface EtapaProcesso { papel: Papel | 'Fábrica' | 'Canteiro' | 'Cliente'; titulo: string; descricao: string; licaoId?: string; rota?: string }
export interface Processo { id: string; titulo: string; objetivo: string; etapas: EtapaProcesso[] }

export const PROCESSOS: Processo[] = [
  {
    id: 'proc-compra-pagamento', titulo: 'Da necessidade ao pagamento', objetivo: 'Toda compra nasce como pedido, vira compromisso aprovado, entra no estoque e é paga com evidência e conciliada.',
    etapas: [
      { papel: 'Compras', titulo: 'Pedido de compra', descricao: 'Obra, serviço, fornecedor, itens com insumo do catálogo, faturamento direto quando for o caso.', licaoId: 'comp-pedido' },
      { papel: 'Compras', titulo: 'Emitir', descricao: 'Gera o lançamento previsto com vencimento = data + prazo; itens congelados.', licaoId: 'comp-pedido' },
      { papel: 'Gestor de obra', titulo: 'Aprovação de alçada', descricao: 'Gestor → Financeiro → Diretoria conforme limite, orçamento da obra e reserva de caixa.', licaoId: 'fin-aprovacao' },
      { papel: 'Compras', titulo: 'Receber material', descricao: 'Quantidades por item; preço pago atualiza o catálogo.', licaoId: 'comp-receber' },
      { papel: 'Compras', titulo: 'Entrada no estoque', descricao: 'Aço com corrida e certificado, a partir do pedido.', licaoId: 'est-entrada' },
      { papel: 'Financeiro', titulo: 'Liquidar', descricao: 'Data real, conta, evidência; parcial quando for o caso.', licaoId: 'fin-liquidar' },
      { papel: 'Financeiro', titulo: 'Conciliar', descricao: 'Extrato OFX importado e casado com o título.', licaoId: 'fin-ofx' },
      { papel: 'Contabilidade', titulo: 'DRE e fechamento', descricao: 'Custo na competência; checks verdes; período fechado.', licaoId: 'fin-fechamento' },
    ],
  },
  {
    id: 'proc-orcamento-contrato', titulo: 'Do orçamento ao contrato', objetivo: 'O orçamento executivo nasce das composições, vira proposta e, contratado, gera os serviços e o custo orçado da obra.',
    etapas: [
      { papel: 'Engenharia', titulo: 'Catálogo', descricao: 'Insumos e composições SINAPI e próprias com preços datados.', licaoId: 'eng-composicoes' },
      { papel: 'Engenharia', titulo: 'Orçamento', descricao: 'Itens por etapa, BDI, curva ABC, preço de venda por item quando a proposta é fechada.', licaoId: 'eng-orcamento' },
      { papel: 'Diretoria', titulo: 'Proposta e negociação', descricao: 'Margem prevista contra o custo das composições; status Enviado.', licaoId: 'eng-orcamento' },
      { papel: 'Gestor de obra', titulo: 'Obra e contrato', descricao: 'Valor global, faturamento direto, retenção, prazos.', licaoId: 'obra-contrato' },
      { papel: 'Engenharia', titulo: 'Contratar o orçamento', descricao: 'Congela itens, grava custo orçado, gera serviços vinculados.', licaoId: 'eng-orcamento' },
      { papel: 'Gestor de obra', titulo: 'Eventos de medição', descricao: 'Cronograma físico-financeiro com critério e documentos por evento.', licaoId: 'obra-medicoes-cliente' },
    ],
  },
  {
    id: 'proc-projeto-montagem', titulo: 'Do projeto à montagem', objetivo: 'A lista de materiais dirige compra, corte, fabricação por estação, expedição e montagem; o avanço físico da obra é consequência.',
    etapas: [
      { papel: 'Engenharia', titulo: 'Lista de materiais', descricao: 'Conjuntos em kg importados do Tekla/SolidWorks, vinculados ao serviço de estrutura.', licaoId: 'obra-materiais' },
      { papel: 'Engenharia', titulo: 'Ordens de fabricação', descricao: 'Lotes em kg com as estações como etapas.', licaoId: 'obra-demandas' },
      { papel: 'Compras', titulo: 'Aço no estoque', descricao: 'Entrada por corrida com certificado.', licaoId: 'est-entrada' },
      { papel: 'Fábrica', titulo: 'Corte', descricao: 'Consumo por lote citando ordem e conjuntos; sobras devolvidas.', licaoId: 'est-consumo' },
      { papel: 'Fábrica', titulo: 'Estações', descricao: 'Corte, Furação, Montagem e ponteamento, Solda, Pintura: kg, peças e horas por colaborador. Pintura = fabricado.', licaoId: 'fab-apontar-estacao' },
      { papel: 'Fábrica', titulo: 'Romaneio', descricao: 'Carga documentada; conjuntos expedidos.', licaoId: 'fab-romaneio' },
      { papel: 'Canteiro', titulo: 'Montagem', descricao: 'Recebimento, pré-montagem, içamento, fixação, Liberação = montado.', licaoId: 'fab-apontar-estacao' },
      { papel: 'Gestor de obra', titulo: 'Avanço físico', descricao: 'Fabricação × peso + montagem × (1 − peso) na Obra 360, sem digitação.', licaoId: 'obra-servicos' },
      { papel: 'Gestor de obra', titulo: 'Medição ao cliente', descricao: 'Evento medido, aprovado e faturado.', licaoId: 'obra-medicoes-cliente' },
    ],
  },
  {
    id: 'proc-medicao-recebimento', titulo: 'Da medição ao recebimento', objetivo: 'O avanço físico vira evento medido, aprovado, faturado, recebido e conciliado.',
    etapas: [
      { papel: 'Gestor de obra', titulo: 'Boletim físico', descricao: 'Medir o serviço com quantidade e evidência.', licaoId: 'obra-medicao-fisica' },
      { papel: 'Gestor de obra', titulo: 'Evento medido', descricao: 'Documentos do critério anexados; status Medido.', licaoId: 'obra-medicoes-cliente' },
      { papel: 'Cliente', titulo: 'Aprovação da fiscalização', descricao: 'Evento Aprovado.', licaoId: 'obra-medicoes-cliente' },
      { papel: 'Financeiro', titulo: 'Nota e título', descricao: 'Receita a receber com obra, serviço, competência e vencimento; retenção separada.', licaoId: 'fin-receber' },
      { papel: 'Financeiro', titulo: 'Recebimento e conciliação', descricao: 'Liquidar a partir da transação bancária.', licaoId: 'fin-ofx' },
    ],
  },
  {
    id: 'proc-equipe', titulo: 'Rotina da equipe e custo de mão de obra', objetivo: 'Presença e horas viram custo real por obra e produtividade por estação.',
    etapas: [
      { papel: 'Gestor de obra', titulo: 'Cadastro', descricao: 'Função, local, custo/hora com encargos, jornada.', licaoId: 'eq-colaboradores' },
      { papel: 'Canteiro', titulo: 'Diário do dia', descricao: 'Presença, horas, produção, ocorrências no modo campo.', licaoId: 'eq-apontamento-diario' },
      { papel: 'Fábrica', titulo: 'Apontamento por estação', descricao: 'Horas por colaborador em cada estação.', licaoId: 'fab-apontar-estacao' },
      { papel: 'Gestor de obra', titulo: 'Fechar o dia', descricao: 'Apontamento fechado; ajustes só por gestor.', licaoId: 'eq-apontamento-diario' },
      { papel: 'Diretoria', titulo: 'Produtividade e custo', descricao: 'kg/HH contra a meta; custo de MO por serviço.', licaoId: 'fab-produtividade' },
    ],
  },
  {
    id: 'proc-fechamento', titulo: 'Fechamento do mês', objetivo: 'Um roteiro fixo para o resultado do mês ser confiável.',
    etapas: [
      { papel: 'Financeiro', titulo: 'Extratos', descricao: 'OFX de todas as contas até o último dia; conciliação completa.', licaoId: 'fin-ofx' },
      { papel: 'Financeiro', titulo: 'Títulos', descricao: 'Vencidos tratados, liquidações com evidência, competências corretas.', licaoId: 'fin-liquidar' },
      { papel: 'Gestor de obra', titulo: 'Obras', descricao: 'Boletins, eventos e apontamentos do mês fechados; ETC revisado.', licaoId: 'obra-medicao-fisica' },
      { papel: 'Financeiro', titulo: 'Checks', descricao: 'Controles verdes ou divergências justificadas.', licaoId: 'fin-fechamento' },
      { papel: 'Financeiro', titulo: 'Fechar período', descricao: 'Bloqueio de alterações retroativas.', licaoId: 'fin-fechamento' },
      { papel: 'Diretoria', titulo: 'DRE e painel', descricao: 'Resultado por competência, margem por obra, caixa projetado.', licaoId: 'ctb-dre' },
    ],
  },
];

// ---------------------------------------------------------------------------
// Rotinas por papel
// ---------------------------------------------------------------------------
export interface ItemRotina { texto: string; rota: string; licaoId?: string }
export interface Rotina { diaria: ItemRotina[]; semanal: ItemRotina[]; mensal: ItemRotina[] }

const ROTINA_BASE: Rotina = {
  diaria: [{ texto: 'Abrir a caixa de entrada e resolver aprovações e tarefas', rota: '/inbox', licaoId: 'base-caixa-entrada' }],
  semanal: [],
  mensal: [],
};

export const ROTINAS: Record<Papel, Rotina> = {
  Administrador: {
    diaria: [...ROTINA_BASE.diaria, { texto: 'Conferir sincronização e erros reportados pela equipe', rota: '/auditoria', licaoId: 'aud-auditoria' }],
    semanal: [{ texto: 'Revisar usuários, papéis e obras atribuídas', rota: '/cadastros', licaoId: 'adm-cadastros' }, { texto: 'Acompanhar o progresso da equipe na capacitação', rota: '/capacitacao' }],
    mensal: [{ texto: 'Revisar parâmetros e alçadas com a Diretoria', rota: '/cadastros', licaoId: 'adm-cadastros' }],
  },
  Diretoria: {
    diaria: [...ROTINA_BASE.diaria, { texto: 'Ler o painel executivo: caixa, alertas, margem das obras', rota: '/', licaoId: 'dir-painel' }, { texto: 'Decidir aprovações da alçada Diretoria', rota: '/aprovacoes', licaoId: 'fin-aprovacao' }],
    semanal: [{ texto: 'Fluxo 13 semanas e menor saldo contra a reserva', rota: '/fluxo13', licaoId: 'fin-posicao' }, { texto: 'Produtividade da fábrica e do canteiro contra a meta', rota: '/producao', licaoId: 'fab-produtividade' }, { texto: 'Obra 360 das obras ativas: EAC e margem projetada', rota: '/obras', licaoId: 'base-obra360' }],
    mensal: [{ texto: 'DRE por competência e fluxo 24 meses', rota: '/dre', licaoId: 'ctb-dre' }, { texto: 'Reabrir período só com motivo registrado', rota: '/checks', licaoId: 'fin-fechamento' }],
  },
  Financeiro: {
    diaria: [...ROTINA_BASE.diaria, { texto: 'Importar OFX e conciliar o dia', rota: '/conciliacao', licaoId: 'fin-ofx' }, { texto: 'Liquidar os títulos do dia com evidência', rota: '/pagar', licaoId: 'fin-liquidar' }, { texto: 'Conferir a posição diária contra o extrato', rota: '/posicao', licaoId: 'fin-posicao' }, { texto: 'Aprovar a etapa Financeiro das solicitações', rota: '/aprovacoes', licaoId: 'fin-aprovacao' }],
    semanal: [{ texto: 'Vencidos a pagar e a receber: renegociar ou cobrar', rota: '/receber', licaoId: 'fin-receber' }, { texto: 'Fluxo 13 semanas: programar pagamentos pelo menor saldo', rota: '/fluxo13', licaoId: 'fin-posicao' }, { texto: 'Faturar eventos de medição aprovados', rota: '/receber', licaoId: 'fin-receber' }],
    mensal: [{ texto: 'Checks e fechamento do período', rota: '/checks', licaoId: 'fin-fechamento' }, { texto: 'Parcelas de dívidas e saldos de abertura conferidos', rota: '/dividas', licaoId: 'fin-dividas' }],
  },
  'Gestor de obra': {
    diaria: [...ROTINA_BASE.diaria, { texto: 'Fechar o diário do dia (presença, horas, ocorrências)', rota: '/campo', licaoId: 'eq-apontamento-diario' }, { texto: 'Conferir os apontamentos de estação e romaneios do dia', rota: '/producao', licaoId: 'fab-apontar-estacao' }, { texto: 'Aprovar a etapa Gestor das solicitações da obra', rota: '/aprovacoes', licaoId: 'fin-aprovacao' }],
    semanal: [{ texto: 'Boletins de medição dos serviços da semana', rota: '/obras', licaoId: 'obra-medicao-fisica' }, { texto: 'Demandas e tarefas atrasadas', rota: '/central', licaoId: 'obra-demandas' }, { texto: 'Obra 360: comprometido, orçamento disponível, ETC', rota: '/obras', licaoId: 'base-obra360' }],
    mensal: [{ texto: 'Eventos de medição: medir, documentar e enviar à fiscalização', rota: '/obras', licaoId: 'obra-medicoes-cliente' }, { texto: 'Revisar ETC e prazo contratual', rota: '/obras', licaoId: 'base-obra360' }],
  },
  Engenharia: {
    diaria: [...ROTINA_BASE.diaria, { texto: 'Liberar conjuntos e ordens para a fábrica', rota: '/obras', licaoId: 'obra-materiais' }],
    semanal: [{ texto: 'Reimportar lista de materiais quando houver revisão', rota: '/obras', licaoId: 'obra-materiais' }, { texto: 'Produtividade por estação: ajustar índices das composições', rota: '/producao', licaoId: 'fab-produtividade' }, { texto: 'Rastreabilidade das corridas consumidas na semana', rota: '/estoque', licaoId: 'est-rastreio' }],
    mensal: [{ texto: 'Revisar preços e coeficientes do catálogo', rota: '/orcamentos', licaoId: 'eng-composicoes' }, { texto: 'Orçado × realizado por serviço', rota: '/obras', licaoId: 'obra-servicos' }],
  },
  Compras: {
    diaria: [...ROTINA_BASE.diaria, { texto: 'Emitir pedidos aprovados e registrar recebimentos', rota: '/compras', licaoId: 'comp-receber' }, { texto: 'Entrada de aço no estoque com corrida', rota: '/estoque', licaoId: 'est-entrada' }],
    semanal: [{ texto: 'Orçado × comprado: insumos classe A', rota: '/compras', licaoId: 'comp-comparativo' }, { texto: 'Itens abaixo do estoque mínimo', rota: '/estoque', licaoId: 'est-entrada' }],
    mensal: [{ texto: 'Preços pagos levados ao catálogo', rota: '/orcamentos', licaoId: 'eng-composicoes' }],
  },
  Contabilidade: {
    diaria: [...ROTINA_BASE.diaria],
    semanal: [{ texto: 'Lançamentos sem categoria ou competência', rota: '/checks', licaoId: 'fin-fechamento' }],
    mensal: [{ texto: 'DRE por competência conferido', rota: '/dre', licaoId: 'ctb-dre' }, { texto: 'Auditoria de estornos e cancelamentos do mês', rota: '/auditoria', licaoId: 'aud-auditoria' }],
  },
  Auditoria: {
    diaria: [],
    semanal: [{ texto: 'Amostra da trilha de auditoria', rota: '/auditoria', licaoId: 'aud-auditoria' }],
    mensal: [{ texto: 'Fechamento: divergências justificadas e reaberturas', rota: '/checks', licaoId: 'fin-fechamento' }, { texto: 'Conciliação completa das contas', rota: '/conciliacao', licaoId: 'fin-ofx' }],
  },
};

// ---------------------------------------------------------------------------
// Progresso
// ---------------------------------------------------------------------------
export interface ProgressoUsuario { usuario: Usuario; total: number; concluidas: number; pct: number; minutosRestantes: number; proxima?: Licao; ultima?: string; porArea: { area: AreaLicao; total: number; concluidas: number }[] }

export function progressoDe(usuario: Usuario, treinamentos: Treinamento[], papel: Papel = usuario.papel): ProgressoUsuario {
  const trilha = trilhaDe(papel);
  const feitas = new Set(treinamentos.filter((t) => t.usuarioId === usuario.id).map((t) => t.licaoId));
  const concluidas = trilha.filter((l) => feitas.has(l.id));
  const areas = new Map<AreaLicao, { area: AreaLicao; total: number; concluidas: number }>();
  for (const l of trilha) { const a = areas.get(l.area) ?? { area: l.area, total: 0, concluidas: 0 }; a.total++; if (feitas.has(l.id)) a.concluidas++; areas.set(l.area, a); }
  const ultima = treinamentos.filter((t) => t.usuarioId === usuario.id).map((t) => t.concluidoEm).sort().pop();
  return { usuario, total: trilha.length, concluidas: concluidas.length, pct: trilha.length ? concluidas.length / trilha.length : 0, minutosRestantes: trilha.filter((l) => !feitas.has(l.id)).reduce((s, l) => s + l.minutos, 0), proxima: trilha.find((l) => !feitas.has(l.id)), ultima, porArea: [...areas.values()] };
}

export const progressoEquipe = (usuarios: Usuario[], treinamentos: Treinamento[]) => usuarios.filter((u) => u.ativo).map((u) => progressoDe(u, treinamentos)).sort((a, b) => b.pct - a.pct || a.usuario.nome.localeCompare(b.usuario.nome));

/** Rotas conhecidas do app, para validar o conteudo nos testes. */
export const ROTAS_APP = ['/', '/inbox', '/central', '/obras', '/orcamentos', '/compras', '/producao', '/estoque', '/equipe', '/campo', '/pagar', '/receber', '/lancamentos', '/aprovacoes', '/posicao', '/fluxo13', '/fluxo24', '/conciliacao', '/dividas', '/dre', '/checks', '/cadastros', '/auditoria', '/capacitacao'];
