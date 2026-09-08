// Motor de contexto de comunicacao (Communication Intelligence 01): separa FATOS (com fonte, verificacao, confianca),
// ESTRATEGIA, PLAYBOOK (regras e intencao, nunca texto fechado), OBJETIVO, CANAL, CONTEUDO GERADO, APROVACAO, ENVIO e
// RESULTADO. Tudo puro e generico: nenhuma conta, pessoa ou cidade fica no codigo. A geracao de texto esta em
// comunicacaoGeracao.ts; o envio nao existe nesta fase (estado maximo alcancado automaticamente: READY_FOR_REVIEW).
import { NOME_PERSONA, sugerirContatoPrincipal, tipoProjetoPrincipal } from './contatos';
import { NOME_SINAL } from './padroes';
import { fitIdealDe, recomendarAcao, sinalPrincipal } from './pipeline';
import { leituraDe, relevanciaDe, sinalAcionavel, type RelevanciaEstrutural } from './sinalLeitura';
import type { EstadoAcao } from './pipeline';
import type { Atividade, Canal, CodigoResposta, Contato, Empresa, Estagio, Estrategia, Fonte, Persona, RadarDataset, Sinal } from './types';

// ---------------------------------------------------------------------------------------------------------------------
// Objetivos de comunicacao
// ---------------------------------------------------------------------------------------------------------------------
export const OBJETIVOS_COMUNICACAO = ['GET_REFERRAL', 'START_DISCOVERY', 'UNDERSTAND_PROJECT_STAGE', 'QUALIFY_NEED', 'REQUEST_PROJECT', 'OFFER_PRELIMINARY_STUDY', 'SEND_REQUESTED_CONTENT', 'SCHEDULE_MEETING', 'FOLLOW_UP', 'REACTIVATE', 'PROCUREMENT_ROUTING'] as const;
export type ObjetivoComunicacao = (typeof OBJETIVOS_COMUNICACAO)[number];
const EXECUTIVOS: Persona[] = ['OWNER', 'CEO', 'PRESIDENT', 'COO'];
const TECNICOS: Persona[] = ['INDUSTRIAL_DIRECTOR', 'ENGINEERING_DIRECTOR', 'EXPANSION_DIRECTOR', 'ENGINEERING', 'FACILITIES', 'REAL_ESTATE'];
const OPERACIONAIS: Persona[] = ['OPERATIONS_DIRECTOR', 'OPERATIONS', 'MANUFACTURING', 'LOGISTICS', 'SUPPLY_CHAIN'];
const DECISORES: Persona[] = [...EXECUTIVOS, ...TECNICOS, ...OPERACIONAIS];
export interface DefinicaoObjetivo { codigo: ObjetivoComunicacao; nome: string; condicaoSucesso: string; cta: string; estagioMinimo: Estagio; estagioMaximo: Estagio; personas: Persona[] }
export const OBJETIVOS: Record<ObjetivoComunicacao, DefinicaoObjetivo> = {
  GET_REFERRAL: { codigo: 'GET_REFERRAL', nome: 'Obter indicação', condicaoSucesso: 'Nome e contato de quem responde por engenharia, implantação ou infraestrutura', cta: 'Você consegue me indicar quem responde por essa frente?', estagioMinimo: 'DETECTED', estagioMaximo: 'CONTACT_STARTED', personas: [...EXECUTIVOS, 'PROCUREMENT', 'OTHER'] },
  START_DISCOVERY: { codigo: 'START_DISCOVERY', nome: 'Iniciar descoberta', condicaoSucesso: 'Conversa aberta com o responsável certo, com contexto do sinal reconhecido', cta: 'Faz sentido uma conversa de 15 minutos para eu entender como vocês estão pensando essa frente?', estagioMinimo: 'DECISION_MAKER_FOUND', estagioMaximo: 'ENGAGED', personas: DECISORES },
  UNDERSTAND_PROJECT_STAGE: { codigo: 'UNDERSTAND_PROJECT_STAGE', nome: 'Entender o estágio do projeto', condicaoSucesso: 'Estágio de definição conhecido: ideia, estudo, projeto básico, executivo, cotação ou obra', cta: 'Em que estágio de definição essa frente está hoje: ainda em estudo ou já com projeto?', estagioMinimo: 'DECISION_MAKER_FOUND', estagioMaximo: 'NEED_CONFIRMED', personas: [...TECNICOS, ...OPERACIONAIS, ...EXECUTIVOS] },
  QUALIFY_NEED: { codigo: 'QUALIFY_NEED', nome: 'Qualificar a necessidade', condicaoSucesso: 'Necessidade confirmada: área, uso, prazo e quem decide', cta: 'Existe uma necessidade concreta de área coberta ou ampliação nos próximos meses?', estagioMinimo: 'CONTACT_STARTED', estagioMaximo: 'NEED_CONFIRMED', personas: [...OPERACIONAIS, ...TECNICOS] },
  REQUEST_PROJECT: { codigo: 'REQUEST_PROJECT', nome: 'Pedir o projeto', condicaoSucesso: 'Projeto, memorial ou escopo recebido', cta: 'Você consegue me enviar o projeto ou o escopo para eu avaliar a estrutura?', estagioMinimo: 'NEED_CONFIRMED', estagioMaximo: 'PROJECT_RECEIVED', personas: [...TECNICOS, ...OPERACIONAIS, 'PROCUREMENT'] },
  OFFER_PRELIMINARY_STUDY: { codigo: 'OFFER_PRELIMINARY_STUDY', nome: 'Oferecer estudo preliminar', condicaoSucesso: 'Aceite de um anteprojeto ou estimativa sem compromisso', cta: 'Posso preparar um anteprojeto com estimativa de peso e prazo para apoiar a decisão?', estagioMinimo: 'ENGAGED', estagioMaximo: 'ENGINEERING', personas: [...TECNICOS, ...EXECUTIVOS] },
  SEND_REQUESTED_CONTENT: { codigo: 'SEND_REQUESTED_CONTENT', nome: 'Enviar o que foi pedido', condicaoSucesso: 'Material pedido entregue e recebido', cta: 'Segue o que você pediu; me diga se falta algo para a próxima etapa.', estagioMinimo: 'CONTACT_STARTED', estagioMaximo: 'PROPOSAL_SENT', personas: [...DECISORES, 'PROCUREMENT'] },
  SCHEDULE_MEETING: { codigo: 'SCHEDULE_MEETING', nome: 'Marcar reunião', condicaoSucesso: 'Reunião com data, hora e participantes', cta: 'Qual dia e horário ficam melhores para você?', estagioMinimo: 'CONTACT_STARTED', estagioMaximo: 'NEGOTIATION', personas: [...DECISORES, 'PROCUREMENT'] },
  FOLLOW_UP: { codigo: 'FOLLOW_UP', nome: 'Retomar', condicaoSucesso: 'Resposta obtida (qualquer resultado)', cta: 'Só para não deixar passar: você consegue me responder sobre isso?', estagioMinimo: 'DETECTED', estagioMaximo: 'NEGOTIATION', personas: [...DECISORES, 'PROCUREMENT', 'OTHER'] },
  REACTIVATE: { codigo: 'REACTIVATE', nome: 'Reativar', condicaoSucesso: 'Conta volta a conversar depois de projeto futuro ou pausa', cta: 'Chegou o momento que você tinha mencionado? Posso ajudar na definição?', estagioMinimo: 'NURTURE', estagioMaximo: 'NURTURE', personas: [...DECISORES, 'PROCUREMENT'] },
  PROCUREMENT_ROUTING: { codigo: 'PROCUREMENT_ROUTING', nome: 'Rota via compras', condicaoSucesso: 'Cadastro/homologação encaminhado e contato técnico conhecido', cta: 'Qual é o caminho de cadastro de fornecedor e quem é o interlocutor técnico do projeto?', estagioMinimo: 'DETECTED', estagioMaximo: 'PRICING', personas: ['PROCUREMENT', 'SUPPLY_CHAIN'] },
};

