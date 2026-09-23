// EIFF Inbox: dados de EXEMPLO para o modo local. Tudo ficticio: pessoas, empresas e numeros nao existem.
// Nunca entra no banco: no modo remoto o slice vem das tabelas inbox_* (migration 0056) e `inboxCarregarExemplo` e recusado.
// As datas sao relativas a `agoraIso` para que SLA, ordem de trabalho e caixas facam sentido em qualquer dia.
import { CONFIGURACAO_PADRAO, SETORES_PADRAO, type Atribuicao, type ContatoInbox, type Equipe, type InboxAction, type InboxDataset, type InboxJob, type InboxMessage, type InboxThread, type MembroSetor, type Setor, type ThreadEvent } from './tipos';
import { slaDe } from './roteamento';

const OBRA = 'OB-SF-CL-01';
const RESPONSAVEL_PADRAO: Record<string, string> = { FINANCEIRO: 'u-fin', OBRAS: 'u-obra', COMPRAS: 'u-compras', ENGENHARIA: 'u-eng', COMERCIAL: 'u-augusto', FORNECEDORES: 'u-compras', ADMINISTRATIVO: 'u-admin', DIRETORIA: 'u-augusto', POS_VENDA: 'u-obra', SISTEMA: 'u-admin', FACTORY: 'u-admin' };

export const EQUIPES_SEED: Equipe[] = [
  { id: 'EQP-00001', setorCodigo: 'FINANCEIRO', nome: 'Contas a pagar', ativo: true, ordem: 1, responsavelPadraoId: 'u-fin' },
  { id: 'EQP-00002', setorCodigo: 'FINANCEIRO', nome: 'Faturamento', ativo: true, ordem: 2 },
  { id: 'EQP-00003', setorCodigo: 'OBRAS', nome: 'Canteiro Smart Fit', ativo: true, ordem: 1, responsavelPadraoId: 'u-obra' },
];

export const MEMBROS_SEED: MembroSetor[] = [
  { id: 'MBR-00001', usuarioId: 'u-fin', setorCodigo: 'FINANCEIRO', equipeId: 'EQP-00001', papel: 'gestor' },
  { id: 'MBR-00002', usuarioId: 'u-contab', setorCodigo: 'FINANCEIRO', equipeId: 'EQP-00002', papel: 'atendente' },
  { id: 'MBR-00003', usuarioId: 'u-obra', setorCodigo: 'OBRAS', equipeId: 'EQP-00003', papel: 'gestor' },
  { id: 'MBR-00004', usuarioId: 'u-obra', setorCodigo: 'POS_VENDA', papel: 'gestor' },
  { id: 'MBR-00005', usuarioId: 'u-eng', setorCodigo: 'OBRAS', equipeId: 'EQP-00003', papel: 'atendente' },
  { id: 'MBR-00006', usuarioId: 'u-eng', setorCodigo: 'ENGENHARIA', papel: 'gestor' },
  { id: 'MBR-00007', usuarioId: 'u-compras', setorCodigo: 'COMPRAS', papel: 'gestor' },
  { id: 'MBR-00008', usuarioId: 'u-compras', setorCodigo: 'FORNECEDORES', papel: 'gestor' },
  { id: 'MBR-00009', usuarioId: 'u-augusto', setorCodigo: 'COMERCIAL', papel: 'gestor' },
  { id: 'MBR-00010', usuarioId: 'u-augusto', setorCodigo: 'DIRETORIA', papel: 'gestor' },
  { id: 'MBR-00011', usuarioId: 'u-admin', setorCodigo: 'ADMINISTRATIVO', papel: 'gestor' },
  { id: 'MBR-00012', usuarioId: 'u-admin', setorCodigo: 'SISTEMA', papel: 'gestor' },
];

export const NOME_USUARIO_SEED: Record<string, string> = { 'u-augusto': 'Augusto Macedo', 'u-admin': 'Administrador', 'u-fin': 'Financeiro EIFF', 'u-obra': 'Gestor Smart Fit', 'u-eng': 'Engenharia', 'u-compras': 'Compras', 'u-contab': 'Contabilidade', 'u-audit': 'Auditoria' };