// ---------------------------------------------------------------------------------------------------------------------
// Playbooks: regras e intencao, nunca texto fechado
// ---------------------------------------------------------------------------------------------------------------------
export const PLAYBOOKS_CODIGOS = ['ACCESS_VIA_EXECUTIVE', 'REFERRAL_INTRODUCTION', 'TECHNICAL_DISCOVERY', 'OPERATIONS_DISCOVERY', 'PROCUREMENT_ROUTING', 'NO_RESPONSE_FOLLOWUP', 'FUTURE_PROJECT_NURTURE', 'PROJECT_CAPTURE', 'PRELIMINARY_ENGINEERING'] as const;
export type PlaybookCodigo = (typeof PLAYBOOKS_CODIGOS)[number];
export type Tom = 'executivo_direto' | 'tecnico_consultivo' | 'operacional_pratico' | 'formal_processual' | 'leve_lembrete';
export const NOME_TOM: Record<Tom, string> = { executivo_direto: 'executivo e direto', tecnico_consultivo: 'técnico e consultivo', operacional_pratico: 'operacional e prático', formal_processual: 'formal e processual', leve_lembrete: 'leve, lembrete curto' };
export interface DefinicaoPlaybook { codigo: PlaybookCodigo; nome: string; objetivo: ObjetivoComunicacao; personasPreferidas: Persona[]; tom: Tom; fazer: string[]; naoFazer: string[]; elementosObrigatorios: string[]; elementosProibidos: string[]; objecoes: { gatilho: string; intencao: string }[]; maxPalavras: Record<'WHATSAPP' | 'EMAIL' | 'PHONE' | 'LINKEDIN', number> }
const OBJECOES_ACESSO = [
  { gatilho: 'Do que se trata?', intencao: 'Dizer em uma frase o que a EIFF faz e voltar ao pedido de indicação.' },
  { gatilho: 'Já temos fornecedores.', intencao: 'Não pedir troca; pedir o nome do responsável pela engenharia para a próxima ampliação.' },
  { gatilho: 'Fale com compras.', intencao: 'Aceitar; pedir também o interlocutor de engenharia/implantação.' },
  { gatilho: 'Mande apresentação.', intencao: 'Aceitar; perguntar para quem enviar e se pode citar quem indicou.' },
  { gatilho: 'Não sou eu quem cuido.', intencao: 'Confirmar e pedir nome e melhor contato de quem cuida.' },
];
const OBJECOES_TECNICAS = [
  { gatilho: 'Já temos projetista/fornecedor.', intencao: 'Posicionar como segunda leitura técnica sem custo; pedir o estágio do projeto.' },
  { gatilho: 'Ainda não há projeto.', intencao: 'Oferecer anteprojeto e estimativa para apoiar a decisão; perguntar o horizonte.' },
  { gatilho: 'Mande material.', intencao: 'Enviar o pedido específico e perguntar o estágio de definição.' },
  { gatilho: 'Fale com compras.', intencao: 'Aceitar e manter o canal técnico para o escopo.' },
];
export const PLAYBOOKS: Record<PlaybookCodigo, DefinicaoPlaybook> = {
  ACCESS_VIA_EXECUTIVE: { codigo: 'ACCESS_VIA_EXECUTIVE', nome: 'Acesso via executivo', objetivo: 'GET_REFERRAL', personasPreferidas: EXECUTIVOS, tom: 'executivo_direto', fazer: ['contextualizar o WHY NOW com um fato verificado', 'explicar a EIFF em uma frase', 'pedir quem responde pela frente de engenharia/implantação/infraestrutura'], naoFazer: ['vender', 'oferecer orçamento', 'pedir reunião como primeiro CTA', 'mandar portfólio sem pedido', 'afirmar que o executivo é responsável pela obra'], elementosObrigatorios: ['identificação breve', 'fato verificado do sinal', 'uma frase sobre a EIFF', 'pergunta de roteamento', 'pedido de encaminhamento'], elementosProibidos: ['catálogo', 'proposta', 'preço', 'reunião como primeiro pedido', 'urgência artificial'], objecoes: OBJECOES_ACESSO, maxPalavras: { WHATSAPP: 90, EMAIL: 120, PHONE: 110, LINKEDIN: 70 } },
  REFERRAL_INTRODUCTION: { codigo: 'REFERRAL_INTRODUCTION', nome: 'Apresentação por indicação', objetivo: 'START_DISCOVERY', personasPreferidas: [...TECNICOS, ...OPERACIONAIS], tom: 'tecnico_consultivo', fazer: ['abrir citando quem indicou', 'ligar ao fato do sinal', 'pedir uma conversa curta para entender a frente'], naoFazer: ['vender', 'omitir a origem da indicação', 'mandar proposta'], elementosObrigatorios: ['origem da indicação', 'fato verificado', 'uma frase sobre a EIFF', 'pedido de conversa curta'], elementosProibidos: ['preço', 'portfólio sem pedido'], objecoes: OBJECOES_TECNICAS, maxPalavras: { WHATSAPP: 90, EMAIL: 130, PHONE: 110, LINKEDIN: 70 } },
  TECHNICAL_DISCOVERY: { codigo: 'TECHNICAL_DISCOVERY', nome: 'Descoberta técnica', objetivo: 'UNDERSTAND_PROJECT_STAGE', personasPreferidas: TECNICOS, tom: 'tecnico_consultivo', fazer: ['reconhecer o fato do sinal', 'perguntar o estágio de definição (estudo, projeto básico, executivo, cotação, obra)', 'oferecer leitura técnica sem compromisso'], naoFazer: ['pedir indicação para outra pessoa', 'falar de preço', 'prometer prazo sem projeto'], elementosObrigatorios: ['identificação breve', 'fato verificado', 'uma frase sobre a EIFF', 'pergunta sobre o estágio'], elementosProibidos: ['pedido de indicação', 'preço', 'portfólio completo'], objecoes: OBJECOES_TECNICAS, maxPalavras: { WHATSAPP: 100, EMAIL: 140, PHONE: 120, LINKEDIN: 80 } },
  OPERATIONS_DISCOVERY: { codigo: 'OPERATIONS_DISCOVERY', nome: 'Descoberta operacional', objetivo: 'QUALIFY_NEED', personasPreferidas: OPERACIONAIS, tom: 'operacional_pratico', fazer: ['ligar o fato do sinal à operação (área coberta, armazenagem, fluxo)', 'perguntar se há necessidade concreta e prazo', 'perguntar quem define o projeto'], naoFazer: ['falar de preço', 'tratar o operacional como decisor final sem confirmar'], elementosObrigatorios: ['fato verificado', 'pergunta sobre necessidade e prazo', 'pergunta sobre quem define'], elementosProibidos: ['preço', 'proposta'], objecoes: OBJECOES_TECNICAS, maxPalavras: { WHATSAPP: 100, EMAIL: 140, PHONE: 120, LINKEDIN: 80 } },
  PROCUREMENT_ROUTING: { codigo: 'PROCUREMENT_ROUTING', nome: 'Rota via compras', objetivo: 'PROCUREMENT_ROUTING', personasPreferidas: ['PROCUREMENT', 'SUPPLY_CHAIN'], tom: 'formal_processual', fazer: ['pedir o caminho de cadastro/homologação', 'pedir o interlocutor técnico do projeto', 'oferecer documentação da EIFF'], naoFazer: ['tentar substituir a engenharia por compras', 'negociar preço', 'pressionar'], elementosObrigatorios: ['identificação', 'pedido de cadastro', 'pedido do interlocutor técnico'], elementosProibidos: ['preço', 'desconto', 'urgência'], objecoes: [{ gatilho: 'Só recebemos por portal.', intencao: 'Pedir o link e os documentos exigidos.' }, { gatilho: 'Não há demanda.', intencao: 'Agradecer, pedir para ficar cadastrado e manter o interlocutor técnico.' }], maxPalavras: { WHATSAPP: 80, EMAIL: 130, PHONE: 90, LINKEDIN: 60 } },
  NO_RESPONSE_FOLLOWUP: { codigo: 'NO_RESPONSE_FOLLOWUP', nome: 'Retomada sem resposta', objetivo: 'FOLLOW_UP', personasPreferidas: [...DECISORES, 'PROCUREMENT'], tom: 'leve_lembrete', fazer: ['repetir a pergunta original em uma frase', 'trocar de canal em relação à tentativa anterior', 'na quarta tentativa, trazer um ângulo técnico objetivo'], naoFazer: ['cobrar', 'repetir o texto inteiro', 'mais de quatro tentativas sem novo sinal'], elementosObrigatorios: ['referência à tentativa anterior', 'pergunta única'], elementosProibidos: ['tom de cobrança', 'anexos'], objecoes: [], maxPalavras: { WHATSAPP: 45, EMAIL: 80, PHONE: 60, LINKEDIN: 45 } },
  FUTURE_PROJECT_NURTURE: { codigo: 'FUTURE_PROJECT_NURTURE', nome: 'Nutrição de projeto futuro', objetivo: 'REACTIVATE', personasPreferidas: [...TECNICOS, ...EXECUTIVOS, ...OPERACIONAIS], tom: 'tecnico_consultivo', fazer: ['lembrar o horizonte mencionado', 'oferecer apoio na definição (anteprojeto, estimativa)', 'pedir para ser avisado quando o estudo começar'], naoFazer: ['pressionar', 'contatar antes do horizonte combinado sem novo sinal'], elementosObrigatorios: ['referência ao que foi dito', 'oferta de apoio na definição'], elementosProibidos: ['preço', 'urgência'], objecoes: [], maxPalavras: { WHATSAPP: 80, EMAIL: 120, PHONE: 90, LINKEDIN: 70 } },
  PROJECT_CAPTURE: { codigo: 'PROJECT_CAPTURE', nome: 'Captura do projeto', objetivo: 'REQUEST_PROJECT', personasPreferidas: [...TECNICOS, ...OPERACIONAIS, 'PROCUREMENT'], tom: 'tecnico_consultivo', fazer: ['pedir projeto, memorial ou escopo', 'dizer o que a EIFF devolve com isso (avaliação da estrutura, peso, prazo)', 'combinar próximo passo'], naoFazer: ['dar preço sem projeto', 'prometer prazo sem escopo'], elementosObrigatorios: ['pedido do projeto/escopo', 'o que será devolvido'], elementosProibidos: ['preço sem projeto'], objecoes: OBJECOES_TECNICAS, maxPalavras: { WHATSAPP: 90, EMAIL: 130, PHONE: 100, LINKEDIN: 70 } },
  PRELIMINARY_ENGINEERING: { codigo: 'PRELIMINARY_ENGINEERING', nome: 'Engenharia preliminar', objetivo: 'OFFER_PRELIMINARY_STUDY', personasPreferidas: [...TECNICOS, ...EXECUTIVOS], tom: 'tecnico_consultivo', fazer: ['oferecer anteprojeto e estimativa sem compromisso', 'explicar o que é preciso para isso (área, uso, cargas básicas)', 'combinar entrega'], naoFazer: ['cobrar pelo estudo nesta fase', 'prometer preço fechado'], elementosObrigatorios: ['oferta do estudo', 'insumos necessários'], elementosProibidos: ['preço fechado'], objecoes: OBJECOES_TECNICAS, maxPalavras: { WHATSAPP: 90, EMAIL: 140, PHONE: 110, LINKEDIN: 80 } },
};

// ---------------------------------------------------------------------------------------------------------------------
// Fatos: origem, fonte, verificacao, confianca, data e URL
// ---------------------------------------------------------------------------------------------------------------------
export interface Fato { chave: string; texto: string; origem: 'empresa' | 'contato' | 'sinal' | 'indicacao'; fonte?: string; verificado: boolean; confianca: number; eventoEm?: string; url?: string }
/** Fonte com confiabilidade >= 0,8 sustenta um fato cadastral como verificado (Vibe/CSV importados sao 0,8; sinais exigem o flag proprio). */
export const CONFIABILIDADE_FATO_CADASTRAL = 0.8;
const fonteDe = (fontes: Fonte[], id?: string) => fontes.find((f) => f.id === id);
export function fatosDaEmpresa(e: Empresa, fontes: Fonte[]): Fato[] {
  const f = fonteDe(fontes, e.fonteId); const conf = f?.confiabilidade ?? 0; const ver = conf >= CONFIABILIDADE_FATO_CADASTRAL;
  const base = { origem: 'empresa' as const, fonte: f?.codigo, verificado: ver, confianca: conf };
  const out: Fato[] = [{ chave: 'empresa.nome', texto: e.nomeFantasia ?? e.razaoSocial, ...base, verificado: true, confianca: 1 }];
  if (e.cidade || e.uf) out.push({ chave: 'empresa.local', texto: [e.cidade, e.uf].filter(Boolean).join('/'), ...base });
  if (e.setor) out.push({ chave: 'empresa.setor', texto: e.setor, ...base });
  if (e.faixaFuncionarios) out.push({ chave: 'empresa.funcionarios', texto: `${e.faixaFuncionarios.replace(/[[\]]/g, '')} funcionários`, ...base });
  return out;
}
export function fatosDoContato(c: Contato, fontes: Fonte[]): Fato[] {
  const f = fonteDe(fontes, c.fonteId); const conf = f?.confiabilidade ?? 0; const ver = !!c.verificadoEm || conf >= CONFIABILIDADE_FATO_CADASTRAL;
  const base = { origem: 'contato' as const, fonte: f?.codigo, verificado: ver, confianca: c.verificadoEm ? 1 : conf, eventoEm: c.verificadoEm };
  const out: Fato[] = [{ chave: 'contato.nome', texto: c.nome, ...base }];
  if (c.cargo) out.push({ chave: 'contato.cargo', texto: c.cargo, ...base });
  return out;
}
export function fatosDoSinal(s: Sinal, fontes: Fonte[]): Fato[] {
  const f = fonteDe(fontes, s.fonteId); const l = leituraDe(s);
  const base = { origem: 'sinal' as const, fonte: f?.codigo, verificado: s.verificado, confianca: s.confianca, eventoEm: s.eventoEm, url: s.url };
  const out: Fato[] = [{ chave: 'sinal.titulo', texto: s.titulo, ...base }];
  if (l.oQueAconteceu) out.push({ chave: 'sinal.oQueAconteceu', texto: l.oQueAconteceu, ...base });
  if (l.porQueImporta) out.push({ chave: 'sinal.porQueImporta', texto: l.porQueImporta, ...base, verificado: false, confianca: Math.min(s.confianca, 0.5) }); // leitura do analista: interpretacao, nao fato
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Historico e indicacao
// ---------------------------------------------------------------------------------------------------------------------
export interface Indicacao { porContatoId: string; porNome: string; em: string; atividadeId: string }
/** Indicacao recebida: atividade REFERRED_TO_OTHER_PERSON de outro contato da empresa registrada antes de o contato existir. */
export function indicacaoDe(contato: Contato | undefined, atividades: Atividade[], contatos: Contato[]): Indicacao | undefined {
  if (!contato) return undefined;
  const a = atividades.filter((x) => x.empresaId === contato.empresaId && x.resultado === 'REFERRED_TO_OTHER_PERSON' && x.contatoId && x.contatoId !== contato.id && x.ocorreuEm <= contato.criadoEm).sort((p, q) => (p.ocorreuEm < q.ocorreuEm ? 1 : -1))[0];
  if (!a) return undefined;
  const por = contatos.find((c) => c.id === a.contatoId);
  return por ? { porContatoId: por.id, porNome: por.nome, em: a.ocorreuEm, atividadeId: a.id } : undefined;
}
export interface HistoricoComunicacao { resumo: string; tentativas: number; ultimoResultado?: CodigoResposta; ultimoCanal?: Canal; ultimaEm?: string; semRespostaSeguidas: number; canaisTentados: Canal[] }
/** Tentativas de contato (NOTE nao conta) do contato ou, sem contato, da empresa. */
export function historicoDe(atividades: Atividade[], empresaId: string, contatoId?: string): HistoricoComunicacao {
  const as = atividades.filter((a) => a.empresaId === empresaId && a.tipo !== 'NOTE' && (!contatoId || a.contatoId === contatoId)).sort((a, b) => (a.ocorreuEm < b.ocorreuEm ? -1 : 1));
  let semResposta = 0; for (let i = as.length - 1; i >= 0; i--) { if (as[i].resultado === 'NO_RESPONSE' || !as[i].resultado) semResposta++; else break; }
  const u = as[as.length - 1];
  const resumo = !as.length ? 'Sem tentativas de contato anteriores.' : `${as.length} tentativa(s); última em ${u.ocorreuEm.slice(0, 10)} por ${u.canal}${u.resultado ? `, resultado ${u.resultado}` : ''}${semResposta ? `; ${semResposta} sem resposta seguida(s)` : ''}.`;
  return { resumo, tentativas: as.length, ultimoResultado: u?.resultado, ultimoCanal: u?.canal, ultimaEm: u?.ocorreuEm, semRespostaSeguidas: semResposta, canaisTentados: [...new Set(as.map((a) => a.canal))] };
}

// ---------------------------------------------------------------------------------------------------------------------
// Motor de resultado: o que cada resposta pede a seguir (catalogo real de radar_response_type)
// ---------------------------------------------------------------------------------------------------------------------
export interface TransicaoResultado { comunicar: boolean; objetivo?: ObjetivoComunicacao; playbook?: PlaybookCodigo; nota: string }
export const TRANSICOES_RESULTADO: Record<CodigoResposta, TransicaoResultado> = {
  NO_RESPONSE: { comunicar: true, objetivo: 'FOLLOW_UP', playbook: 'NO_RESPONSE_FOLLOWUP', nota: 'retomar em outro canal' },
  INVALID_CONTACT: { comunicar: false, nota: 'contato inválido: trocar de contato antes de comunicar' },
  GATEKEEPER: { comunicar: true, objetivo: 'GET_REFERRAL', playbook: 'ACCESS_VIA_EXECUTIVE', nota: 'pedir encaminhamento pela recepção ou por outro executivo' },
  REFERRED_TO_OTHER_PERSON: { comunicar: true, objetivo: 'START_DISCOVERY', playbook: 'REFERRAL_INTRODUCTION', nota: 'abordar o indicado citando a origem' },
  DECISION_MAKER_REACHED: { comunicar: true, objetivo: 'UNDERSTAND_PROJECT_STAGE', playbook: 'TECHNICAL_DISCOVERY', nota: 'entender o estágio com o decisor' },
  NOT_INTERESTED: { comunicar: false, nota: 'sem interesse: nutrir e reativar só com novo sinal' },
  NO_PROJECT: { comunicar: false, nota: 'sem projeto: WATCH, sem comunicação imediata' },
  FUTURE_PROJECT: { comunicar: true, objetivo: 'REACTIVATE', playbook: 'FUTURE_PROJECT_NURTURE', nota: 'nutrir até o horizonte informado' },
  ACTIVE_PROJECT: { comunicar: true, objetivo: 'REQUEST_PROJECT', playbook: 'PROJECT_CAPTURE', nota: 'pedir o projeto/escopo' },
  REQUESTED_PRESENTATION: { comunicar: true, objetivo: 'SEND_REQUESTED_CONTENT', playbook: 'TECHNICAL_DISCOVERY', nota: 'enviar o pedido e perguntar o estágio' },
  REQUESTED_MEETING: { comunicar: true, objetivo: 'SCHEDULE_MEETING', playbook: 'TECHNICAL_DISCOVERY', nota: 'marcar a reunião' },
  REQUESTED_BUDGET: { comunicar: true, objetivo: 'REQUEST_PROJECT', playbook: 'PROJECT_CAPTURE', nota: 'orçamento exige o projeto' },
  REQUESTED_TECHNICAL_ANALYSIS: { comunicar: true, objetivo: 'REQUEST_PROJECT', playbook: 'PROJECT_CAPTURE', nota: 'análise exige projeto/escopo' },
  ALREADY_HAS_SUPPLIER: { comunicar: false, nota: 'já tem fornecedor: nutrir; reativar com novo sinal' },
  COMPETITOR_SELECTED: { comunicar: false, nota: 'concorrente escolhido: nutrir; reativar com novo sinal' },
  PRICE_OBJECTION: { comunicar: true, objetivo: 'FOLLOW_UP', playbook: 'TECHNICAL_DISCOVERY', nota: 'retomar pelo valor técnico, não por desconto' },
  TIME_OBJECTION: { comunicar: true, objetivo: 'FOLLOW_UP', playbook: 'TECHNICAL_DISCOVERY', nota: 'retomar com prazo real de fábrica e montagem' },
  TECHNICAL_OBJECTION: { comunicar: true, objetivo: 'OFFER_PRELIMINARY_STUDY', playbook: 'PRELIMINARY_ENGINEERING', nota: 'responder com estudo preliminar' },
  PAYMENT_OBJECTION: { comunicar: true, objetivo: 'FOLLOW_UP', playbook: 'TECHNICAL_DISCOVERY', nota: 'retomar com condições, sem desconto' },
  CALL_BACK: { comunicar: true, objetivo: 'FOLLOW_UP', playbook: 'NO_RESPONSE_FOLLOWUP', nota: 'retornar na data pedida' },
  POSITIVE: { comunicar: true, objetivo: 'UNDERSTAND_PROJECT_STAGE', playbook: 'TECHNICAL_DISCOVERY', nota: 'avançar para o estágio do projeto' },
  NEGATIVE: { comunicar: false, nota: 'negativo: nutrir; reativar com novo sinal' },
};

// ---------------------------------------------------------------------------------------------------------------------
// Estagio efetivo, selecao de objetivo/playbook, politica de canal
// ---------------------------------------------------------------------------------------------------------------------
export function estagioEfetivo(x: { estagioOportunidade?: Estagio; decisionFit?: number; fitIdeal: number; historico: HistoricoComunicacao; temSinal: boolean }): Estagio {
  if (x.estagioOportunidade) return x.estagioOportunidade;
  if (x.historico.tentativas > 0) return 'CONTACT_STARTED';
  if ((x.decisionFit ?? 0) >= x.fitIdeal) return 'DECISION_MAKER_FOUND';
  return x.temSinal ? 'RESEARCHING' : 'DETECTED';
}
export interface SelecaoPlaybook { comunicar: boolean; objetivo?: ObjetivoComunicacao; playbook?: PlaybookCodigo; motivo: string }
export function selecionarPlaybook(x: { persona: Persona; decisionFit: number; fitIdeal: number; historico: HistoricoComunicacao; indicacao?: Indicacao; estrategia?: string; estagio: Estagio; temContato: boolean }): SelecaoPlaybook {
  if (!x.temContato) return { comunicar: false, motivo: 'sem contato: buscar decisor antes de comunicar' };
  const u = x.historico.ultimoResultado;
  if (u) { const t = TRANSICOES_RESULTADO[u]; if (!t.comunicar) return { comunicar: false, motivo: `último resultado ${u}: ${t.nota}` }; return { comunicar: true, objetivo: t.objetivo, playbook: t.playbook, motivo: `último resultado ${u}: ${t.nota}` }; }
  if (x.historico.tentativas > 0 && x.historico.semRespostaSeguidas > 0) return { comunicar: true, objetivo: 'FOLLOW_UP', playbook: 'NO_RESPONSE_FOLLOWUP', motivo: `${x.historico.semRespostaSeguidas} tentativa(s) sem resposta` };
  if (x.indicacao) return { comunicar: true, objetivo: 'START_DISCOVERY', playbook: 'REFERRAL_INTRODUCTION', motivo: `indicado por ${x.indicacao.porNome}` };
  if (x.persona === 'PROCUREMENT' || x.persona === 'SUPPLY_CHAIN') return { comunicar: true, objetivo: 'PROCUREMENT_ROUTING', playbook: 'PROCUREMENT_ROUTING', motivo: 'persona de compras/suprimentos: rota de cadastro e interlocutor técnico' };
  if (TECNICOS.includes(x.persona)) { if (x.estrategia === 'PRELIMINARY_ENGINEERING' && ['ENGAGED', 'NEED_CONFIRMED', 'PROJECT_RECEIVED', 'ENGINEERING'].includes(x.estagio)) return { comunicar: true, objetivo: 'OFFER_PRELIMINARY_STUDY', playbook: 'PRELIMINARY_ENGINEERING', motivo: 'decisor técnico engajado com estratégia de engenharia preliminar' }; return { comunicar: true, objetivo: 'UNDERSTAND_PROJECT_STAGE', playbook: 'TECHNICAL_DISCOVERY', motivo: `persona técnica (${NOME_PERSONA[x.persona]}): entender o estágio do projeto` }; }
  if (OPERACIONAIS.includes(x.persona)) return { comunicar: true, objetivo: 'QUALIFY_NEED', playbook: 'OPERATIONS_DISCOVERY', motivo: `persona operacional (${NOME_PERSONA[x.persona]}): qualificar necessidade e quem define` };
  if (EXECUTIVOS.includes(x.persona)) { if (x.decisionFit >= x.fitIdeal) return { comunicar: true, objetivo: 'START_DISCOVERY', playbook: 'TECHNICAL_DISCOVERY', motivo: 'executivo com decision fit ideal: é o decisor' }; return { comunicar: true, objetivo: 'GET_REFERRAL', playbook: 'ACCESS_VIA_EXECUTIVE', motivo: `executivo com decision fit ${x.decisionFit} abaixo do ideal ${x.fitIdeal}: rota de acesso ao responsável` }; }
  return { comunicar: true, objetivo: 'GET_REFERRAL', playbook: 'ACCESS_VIA_EXECUTIVE', motivo: 'persona sem função direta: pedir encaminhamento' };
}

export interface RecomendacaoCanal { primario?: Canal; secundario?: Canal; motivo: string; disponiveis: Canal[] }
const canaisDoContato = (c?: Contato): Canal[] => { if (!c) return []; const out: Canal[] = []; const tel = (!!c.celular || !!c.whatsapp || !!c.telefone) && c.statusTelefone !== 'invalido'; if (c.celular || c.whatsapp) out.push('WHATSAPP'); if (tel) out.push('PHONE'); if (c.email && c.statusEmail !== 'invalido' && c.statusEmail !== 'devolvido') out.push('EMAIL'); if (c.linkedin) out.push('LINKEDIN'); return out; };
/** Politica deterministica: preferencia por persona/senioridade e estagio, rotacao apos sem resposta, indicacao como alternativa. */
export function recomendarCanal(x: { contato?: Contato; persona: Persona; historico: HistoricoComunicacao; indicacao?: Indicacao; estagio: Estagio; playbook?: PlaybookCodigo }): RecomendacaoCanal {
  const disp = canaisDoContato(x.contato);
  if (!disp.length) return { motivo: x.contato ? 'contato sem canal válido: enriquecer antes de comunicar' : 'sem contato', disponiveis: disp, secundario: x.indicacao ? 'REFERRAL' : undefined };
  const preferencia: Canal[] = x.persona === 'PROCUREMENT' || x.persona === 'SUPPLY_CHAIN' ? ['EMAIL', 'PHONE', 'LINKEDIN', 'WHATSAPP'] : EXECUTIVOS.includes(x.persona) ? ['WHATSAPP', 'PHONE', 'EMAIL', 'LINKEDIN'] : ['PHONE', 'WHATSAPP', 'EMAIL', 'LINKEDIN'];
  if (['ENGAGED', 'NEED_CONFIRMED', 'PROJECT_RECEIVED', 'ENGINEERING', 'PRICING', 'PROPOSAL_SENT', 'NEGOTIATION'].includes(x.estagio)) preferencia.unshift('PHONE');
  const ordem = [...new Set(preferencia)].filter((c) => disp.includes(c));
  let motivo = `preferência para ${NOME_PERSONA[x.persona]} no estágio ${x.estagio}`;
  let rot = ordem;
  if (x.historico.semRespostaSeguidas > 0 && x.historico.ultimoCanal) { const i = ordem.indexOf(x.historico.ultimoCanal); rot = [...ordem.slice(i + 1), ...ordem.slice(0, i + 1)]; motivo = `${x.historico.semRespostaSeguidas} sem resposta por ${x.historico.ultimoCanal}: alternar canal`; }
  if (x.historico.ultimoResultado === 'REQUESTED_MEETING' || x.historico.ultimoResultado === 'CALL_BACK') { rot = (['PHONE', ...rot.filter((c) => c !== 'PHONE')] as Canal[]).filter((c) => disp.includes(c)); motivo = `resultado ${x.historico.ultimoResultado}: ligar`; }
  const primario = rot[0]; const secundario = x.indicacao && x.playbook === 'REFERRAL_INTRODUCTION' ? 'REFERRAL' : rot[1];
  return { primario, secundario, motivo, disponiveis: disp };
}

// ---------------------------------------------------------------------------------------------------------------------
// Contexto de comunicacao
// ---------------------------------------------------------------------------------------------------------------------
export interface EntradaContexto { empresa: Empresa; contato?: Contato; persona?: Persona; decisionFit?: number; sinal?: Sinal; estagioOportunidade?: Estagio; estrategia?: Estrategia; atividades: Atividade[]; contatos: Contato[]; fontes: Fonte[]; fitIdeal: number; proximaAcaoAtual: EstadoAcao; hoje: string; canalPreferido?: Canal }
export interface ContextoComunicacao {
  empresa: { id: string; nome: string; local?: string; setor?: string; priority?: number; classe?: string };
  contato?: { id: string; nome: string; primeiroNome: string; cargo?: string; persona: Persona; senioridade?: string; decisionFit: number; fitIdeal: number };
  fatosEmpresa: Fato[]; fatosContato: Fato[]; fatosSinal: Fato[];
  fatosPermitidos: Fato[]; fatosNaoVerificados: Fato[];
  sinal?: { id: string; tipo: string; nome: string; titulo: string; eventoEm: string; relevancia?: RelevanciaEstrutural; acionavel: boolean; url?: string; fonte?: string; verificado: boolean; confianca: number };
  whyNow?: string;
  estagio: Estagio; estrategia?: string;
  comunicar: boolean; objetivo?: ObjetivoComunicacao; playbook?: PlaybookCodigo; motivoSelecao: string;
  objetivoComercial?: string; cta?: string; tom?: Tom;
  alegacoesPermitidas: string[]; alegacoesProibidas: string[];
  canal: RecomendacaoCanal;
  historico: HistoricoComunicacao; indicacao?: Indicacao;
  proximaAcaoAtual: EstadoAcao;
}
export const ALEGACOES_PROIBIDAS_BASE = ['que a estrutura metálica está em contratação', 'que existe licitação aberta', 'que a EIFF conhece um projeto em aberto', 'preço, prazo ou proposta sem projeto', 'que o sinal foi confirmado com a empresa quando não foi'];
const primeiroNome = (n: string) => n.trim().split(/\s+/)[0] ?? n;
export function buildCommunicationContext(x: EntradaContexto): ContextoComunicacao {
  const c = x.contato; const persona = x.persona ?? c?.persona ?? 'OTHER';
  const decisionFit = x.decisionFit ?? c?.decisionFitScore ?? 0;
  const fatosEmpresa = fatosDaEmpresa(x.empresa, x.fontes); const fatosContato = c ? fatosDoContato(c, x.fontes) : []; const fatosSinal = x.sinal ? fatosDoSinal(x.sinal, x.fontes) : [];
  const todos = [...fatosEmpresa, ...fatosContato, ...fatosSinal];
  const fatosPermitidos = todos.filter((f) => f.verificado); const fatosNaoVerificados = todos.filter((f) => !f.verificado);
  const historico = historicoDe(x.atividades, x.empresa.id, c?.id);
  const indicacao = indicacaoDe(c, x.atividades, x.contatos);
  const estagio = estagioEfetivo({ estagioOportunidade: x.estagioOportunidade, decisionFit, fitIdeal: x.fitIdeal, historico, temSinal: !!x.sinal });
  const sel = selecionarPlaybook({ persona, decisionFit, fitIdeal: x.fitIdeal, historico, indicacao, estrategia: x.estrategia?.codigo, estagio, temContato: !!c });
  const pb = sel.playbook ? PLAYBOOKS[sel.playbook] : undefined; const ob = sel.objetivo ? OBJETIVOS[sel.objetivo] : undefined;
  const canal = recomendarCanal({ contato: c, persona, historico, indicacao, estagio, playbook: sel.playbook });
  if (x.canalPreferido && canal.disponiveis.includes(x.canalPreferido)) { canal.secundario = canal.primario === x.canalPreferido ? canal.secundario : canal.primario; canal.primario = x.canalPreferido; canal.motivo = `canal escolhido pelo usuário (${x.canalPreferido})`; }
  const l = x.sinal ? leituraDe(x.sinal) : {};
  const whyNowFato = fatosSinal.find((f) => f.chave === 'sinal.oQueAconteceu' && f.verificado) ?? fatosSinal.find((f) => f.chave === 'sinal.titulo' && f.verificado);
  const whyNow = whyNowFato ? `${whyNowFato.texto} (${x.sinal!.eventoEm.slice(0, 10)}${whyNowFato.fonte ? `, fonte ${whyNowFato.fonte}` : ''})` : x.sinal ? `sinal ${NOME_SINAL[x.sinal.tipo]} de ${x.sinal.eventoEm.slice(0, 10)} ainda não verificado: não usar como fato` : undefined;
  const alegacoesPermitidas = [...fatosPermitidos.map((f) => f.texto), 'o que a EIFF faz: projeto, fabricação e montagem de estruturas metálicas para unidades industriais e de armazenagem'];
  const alegacoesProibidas = [...ALEGACOES_PROIBIDAS_BASE, ...(c && !TECNICOS.includes(persona) ? [`que ${c.nome} é responsável pela obra ou pelo projeto`] : []), ...(l.porQueImporta ? ['a leitura interna "por que importa" como se fosse fato da empresa'] : []), ...fatosNaoVerificados.map((f) => `fato não verificado: ${f.texto}`)];
  return {
    empresa: { id: x.empresa.id, nome: x.empresa.nomeFantasia ?? x.empresa.razaoSocial, local: [x.empresa.cidade, x.empresa.uf].filter(Boolean).join('/') || undefined, setor: x.empresa.setor, priority: x.empresa.priorityScore, classe: x.empresa.priorityClass },
    contato: c ? { id: c.id, nome: c.nome, primeiroNome: primeiroNome(c.nome), cargo: c.cargo, persona, senioridade: c.senioridade, decisionFit, fitIdeal: x.fitIdeal } : undefined,
    fatosEmpresa, fatosContato, fatosSinal, fatosPermitidos, fatosNaoVerificados,
    sinal: x.sinal ? { id: x.sinal.id, tipo: x.sinal.tipo, nome: NOME_SINAL[x.sinal.tipo] ?? x.sinal.tipo, titulo: x.sinal.titulo, eventoEm: x.sinal.eventoEm, relevancia: relevanciaDe(x.sinal), acionavel: sinalAcionavel(x.sinal), url: x.sinal.url, fonte: fonteDe(x.fontes, x.sinal.fonteId)?.codigo, verificado: x.sinal.verificado, confianca: x.sinal.confianca } : undefined,
    whyNow, estagio, estrategia: x.estrategia?.codigo,
    comunicar: sel.comunicar, objetivo: sel.objetivo, playbook: sel.playbook, motivoSelecao: sel.motivo,
    objetivoComercial: ob?.condicaoSucesso, cta: ob?.cta, tom: pb?.tom,
    alegacoesPermitidas, alegacoesProibidas, canal, historico, indicacao, proximaAcaoAtual: x.proximaAcaoAtual,
  };
}
/** Monta a entrada a partir do dataset do Radar (contato recomendado, sinal principal, estrategia da oportunidade ativa). */
export function contextoComunicacaoDe(r: RadarDataset, empresaId: string, hoje: string, opts: { contatoId?: string; canal?: Canal } = {}): ContextoComunicacao | undefined {
  const e = r.empresas.find((x) => x.id === empresaId); if (!e) return undefined;
  const fitIdeal = fitIdealDe(r);
  const contato = opts.contatoId ? r.contatos.find((c) => c.id === opts.contatoId && c.empresaId === e.id) : sugerirContatoPrincipal(e, r.contatos, r)?.contato;
  const sug = contato ? sugerirContatoPrincipal(e, [contato], r, tipoProjetoPrincipal(e.id, r.projetos)) : undefined;
  const opp = r.oportunidades.filter((o) => o.empresaId === e.id && o.estagio !== 'WON' && o.estagio !== 'LOST').sort((a, b) => (a.atualizadoEm < b.atualizadoEm ? 1 : -1))[0];
  const estrategia = opp?.estrategiaId ? r.estrategias.find((s) => s.id === opp.estrategiaId) : r.atividades.filter((a) => a.empresaId === e.id && a.estrategiaId).sort((a, b) => (a.ocorreuEm < b.ocorreuEm ? 1 : -1)).map((a) => r.estrategias.find((s) => s.id === a.estrategiaId))[0];
  return buildCommunicationContext({ empresa: e, contato, persona: sug?.fit.persona, decisionFit: sug?.fit.score, sinal: sinalPrincipal(e.id, r, hoje), estagioOportunidade: opp?.estagio, estrategia, atividades: r.atividades, contatos: r.contatos, fontes: r.fontes, fitIdeal, proximaAcaoAtual: recomendarAcao(e, r, hoje).estado, hoje, canalPreferido: opts.canal });
}

// ---------------------------------------------------------------------------------------------------------------------
// Content spec (entrada futura do LLM) e estados da comunicacao
// ---------------------------------------------------------------------------------------------------------------------
export interface ContentSpec {
  objetivo: ObjetivoComunicacao; playbook: PlaybookCodigo; canal: Canal;
  audiencia: { nome: string; primeiroNome: string; cargo?: string; persona: Persona; empresa: string; local?: string };
  remetente: { nome: string; empresa: string; cidade: string };
  tom: Tom; maxPalavras: number;
  fatosUsar: Fato[]; fatosEvitar: Fato[];
  cta: string; contextoHistorico: string; contextoIndicacao?: string;
  elementosObrigatorios: string[]; elementosProibidos: string[]; alegacoesProibidas: string[];
  whyNow?: string; sinalTipo?: string;
}
export interface Remetente { nome: string; empresa: string; cidade: string }
export function montarContentSpec(ctx: ContextoComunicacao, canal: Canal, remetente: Remetente): ContentSpec {
  if (!ctx.comunicar || !ctx.objetivo || !ctx.playbook || !ctx.contato) throw new Error(`Sem comunicação a gerar: ${ctx.motivoSelecao}`);
  const pb = PLAYBOOKS[ctx.playbook]; const ob = OBJETIVOS[ctx.objetivo];
  const chave = (canal === 'WHATSAPP' || canal === 'EMAIL' || canal === 'PHONE' || canal === 'LINKEDIN' ? canal : 'WHATSAPP') as keyof DefinicaoPlaybook['maxPalavras'];
  const usar = ctx.fatosPermitidos.filter((f) => f.origem === 'sinal' || f.chave === 'empresa.nome' || f.chave === 'empresa.local');
  return {
    objetivo: ctx.objetivo, playbook: ctx.playbook, canal,
    audiencia: { nome: ctx.contato.nome, primeiroNome: ctx.contato.primeiroNome, cargo: ctx.contato.cargo, persona: ctx.contato.persona, empresa: ctx.empresa.nome, local: ctx.empresa.local },
    remetente, tom: pb.tom, maxPalavras: pb.maxPalavras[chave],
    fatosUsar: usar, fatosEvitar: ctx.fatosNaoVerificados,
    cta: ob.cta, contextoHistorico: ctx.historico.resumo, contextoIndicacao: ctx.indicacao ? `indicado por ${ctx.indicacao.porNome} em ${ctx.indicacao.em.slice(0, 10)}` : undefined,
    elementosObrigatorios: pb.elementosObrigatorios, elementosProibidos: pb.elementosProibidos, alegacoesProibidas: ctx.alegacoesProibidas,
    whyNow: ctx.whyNow, sinalTipo: ctx.sinal?.nome,
  };
}

export const ESTADOS_COMUNICACAO = ['DRAFT', 'READY_FOR_REVIEW', 'APPROVED', 'REJECTED', 'SENT', 'REPLIED', 'CANCELLED'] as const;
export type EstadoComunicacao = (typeof ESTADOS_COMUNICACAO)[number];
/** Transicoes permitidas. SENT nunca e alcancado pela geracao: exige acao humana explicita depois de APPROVED. */
export const TRANSICOES_COMUNICACAO: Record<EstadoComunicacao, EstadoComunicacao[]> = {
  DRAFT: ['READY_FOR_REVIEW', 'CANCELLED'], READY_FOR_REVIEW: ['APPROVED', 'REJECTED', 'CANCELLED'], APPROVED: ['SENT', 'REJECTED', 'CANCELLED'], REJECTED: ['READY_FOR_REVIEW', 'CANCELLED'], SENT: ['REPLIED', 'CANCELLED'], REPLIED: [], CANCELLED: [],
};
export const transicaoComunicacaoValida = (de: EstadoComunicacao, para: EstadoComunicacao) => TRANSICOES_COMUNICACAO[de].includes(para);
export const ESTADO_MAXIMO_AUTOMATICO: EstadoComunicacao = 'READY_FOR_REVIEW';