export function seedInbox(agoraIso: string): InboxDataset {
  const agora = new Date(agoraIso).getTime();
  const h = (horas: number) => new Date(agora - horas * 3_600_000).toISOString();
  const setores: Setor[] = SETORES_PADRAO.map((s) => ({ ...s, responsavelPadraoId: RESPONSAVEL_PADRAO[s.codigo] }));
  const cfg = CONFIGURACAO_PADRAO;

  const contatos: ContatoInbox[] = [
    { id: 'CTI-00001', nome: 'Paulo Nogueira', empresaNome: 'Aços do Cerrado Ltda', tipoRelacao: 'fornecedor', identidades: [{ canal: 'WHATSAPP', identificador: '5562900000101', nomeInformado: 'Paulo Aços', verificada: false }], obras: [OBRA], criadoEm: h(400) },
    { id: 'CTI-00002', nome: 'Cláudia Ramos', empresaNome: 'Rota Sul Transportes', tipoRelacao: 'prestador', identidades: [{ canal: 'WHATSAPP', identificador: '5562900000102', nomeInformado: 'Cláudia Rota Sul', verificada: false }], obras: [OBRA], criadoEm: h(300) },
    { id: 'CTI-00003', nome: 'Renata Campos', empresaNome: 'Construtora Horizonte Norte', tipoRelacao: 'cliente', identidades: [{ canal: 'WHATSAPP', identificador: '5562900000103', verificada: true }, { canal: 'EMAIL', identificador: 'renata.campos@horizontenorte.exemplo', verificada: true }], obras: [OBRA], observacoes: 'Fiscal da obra pelo cliente. Prefere WhatsApp em horário comercial.', criadoEm: h(900) },
    { id: 'CTI-00004', nome: 'Fernando Duarte', empresaNome: 'Anápolis Log Galpões', tipoRelacao: 'lead', identidades: [{ canal: 'EMAIL', identificador: 'fernando@anapolislog.exemplo', verificada: false }], obras: [], criadoEm: h(20) },
    { id: 'CTI-00005', nome: 'Jorge Lima', empresaNome: 'EIFF (montagem)', tipoRelacao: 'colaborador', identidades: [{ canal: 'WHATSAPP', identificador: '5562900000105', nomeInformado: 'Jorge Montagem', verificada: true }], obras: [OBRA], criadoEm: h(1200) },
    { id: 'CTI-00006', nome: 'Financeiro EIFF', tipoRelacao: 'colaborador', usuarioId: 'u-fin', identidades: [{ canal: 'SISTEMA', identificador: 'u-fin', verificada: true }], obras: [], criadoEm: h(1200) },
    { id: 'CTI-00007', nome: 'Contato não identificado', tipoRelacao: 'desconhecido', identidades: [{ canal: 'WHATSAPP', identificador: '5562900000107', nomeInformado: 'Beto', verificada: false }], obras: [], criadoEm: h(1) },
    { id: 'CTI-00008', nome: 'Sr. Aparecido', empresaNome: 'Pinturas Goiás', tipoRelacao: 'fornecedor', identidades: [{ canal: 'WHATSAPP', identificador: '5562900000108', nomeInformado: 'Aparecido Pinturas', verificada: false }], obras: [], criadoEm: h(48) },
    { id: 'CTI-00009', nome: 'Dra. Lívia Prado', empresaNome: 'Construtora Horizonte Norte (jurídico)', tipoRelacao: 'cliente', identidades: [{ canal: 'EMAIL', identificador: 'juridico@horizontenorte.exemplo', verificada: false }], obras: [OBRA], criadoEm: h(6) },
  ];

  const threads: InboxThread[] = [];
  const mensagens: InboxMessage[] = [];
  const eventos: ThreadEvent[] = [];
  const atribuicoes: Atribuicao[] = [];
  const acoes: InboxAction[] = [];
  const jobs: InboxJob[] = [];
  let nMsg = 0; let nEvt = 0; let nAtr = 0;
  const sistema = { tipo: 'sistema' as const, nome: 'Inbox' };
  const usuario = (id: string) => ({ tipo: 'usuario' as const, id, nome: NOME_USUARIO_SEED[id] ?? id });
  const contato = (id: string) => { const c = contatos.find((x) => x.id === id)!; return { tipo: 'contato' as const, id, nome: c.nome }; };
  const msg = (m: Omit<InboxMessage, 'id' | 'anexos' | 'provider'> & { anexos?: InboxMessage['anexos'] }): InboxMessage => { const x: InboxMessage = { anexos: [], provider: 'MANUAL', ...m, id: `MSG-${String(++nMsg).padStart(5, '0')}` }; mensagens.push(x); return x; };
  const evt = (e: Omit<ThreadEvent, 'id'>) => { eventos.push({ ...e, id: `EVT-${String(++nEvt).padStart(5, '0')}` }); };
  const atr = (a: Omit<Atribuicao, 'id'>) => { atribuicoes.push({ ...a, id: `ATR-${String(++nAtr).padStart(5, '0')}` }); };

  // T1 — fornecedor pergunta pela NF 583: classificada, roteada ao Financeiro, atribuida, ainda sem resposta (SLA no prazo); IA sugeriu resposta
  const t1: InboxThread = {
    id: 'THR-00001', canal: 'WHATSAPP', provider: 'MANUAL', contexto: 'EXTERNAL', contatoId: 'CTI-00001', assunto: 'Pagamento da NF 583', status: 'ATRIBUIDA', prioridade: 'Normal', nivel: 'B',
    setorCodigo: 'FINANCEIRO', equipeId: 'EQP-00001', responsavelId: 'u-fin', participantes: ['u-fin'], codigoObra: OBRA, labels: ['nota fiscal'], origem: 'MANUAL',
    classificacao: { intencao: 'consultar_pagamento', assunto: 'Pagamento de nota fiscal', entidades: [{ tipo: 'nota_fiscal', valor: 'NF 583', mensagemId: 'MSG-00001' }, { tipo: 'obra', valor: OBRA }], setorRecomendado: 'FINANCEIRO', prioridadeRecomendada: 'Normal', nivelRecomendado: 'B', acaoSugerida: 'consultar previsão de pagamento no contas a pagar', confianca: 0.92, sinais: ['menciona número de NF', 'contato é fornecedor da obra', 'pergunta sobre liberação de pagamento'], motivoOperacional: 'fornecedor da obra pergunta por pagamento de NF', evidencias: [{ mensagemId: 'MSG-00001', trecho: 'NF 583 já está liberada para pagamento' }], provedor: 'SEED', versao: 'exemplo-1', em: h(3) },
    resumo: 'Fornecedor de aço pergunta se a NF 583 (obra Smart Fit) já foi liberada para pagamento.',
    sla: { primeiraRespostaAte: slaDe(cfg, 'Normal', h(3)) }, abertaEm: h(3), ultimaMensagemEm: h(3), ultimaInboundEm: h(3),
  };
  threads.push(t1);
  msg({ threadId: t1.id, direcao: 'inbound', tipo: 'texto', autor: contato('CTI-00001'), texto: 'Bom dia, preciso saber se a NF 583 já está liberada para pagamento.', em: h(3), externalMessageId: 'wamid.exemplo.0001' });
  evt({ threadId: t1.id, tipo: 'THREAD_CREATED', em: h(3), ator: sistema, detalhe: 'conversa aberta por whatsapp (EXTERNAL)' });
  evt({ threadId: t1.id, tipo: 'AI_ANALYZED', em: h(3), ator: { tipo: 'ia', nome: 'Exemplo' }, detalhe: 'intenção consultar_pagamento · confiança 92%' });
  evt({ threadId: t1.id, tipo: 'ROUTED', em: h(3), ator: sistema, detalhe: 'regra ROT-02: pagamento e cobrança → Financeiro; nível B: resposta com compromisso' });
  evt({ threadId: t1.id, tipo: 'ASSIGNED', em: h(3), ator: sistema, detalhe: 'responsável padrão do setor', depois: 'u-fin' });
  atr({ threadId: t1.id, setorCodigo: 'FINANCEIRO', equipeId: 'EQP-00001', usuarioId: 'u-fin', atribuidaEm: h(3), origem: 'roteamento' });
  acoes.push({ id: 'ACT-00001', threadId: t1.id, tipo: 'responder', titulo: 'Sugestão de resposta', descricao: 'Olá, Paulo. Localizei a NF 583 no nosso contas a pagar da obra Smart Fit. Vou confirmar a data programada com o Financeiro e retorno por aqui ainda hoje.', parametros: {}, estado: 'proposta', aprovacao: { exigida: true, papelDecisor: 'Financeiro' }, propostaPor: { tipo: 'ia', nome: 'Exemplo' }, criadaEm: h(3) });

  // T2 — transportadora confirma descarga: Obras respondeu (rascunho registrado), aguardando o contato
  const t2: InboxThread = {
    id: 'THR-00002', canal: 'WHATSAPP', provider: 'MANUAL', contexto: 'EXTERNAL', contatoId: 'CTI-00002', assunto: 'Descarga da estrutura amanhã às 8h', status: 'AGUARDANDO_CONTATO', prioridade: 'Alta', nivel: 'B',
    setorCodigo: 'OBRAS', equipeId: 'EQP-00003', responsavelId: 'u-obra', participantes: ['u-obra'], codigoObra: OBRA, labels: ['logística'], origem: 'MANUAL',
    classificacao: { intencao: 'logistica_entrega', assunto: 'Logística de obra', entidades: [{ tipo: 'data', valor: 'amanhã 8h' }, { tipo: 'obra', valor: OBRA }], setorRecomendado: 'OBRAS', prioridadeRecomendada: 'Alta', nivelRecomendado: 'B', confianca: 0.88, sinais: ['fala em chegada de estrutura', 'pede horário de descarga', 'contato é transportadora da obra'], evidencias: [{ mensagemId: 'MSG-00002', trecho: 'A estrutura chega amanhã. Conseguimos descarregar às 8h?' }], provedor: 'SEED', versao: 'exemplo-1', em: h(5) },
    resumo: 'Transportadora avisa que a estrutura chega amanhã e pede confirmação de descarga às 8h.',
    sla: { primeiraRespostaAte: slaDe(cfg, 'Alta', h(5)), primeiraRespostaEm: h(4) }, abertaEm: h(5), ultimaMensagemEm: h(4), ultimaInboundEm: h(5),
  };
  threads.push(t2);
  msg({ threadId: t2.id, direcao: 'inbound', tipo: 'texto', autor: contato('CTI-00002'), texto: 'A estrutura chega amanhã. Conseguimos descarregar às 8h?', em: h(5), externalMessageId: 'wamid.exemplo.0002' });
  msg({ threadId: t2.id, direcao: 'outbound', tipo: 'texto', autor: usuario('u-obra'), texto: 'Bom dia, Cláudia. Confirmado 8h no portão 2; o guindaste já está reservado. Me avise quando o caminhão sair.', em: h(4), entrega: 'registrada' });
  evt({ threadId: t2.id, tipo: 'THREAD_CREATED', em: h(5), ator: sistema, detalhe: 'conversa aberta por whatsapp (EXTERNAL)' });
  evt({ threadId: t2.id, tipo: 'ROUTED', em: h(5), ator: sistema, detalhe: 'regra ROT-03: operação da obra → Obras / Operações · prioridade Alta' });
  evt({ threadId: t2.id, tipo: 'MESSAGE_REGISTERED', em: h(4), ator: usuario('u-obra'), detalhe: 'rascunho de resposta registrado (canal não conectado: nada foi enviado)' });
  evt({ threadId: t2.id, tipo: 'STATUS_CHANGED', em: h(4), ator: usuario('u-obra'), detalhe: 'aguardando confirmação da transportadora', antes: 'EM_ATENDIMENTO', depois: 'AGUARDANDO_CONTATO' });
  atr({ threadId: t2.id, setorCodigo: 'OBRAS', equipeId: 'EQP-00003', usuarioId: 'u-obra', atribuidaEm: h(5), origem: 'roteamento' });

  // T3 — cliente pede revisao de projeto: Engenharia propos criar job; aguarda aprovacao da Diretoria
  const t3: InboxThread = {
    id: 'THR-00003', canal: 'WHATSAPP', provider: 'MANUAL', contexto: 'EXTERNAL', contatoId: 'CTI-00003', assunto: 'Revisão do projeto R02 e impacto no orçamento', status: 'AGUARDANDO_APROVACAO', prioridade: 'Alta', nivel: 'B',
    setorCodigo: 'ENGENHARIA', responsavelId: 'u-eng', participantes: ['u-eng'], codigoObra: OBRA, labels: ['projeto', 'orçamento'], origem: 'MANUAL',
    classificacao: { intencao: 'revisao_projeto', assunto: 'Revisão de projeto com impacto financeiro', entidades: [{ tipo: 'documento', valor: 'projeto R02' }, { tipo: 'data', valor: 'sexta-feira' }], setorRecomendado: 'ENGENHARIA', prioridadeRecomendada: 'Alta', nivelRecomendado: 'B', acaoSugerida: 'abrir revisão técnica e medir impacto no orçamento executivo', confianca: 0.85, sinais: ['pede revisão de projeto', 'cita impacto no orçamento', 'tem prazo'], evidencias: [{ mensagemId: 'MSG-00004', trecho: 'revisar o novo projeto e verificar impacto no orçamento' }], provedor: 'SEED', versao: 'exemplo-1', em: h(30) },
    resumo: 'Cliente pede revisão do projeto R02 com análise de impacto no orçamento até sexta.',
    sla: { primeiraRespostaAte: slaDe(cfg, 'Alta', h(30)), primeiraRespostaEm: h(28) }, abertaEm: h(30), ultimaMensagemEm: h(28), ultimaInboundEm: h(30),
  };
  threads.push(t3);
  msg({ threadId: t3.id, direcao: 'inbound', tipo: 'texto', autor: contato('CTI-00003'), texto: 'Precisamos revisar o novo projeto (R02) e verificar impacto no orçamento. Conseguem até sexta?', em: h(30), externalMessageId: 'wamid.exemplo.0003' });
  msg({ threadId: t3.id, direcao: 'outbound', tipo: 'texto', autor: usuario('u-eng'), texto: 'Renata, recebido. Vou abrir a revisão da R02 e te retorno com o impacto no orçamento antes de sexta.', em: h(28), entrega: 'registrada' });
  msg({ threadId: t3.id, direcao: 'interna', tipo: 'nota', autor: usuario('u-eng'), texto: 'A R02 muda as terças da cobertura. Precisa de aval da Diretoria para abrir revisão com impacto no contrato.', em: h(27) });
  evt({ threadId: t3.id, tipo: 'THREAD_CREATED', em: h(30), ator: sistema, detalhe: 'conversa aberta por whatsapp (EXTERNAL)' });
  evt({ threadId: t3.id, tipo: 'ROUTED', em: h(30), ator: sistema, detalhe: 'regra ROT-06: projeto e engenharia → Engenharia' });
  evt({ threadId: t3.id, tipo: 'ACTION_PROPOSED', em: h(27), ator: usuario('u-eng'), detalhe: 'ação proposta: revisar projeto R02 e medir impacto no orçamento (aguarda Diretoria)' });
  evt({ threadId: t3.id, tipo: 'STATUS_CHANGED', em: h(27), ator: usuario('u-eng'), detalhe: 'aguardando aprovação da Diretoria', antes: 'EM_ATENDIMENTO', depois: 'AGUARDANDO_APROVACAO' });
  atr({ threadId: t3.id, setorCodigo: 'ENGENHARIA', usuarioId: 'u-eng', atribuidaEm: h(30), origem: 'roteamento' });
  acoes.push({ id: 'ACT-00002', threadId: t3.id, tipo: 'criar_job', titulo: 'Revisar projeto R02 e medir impacto no orçamento', descricao: 'Abrir revisão técnica da R02 (terças da cobertura) e apontar impacto no orçamento executivo contratado da obra.', parametros: { obra: OBRA, prazo: 'sexta-feira' }, estado: 'aguardando_aprovacao', aprovacao: { exigida: true, papelDecisor: 'Diretoria' }, propostaPor: usuario('u-eng'), criadaEm: h(27) });

  // T4 — lead por e-mail: atribuida ao Comercial, SLA vencendo (aberta ha 20 h de um SLA de 24 h)
  const t4: InboxThread = {
    id: 'THR-00004', canal: 'EMAIL', provider: 'MANUAL', contexto: 'EXTERNAL', contatoId: 'CTI-00004', assunto: 'Orçamento de galpão logístico 2.400 m² em Anápolis', status: 'ATRIBUIDA', prioridade: 'Normal', nivel: 'B',
    setorCodigo: 'COMERCIAL', responsavelId: 'u-augusto', participantes: ['u-augusto'], labels: ['lead'], origem: 'MANUAL',
    classificacao: { intencao: 'solicitar_orcamento', assunto: 'Solicitação de orçamento', entidades: [{ tipo: 'outro', valor: '2.400 m²' }, { tipo: 'outro', valor: 'Anápolis' }], setorRecomendado: 'COMERCIAL', prioridadeRecomendada: 'Normal', nivelRecomendado: 'B', acaoSugerida: 'qualificar e registrar oportunidade no Radar', confianca: 0.9, sinais: ['pede orçamento', 'informa área e cidade', 'contato não consta no Radar'], evidencias: [{ mensagemId: 'MSG-00007', trecho: 'orçamento para um galpão logístico de 2.400 m²' }], provedor: 'SEED', versao: 'exemplo-1', em: h(20) },
    resumo: 'Lead pede orçamento de galpão logístico de 2.400 m² em Anápolis; sem cadastro no Radar.',
    sla: { primeiraRespostaAte: slaDe(cfg, 'Normal', h(20)) }, abertaEm: h(20), ultimaMensagemEm: h(20), ultimaInboundEm: h(20),
  };
  threads.push(t4);
  msg({ threadId: t4.id, direcao: 'inbound', tipo: 'texto', autor: contato('CTI-00004'), texto: 'Boa tarde. Gostaria de um orçamento para um galpão logístico de 2.400 m² em Anápolis, estrutura metálica com cobertura. Podem me retornar?', em: h(20), externalMessageId: 'email.exemplo.0004' });
  evt({ threadId: t4.id, tipo: 'THREAD_CREATED', em: h(20), ator: sistema, detalhe: 'conversa aberta por email (EXTERNAL)' });
  evt({ threadId: t4.id, tipo: 'ROUTED', em: h(20), ator: sistema, detalhe: 'regra ROT-05: oportunidade comercial → Comercial' });
  atr({ threadId: t4.id, setorCodigo: 'COMERCIAL', usuarioId: 'u-augusto', atribuidaEm: h(20), origem: 'roteamento' });

  // T5 — colaborador em campo (INTERNAL): lote errado, urgente, Compras criou tarefa
  const t5: InboxThread = {
    id: 'THR-00005', canal: 'WHATSAPP', provider: 'MANUAL', contexto: 'INTERNAL', contatoId: 'CTI-00005', assunto: 'Lote de parafusos errado na obra (M16 em vez de M20)', status: 'EM_ATENDIMENTO', prioridade: 'Urgente', nivel: 'C',
    setorCodigo: 'COMPRAS', responsavelId: 'u-compras', participantes: ['u-compras', 'u-obra'], codigoObra: OBRA, labels: ['suprimentos', 'campo'], origem: 'MANUAL',
    classificacao: { intencao: 'entrega_fornecedor', assunto: 'Divergência de material entregue', entidades: [{ tipo: 'outro', valor: 'parafusos M16 / M20' }, { tipo: 'obra', valor: OBRA }], setorRecomendado: 'COMPRAS', prioridadeRecomendada: 'Urgente', nivelRecomendado: 'C', acaoSugerida: 'conferir pedido de compra e acionar o fornecedor', confianca: 0.87, sinais: ['colaborador verificado em campo', 'material errado bloqueia montagem', 'pede confirmação da fábrica'], evidencias: [{ mensagemId: 'MSG-00008', trecho: 'lote de parafusos errado, M16 em vez de M20' }], provedor: 'SEED', versao: 'exemplo-1', em: h(2) },
    resumo: 'Montador avisa que chegou lote de parafusos M16 no lugar de M20; montagem parada até a troca.',
    sla: { primeiraRespostaAte: slaDe(cfg, 'Urgente', h(2)), primeiraRespostaEm: h(1.5) }, abertaEm: h(2), ultimaMensagemEm: h(1), ultimaInboundEm: h(1),
  };
  threads.push(t5);
  msg({ threadId: t5.id, direcao: 'inbound', tipo: 'texto', autor: contato('CTI-00005'), texto: 'Chegou o lote de parafusos errado, M16 em vez de M20. Fábrica confirma o que foi pedido? Montagem do eixo 3 parada.', em: h(2), externalMessageId: 'wamid.exemplo.0005' });
  msg({ threadId: t5.id, direcao: 'outbound', tipo: 'texto', autor: usuario('u-compras'), texto: 'Jorge, o pedido era M20. Já acionei o fornecedor para trocar hoje; segura o lote separado para a coleta.', em: h(1.5), entrega: 'registrada' });
  msg({ threadId: t5.id, direcao: 'inbound', tipo: 'imagem', autor: contato('CTI-00005'), texto: 'Foto da etiqueta do lote.', anexos: [{ nome: 'etiqueta-lote.jpg', tipo: 'image/jpeg', tamanhoBytes: 412_000 }], em: h(1), externalMessageId: 'wamid.exemplo.0006' });
  evt({ threadId: t5.id, tipo: 'THREAD_CREATED', em: h(2), ator: sistema, detalhe: 'conversa aberta por whatsapp (INTERNAL)' });
  evt({ threadId: t5.id, tipo: 'ROUTED', em: h(2), ator: sistema, detalhe: 'regra ROT-04: suprimentos → Compras · prioridade Urgente' });
  evt({ threadId: t5.id, tipo: 'ACTION_EXECUTED', em: h(1.5), ator: usuario('u-compras'), detalhe: 'tarefa criada no EIFF Control: trocar lote de parafusos (TSK exemplo)' });
  atr({ threadId: t5.id, setorCodigo: 'COMPRAS', usuarioId: 'u-compras', atribuidaEm: h(2), origem: 'roteamento' });
  acoes.push({ id: 'ACT-00003', threadId: t5.id, tipo: 'criar_tarefa', titulo: 'Trocar lote de parafusos M16 por M20', descricao: 'Acionar o fornecedor, coletar o lote errado e entregar M20 na obra hoje.', parametros: { obra: OBRA, prioridade: 'Alta' }, estado: 'executada', aprovacao: { exigida: false }, propostaPor: usuario('u-compras'), criadaEm: h(1.5), executadaEm: h(1.5), referencia: 'TSK-exemplo' });

  // T6 — pedido interno de sistema (canal SISTEMA): acao aprovada virou job MANUAL, aguardando execucao
  const t6: InboxThread = {
    id: 'THR-00006', canal: 'SISTEMA', provider: 'MANUAL', contexto: 'INTERNAL', contatoId: 'CTI-00006', assunto: 'Exportação CSV da aba Alocações não funciona', status: 'AGUARDANDO_INTERNO', prioridade: 'Normal', nivel: 'C',
    setorCodigo: 'SISTEMA', responsavelId: 'u-admin', participantes: ['u-admin'], labels: ['sistema'], origem: 'MANUAL',
    classificacao: { intencao: 'defeito_sistema', assunto: 'Defeito no EIFF Control', entidades: [{ tipo: 'outro', valor: 'Cadastros › Alocações' }], setorRecomendado: 'SISTEMA', prioridadeRecomendada: 'Normal', nivelRecomendado: 'C', acaoSugerida: 'abrir job de correção', confianca: 0.95, sinais: ['usuário interno verificado', 'descreve tela e comportamento', 'reproduzível'], evidencias: [{ mensagemId: 'MSG-00010', trecho: 'botão Exportar CSV da aba Alocações não faz nada' }], provedor: 'SEED', versao: 'exemplo-1', em: h(50) },
    resumo: 'Financeiro relata que o botão Exportar CSV da aba Alocações não responde.',
    sla: { primeiraRespostaAte: slaDe(cfg, 'Normal', h(50)), primeiraRespostaEm: h(49) }, abertaEm: h(50), ultimaMensagemEm: h(49), ultimaInboundEm: h(50),
  };
  threads.push(t6);
  msg({ threadId: t6.id, direcao: 'inbound', tipo: 'texto', autor: contato('CTI-00006'), texto: 'O botão Exportar CSV da aba Alocações não faz nada no Chrome. Nas outras abas funciona.', em: h(50), externalMessageId: 'sistema.exemplo.0007' });
  msg({ threadId: t6.id, direcao: 'outbound', tipo: 'texto', autor: usuario('u-admin'), texto: 'Registrado. Abri um job de correção; te aviso quando estiver no ar.', em: h(49), entrega: 'registrada' });
  evt({ threadId: t6.id, tipo: 'THREAD_CREATED', em: h(50), ator: sistema, detalhe: 'conversa aberta por sistema (INTERNAL)' });
  evt({ threadId: t6.id, tipo: 'ACTION_APPROVED', em: h(49), ator: usuario('u-admin'), detalhe: 'ação aprovada: criar job de correção' });
  evt({ threadId: t6.id, tipo: 'JOB_CREATED', em: h(49), ator: sistema, detalhe: 'job JOB-00001 enviado ao provider MANUAL (a Factory ainda não recebe jobs do Inbox)' });
  atr({ threadId: t6.id, setorCodigo: 'SISTEMA', usuarioId: 'u-admin', atribuidaEm: h(50), origem: 'roteamento' });
  acoes.push({ id: 'ACT-00004', threadId: t6.id, tipo: 'criar_job', titulo: 'Corrigir exportação CSV da aba Alocações', descricao: 'A prop csv da Tabela não está ligada na aba Alocações de Cadastros.', parametros: { tela: 'Cadastros › Alocações' }, estado: 'executada', aprovacao: { exigida: true, papelDecisor: 'Administrador', decisao: 'aprovada', decididaPor: 'u-admin', decididaEm: h(49), motivo: 'defeito reproduzível' }, propostaPor: usuario('u-admin'), criadaEm: h(49), executadaEm: h(49), jobId: 'JOB-00001' });
  jobs.push({ id: 'JOB-00001', threadId: t6.id, acaoId: 'ACT-00004', titulo: 'Corrigir exportação CSV da aba Alocações', objetivo: 'O botão Exportar CSV da aba Alocações exporta as linhas filtradas e ordenadas, como em Radar · Empresas.', contexto: ['CLAUDE.md § Bloco 5 de UX (exportação CSV)', 'src/screens/Cadastros.tsx (aba Alocações)', 'src/ui/Tabela.tsx (prop csv)'], criteriosAceite: ['Exportar CSV funciona na aba Alocações', 'Nenhuma outra tela muda de comportamento'], provider: 'MANUAL', estado: 'ENVIADO', criadoEm: h(49), criadoPor: 'u-admin' });

  // T7 — contato desconhecido, sem classificacao: triagem humana pendente (o que "IA indisponivel" produz)
  const t7: InboxThread = {
    id: 'THR-00007', canal: 'WHATSAPP', provider: 'MANUAL', contexto: 'EXTERNAL', contatoId: 'CTI-00007', assunto: 'Boa tarde, vocês fazem mezanino metálico para loja? Qual o prazo?', status: 'NOVA', prioridade: 'Normal', nivel: 'C',
    participantes: [], labels: [], origem: 'MANUAL', sla: { primeiraRespostaAte: slaDe(cfg, 'Normal', h(1)) }, abertaEm: h(1), ultimaMensagemEm: h(1), ultimaInboundEm: h(1),
  };
  threads.push(t7);
  msg({ threadId: t7.id, direcao: 'inbound', tipo: 'texto', autor: contato('CTI-00007'), texto: 'Boa tarde, vocês fazem mezanino metálico para loja? Qual o prazo?', em: h(1), externalMessageId: 'wamid.exemplo.0008' });
  evt({ threadId: t7.id, tipo: 'THREAD_CREATED', em: h(1), ator: sistema, detalhe: 'conversa aberta por whatsapp (EXTERNAL) · contato não identificado · sem classificação: triagem humana' });

  // T8 — medicao aprovada pelo cliente: resolvida pelo Financeiro
  const t8: InboxThread = {
    id: 'THR-00008', canal: 'EMAIL', provider: 'MANUAL', contexto: 'EXTERNAL', contatoId: 'CTI-00003', assunto: 'Aprovação da medição 03', status: 'RESOLVIDA', prioridade: 'Normal', nivel: 'B',
    setorCodigo: 'FINANCEIRO', equipeId: 'EQP-00002', responsavelId: 'u-fin', participantes: ['u-fin'], codigoObra: OBRA, labels: ['medição'], origem: 'MANUAL',
    classificacao: { intencao: 'aprovacao_medicao', assunto: 'Aprovação de medição', entidades: [{ tipo: 'medicao', valor: 'medição 03' }, { tipo: 'obra', valor: OBRA }], setorRecomendado: 'FINANCEIRO', prioridadeRecomendada: 'Normal', nivelRecomendado: 'B', confianca: 0.93, sinais: ['anexo assinado', 'cita número da medição', 'cliente verificado'], evidencias: [{ mensagemId: 'MSG-00012', trecho: 'segue a planilha da medição 03 assinada' }], provedor: 'SEED', versao: 'exemplo-1', em: h(80) },
    resumo: 'Cliente envia a medição 03 assinada; faturamento pode seguir.',
    sla: { primeiraRespostaAte: slaDe(cfg, 'Normal', h(80)), primeiraRespostaEm: h(78) }, abertaEm: h(80), ultimaMensagemEm: h(78), ultimaInboundEm: h(80), resolvidaEm: h(78), resolvidaPor: 'humano',
  };
  threads.push(t8);
  msg({ threadId: t8.id, direcao: 'inbound', tipo: 'documento', autor: contato('CTI-00003'), texto: 'Boa tarde, segue a planilha da medição 03 assinada pela fiscalização.', anexos: [{ nome: 'medicao-03-assinada.pdf', tipo: 'application/pdf', tamanhoBytes: 1_200_000 }], em: h(80), externalMessageId: 'email.exemplo.0009' });
  msg({ threadId: t8.id, direcao: 'outbound', tipo: 'texto', autor: usuario('u-fin'), texto: 'Recebido, Renata. Medição 03 registrada; a nota segue no fluxo combinado. Obrigado!', em: h(78), entrega: 'registrada' });
  evt({ threadId: t8.id, tipo: 'THREAD_CREATED', em: h(80), ator: sistema, detalhe: 'conversa aberta por email (EXTERNAL)' });
  evt({ threadId: t8.id, tipo: 'RESOLVED', em: h(78), ator: usuario('u-fin'), detalhe: 'medição registrada no EIFF Control', antes: 'EM_ATENDIMENTO', depois: 'RESOLVIDA' });
  atr({ threadId: t8.id, setorCodigo: 'FINANCEIRO', equipeId: 'EQP-00002', usuarioId: 'u-fin', atribuidaEm: h(80), origem: 'roteamento' });

  // T9 — pergunta padronizada (nivel A): resolvida pela IA, como exemplo do que "Automatizados" mostra
  const t9: InboxThread = {
    id: 'THR-00009', canal: 'WHATSAPP', provider: 'MANUAL', contexto: 'EXTERNAL', contatoId: 'CTI-00008', assunto: 'Endereço da fábrica para entrega', status: 'RESOLVIDA', prioridade: 'Baixa', nivel: 'A',
    setorCodigo: 'FORNECEDORES', participantes: [], labels: ['automático'], origem: 'MANUAL',
    classificacao: { intencao: 'consultar_endereco', assunto: 'Endereço para entrega', entidades: [], setorRecomendado: 'FORNECEDORES', prioridadeRecomendada: 'Baixa', nivelRecomendado: 'A', confianca: 0.97, sinais: ['pergunta objetiva de endereço', 'resposta padronizada disponível'], evidencias: [{ mensagemId: 'MSG-00014', trecho: 'Qual o endereço da fábrica para entrega?' }], provedor: 'SEED', versao: 'exemplo-1', em: h(40) },
    resumo: 'Fornecedor de tinta pergunta o endereço da fábrica; respondido com a orientação padrão.',
    sla: { primeiraRespostaAte: slaDe(cfg, 'Baixa', h(40)), primeiraRespostaEm: h(40) }, abertaEm: h(40), ultimaMensagemEm: h(40), ultimaInboundEm: h(40), resolvidaEm: h(40), resolvidaPor: 'ia',
  };
  threads.push(t9);
  msg({ threadId: t9.id, direcao: 'inbound', tipo: 'texto', autor: contato('CTI-00008'), texto: 'Qual o endereço da fábrica para entrega?', em: h(40), externalMessageId: 'wamid.exemplo.0010' });
  msg({ threadId: t9.id, direcao: 'outbound', tipo: 'texto', autor: { tipo: 'ia', nome: 'Assistente EIFF' }, texto: 'Olá! A entrega é na fábrica da EIFF em Goiânia; enviei a localização e o horário de recebimento (segunda a sexta, 7h30 às 17h). Qualquer dúvida, é só chamar.', em: h(40), entrega: 'registrada' });
  evt({ threadId: t9.id, tipo: 'THREAD_CREATED', em: h(40), ator: sistema, detalhe: 'conversa aberta por whatsapp (EXTERNAL)' });
  evt({ threadId: t9.id, tipo: 'RESOLVED', em: h(40), ator: { tipo: 'ia', nome: 'Assistente EIFF' }, detalhe: 'nível A: respondido com orientação padrão', antes: 'TRIADA', depois: 'RESOLVIDA' });
  atr({ threadId: t9.id, setorCodigo: 'FORNECEDORES', atribuidaEm: h(40), origem: 'roteamento' });

  // T10 — tema juridico: setor sem responsavel padrao, SLA vencido -> Nao atribuidos + escalacao pendente
  const t10: InboxThread = {
    id: 'THR-00010', canal: 'EMAIL', provider: 'MANUAL', contexto: 'EXTERNAL', contatoId: 'CTI-00009', assunto: 'Notificação sobre reajuste contratual', status: 'TRIADA', prioridade: 'Alta', nivel: 'C',
    setorCodigo: 'JURIDICO', participantes: [], codigoObra: OBRA, labels: ['contrato'], origem: 'MANUAL',
    classificacao: { intencao: 'alteracao_contratual', assunto: 'Reajuste contratual', entidades: [{ tipo: 'documento', valor: 'notificação de reajuste' }, { tipo: 'obra', valor: OBRA }], setorRecomendado: 'JURIDICO', prioridadeRecomendada: 'Alta', nivelRecomendado: 'C', acaoSugerida: 'resposta formal pelo jurídico', confianca: 0.9, sinais: ['jurídico do cliente', 'pede resposta formal', 'altera contrato'], evidencias: [{ mensagemId: 'MSG-00016', trecho: 'notificação sobre o reajuste contratual' }], provedor: 'SEED', versao: 'exemplo-1', em: h(6) },
    resumo: 'Jurídico do cliente notifica sobre reajuste contratual e pede resposta formal.',
    sla: { primeiraRespostaAte: slaDe(cfg, 'Alta', h(6)) }, abertaEm: h(6), ultimaMensagemEm: h(6), ultimaInboundEm: h(6),
  };
  threads.push(t10);
  msg({ threadId: t10.id, direcao: 'inbound', tipo: 'texto', autor: contato('CTI-00009'), texto: 'Prezados, encaminhamos notificação sobre o reajuste contratual da obra. Solicitamos resposta formal em até 5 dias úteis.', anexos: [{ nome: 'notificacao-reajuste.pdf', tipo: 'application/pdf', tamanhoBytes: 640_000 }], em: h(6), externalMessageId: 'email.exemplo.0011' });
  evt({ threadId: t10.id, tipo: 'THREAD_CREATED', em: h(6), ator: sistema, detalhe: 'conversa aberta por email (EXTERNAL)' });
  evt({ threadId: t10.id, tipo: 'ROUTED', em: h(6), ator: sistema, detalhe: 'regra ROT-01: tema jurídico → Jurídico · nível C: humano obrigatório · setor sem responsável padrão' });
  atr({ threadId: t10.id, setorCodigo: 'JURIDICO', atribuidaEm: h(6), origem: 'roteamento' });

  return { setores, equipes: EQUIPES_SEED, membros: MEMBROS_SEED, contatos, threads, mensagens, eventos, atribuicoes, acoes, jobs, configuracao: cfg, origem: 'seed' };
}
