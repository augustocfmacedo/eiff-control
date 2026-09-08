// Valores iniciais configuraveis do Radar: fontes, estrategias, tipos de resposta, regras de score e parametros.
// Sao gravados no banco/estado na primeira carga (garantirPadroesRadar) e depois editados pela tela; nada fica fixo no codigo.
import type { ConfigScore, Estagio, Estrategia, Fonte, PesoDecisionFit, RegraPersona, RegraScore, TipoResposta, TipoSinal } from './types';

const T = '2026-09-08T00:00:00.000Z';

export const FONTES_PADRAO: Fonte[] = [
  { id: 'FONTE-VIBE', codigo: 'VIBE', nome: 'Vibe (base B2B)', tipo: 'VIBE', descricao: 'Bases de empresas e contatos adquiridas', confiabilidade: 0.8, ativo: true, criadoEm: T },
  { id: 'FONTE-CNO', codigo: 'CNO', nome: 'CNO (Cadastro Nacional de Obras)', tipo: 'CNO', descricao: 'Obras registradas na Receita Federal', confiabilidade: 0.9, ativo: true, criadoEm: T },
  { id: 'FONTE-PNCP', codigo: 'PNCP', nome: 'PNCP (contratações públicas)', tipo: 'PNCP', descricao: 'Licitações e planos de contratação', confiabilidade: 0.9, ativo: true, criadoEm: T },
  { id: 'FONTE-RFB', codigo: 'CNPJ_RFB', nome: 'CNPJ (Receita Federal)', tipo: 'CNPJ_RFB', descricao: 'Dados cadastrais de empresas', confiabilidade: 1, ativo: true, criadoEm: T },
  { id: 'FONTE-NEWS', codigo: 'NEWS', nome: 'Notícias', tipo: 'NEWS', descricao: 'Imprensa e portais setoriais', confiabilidade: 0.6, ativo: true, criadoEm: T },
  { id: 'FONTE-LINKEDIN', codigo: 'LINKEDIN', nome: 'LinkedIn', tipo: 'LINKEDIN', descricao: 'Vagas, posts e perfis', confiabilidade: 0.7, ativo: true, criadoEm: T },
  { id: 'FONTE-PARTNER', codigo: 'PARTNER', nome: 'Parceiros', tipo: 'PARTNER', descricao: 'Indicações de projetistas, construtoras e fornecedores', confiabilidade: 0.9, ativo: true, criadoEm: T },
  { id: 'FONTE-MANUAL', codigo: 'MANUAL', nome: 'Manual', tipo: 'MANUAL', descricao: 'Registrado pela equipe', confiabilidade: 1, ativo: true, criadoEm: T },
  { id: 'FONTE-WEBSITE', codigo: 'WEBSITE', nome: 'Site da empresa', tipo: 'WEBSITE', descricao: 'Mudanças e conteúdo do site', confiabilidade: 0.6, ativo: true, criadoEm: T },
  { id: 'FONTE-CSV', codigo: 'CSV', nome: 'Planilha CSV', tipo: 'CSV', descricao: 'Importação de planilhas', confiabilidade: 0.8, ativo: true, criadoEm: T },
];

export const ESTRATEGIAS_PADRAO: Estrategia[] = [
  { id: 'ESTR-01', codigo: 'TECHNICAL_AUDIT', nome: 'Auditoria técnica', descricao: 'Oferecer revisão técnica gratuita do projeto estrutural ou do galpão existente.', mensagemModelo: '', ativo: true, ordem: 1 },
  { id: 'ESTR-02', codigo: 'COST_REDUCTION', nome: 'Redução de custo', descricao: 'Mostrar economia em kg/m² e em prazo com otimização da estrutura.', mensagemModelo: '', ativo: true, ordem: 2 },
  { id: 'ESTR-03', codigo: 'FAST_DELIVERY', nome: 'Entrega rápida', descricao: 'Capacidade de fábrica e prazo curto de fabricação e montagem.', mensagemModelo: '', ativo: true, ordem: 3 },
  { id: 'ESTR-04', codigo: 'FABRICATION_PARTNER', nome: 'Parceiro de fabricação', descricao: 'Fabricar para construtoras e projetistas que já têm o cliente.', mensagemModelo: '', ativo: true, ordem: 4 },
  { id: 'ESTR-05', codigo: 'STRUCTURAL_OPTIMIZATION', nome: 'Otimização estrutural', descricao: 'Reprojeto para reduzir peso e fundações.', mensagemModelo: '', ativo: true, ordem: 5 },
  { id: 'ESTR-06', codigo: 'SECOND_QUOTE', nome: 'Segunda cotação', descricao: 'Entrar como segunda proposta em projetos já cotados.', mensagemModelo: '', ativo: true, ordem: 6 },
  { id: 'ESTR-07', codigo: 'PRELIMINARY_ENGINEERING', nome: 'Engenharia preliminar', descricao: 'Anteprojeto e estimativa para destravar a decisão de investir.', mensagemModelo: '', ativo: true, ordem: 7 },
  { id: 'ESTR-08', codigo: 'PARTNERSHIP', nome: 'Parceria', descricao: 'Acordo recorrente com projetistas, incorporadoras ou construtoras.', mensagemModelo: '', ativo: true, ordem: 8 },
];

export const RESPOSTAS_PADRAO: TipoResposta[] = [
  { codigo: 'NO_RESPONSE', nome: 'Sem resposta', sentimento: 'neutro', ativo: true },
  { codigo: 'INVALID_CONTACT', nome: 'Contato inválido', sentimento: 'negativo', ativo: true },
  { codigo: 'GATEKEEPER', nome: 'Barrado na recepção', sentimento: 'neutro', ativo: true },
  { codigo: 'REFERRED_TO_OTHER_PERSON', nome: 'Indicou outra pessoa', sentimento: 'positivo', ativo: true },
  { codigo: 'DECISION_MAKER_REACHED', nome: 'Falou com o decisor', sentimento: 'positivo', ativo: true },
  { codigo: 'NOT_INTERESTED', nome: 'Sem interesse', sentimento: 'negativo', ativo: true },
  { codigo: 'NO_PROJECT', nome: 'Sem projeto', sentimento: 'negativo', ativo: true },
  { codigo: 'FUTURE_PROJECT', nome: 'Projeto futuro', sentimento: 'positivo', ativo: true },
  { codigo: 'ACTIVE_PROJECT', nome: 'Projeto em andamento', sentimento: 'positivo', ativo: true },
  { codigo: 'REQUESTED_PRESENTATION', nome: 'Pediu apresentação', sentimento: 'positivo', ativo: true },
  { codigo: 'REQUESTED_MEETING', nome: 'Pediu reunião', sentimento: 'positivo', ativo: true },
  { codigo: 'REQUESTED_BUDGET', nome: 'Pediu orçamento', sentimento: 'positivo', ativo: true },
  { codigo: 'REQUESTED_TECHNICAL_ANALYSIS', nome: 'Pediu análise técnica', sentimento: 'positivo', ativo: true },
  { codigo: 'ALREADY_HAS_SUPPLIER', nome: 'Já tem fornecedor', sentimento: 'negativo', ativo: true },
  { codigo: 'COMPETITOR_SELECTED', nome: 'Escolheu concorrente', sentimento: 'negativo', ativo: true },
  { codigo: 'PRICE_OBJECTION', nome: 'Objeção de preço', sentimento: 'negativo', ativo: true },
  { codigo: 'TIME_OBJECTION', nome: 'Objeção de prazo', sentimento: 'negativo', ativo: true },
  { codigo: 'TECHNICAL_OBJECTION', nome: 'Objeção técnica', sentimento: 'negativo', ativo: true },
  { codigo: 'PAYMENT_OBJECTION', nome: 'Objeção de pagamento', sentimento: 'negativo', ativo: true },
  { codigo: 'CALL_BACK', nome: 'Pediu retorno', sentimento: 'neutro', ativo: true },
  { codigo: 'POSITIVE', nome: 'Positivo', sentimento: 'positivo', ativo: true },
  { codigo: 'NEGATIVE', nome: 'Negativo', sentimento: 'negativo', ativo: true },
];

const SETORES_ALVO = ['Indústria', 'Logística', 'Agroindústria', 'Varejo', 'Alimentos', 'Bebidas', 'Química', 'Metalurgia', 'Automotivo', 'Construção', 'Energia', 'Mineração', 'Farmacêutica', 'Papel e celulose', 'Têxtil', 'E-commerce', 'Educação', 'Saúde', 'Fitness'];
const UFS_ALVO = ['GO', 'DF', 'MG', 'SP', 'TO', 'MT', 'MS', 'BA'];

let n = 0;
const regra = (nome: string, dimensao: RegraScore['dimensao'], condicao: RegraScore['condicao'], peso: number, decaimentoDias?: number, tipoSinal?: TipoSinal): RegraScore => ({ id: `RS-${String(++n).padStart(3, '0')}`, nome, dimensao, tipoSinal, condicao, peso, decaimento: !!decaimentoDias, decaimentoDias, ativo: true, prioridade: n });
const sinal = (nome: string, dimensao: RegraScore['dimensao'], tipoSinal: TipoSinal, peso: number, dias: number) => regra(nome, dimensao, { tipo: 'sinal', tipoSinal }, peso, dias, tipoSinal);

export const REGRAS_PADRAO: RegraScore[] = [
  // FIT: a empresa e o tipo de cliente que compra estrutura metalica?
  regra('Setor-alvo', 'FIT', { tipo: 'campo', campo: 'setor', op: 'in', valor: SETORES_ALVO }, 35),
  regra('UF de atuação da EIFF', 'FIT', { tipo: 'campo', campo: 'uf', op: 'in', valor: UFS_ALVO }, 25),
  regra('Porte: 51 funcionários ou mais', 'FIT', { tipo: 'campo', campo: 'faixaFuncionarios', op: 'in', valor: ['51-200', '201-500', '501-1000', '1001-5000', '5000+'] }, 20),
  regra('Capital social ≥ R$ 1 mi', 'FIT', { tipo: 'campo', campo: 'capitalSocial', op: 'gte', valor: 1000000 }, 10),
  regra('Mais de uma unidade', 'FIT', { tipo: 'campo', campo: 'numeroUnidades', op: 'gte', valor: 2 }, 10),
  // TIMING: existe um momento de construir?
  sinal('Obra nova registrada (CNO)', 'TIMING', 'CNO_NEW', 45, 180),
  sinal('Expansão registrada (CNO)', 'TIMING', 'CNO_EXPANSION', 35, 180),
  sinal('Novo galpão', 'TIMING', 'WAREHOUSE', 50, 240),
  sinal('Nova fábrica', 'TIMING', 'NEW_FACTORY', 55, 270),
  sinal('Novo centro de distribuição', 'TIMING', 'NEW_DC', 55, 270),
  sinal('Novo escritório', 'TIMING', 'NEW_OFFICE', 20, 180),
  sinal('Compra de terreno', 'TIMING', 'LAND_PURCHASE', 40, 365),
  sinal('Expansão anunciada', 'TIMING', 'EXPANSION', 35, 240),
  sinal('Licitação pública', 'TIMING', 'PUBLIC_TENDER', 35, 90),
  sinal('Plano de contratação pública', 'TIMING', 'PUBLIC_PLAN', 20, 180),
  regra('Projeto com início em até 12 meses', 'TIMING', { tipo: 'projeto', inicioEmMeses: 12 }, 30, 365),
  regra('Resposta: projeto em andamento', 'TIMING', { tipo: 'resposta', codigos: ['ACTIVE_PROJECT'] }, 45, 120),
  regra('Resposta: projeto futuro', 'TIMING', { tipo: 'resposta', codigos: ['FUTURE_PROJECT'] }, 25, 180),
  regra('Resposta: sem projeto', 'TIMING', { tipo: 'resposta', codigos: ['NO_PROJECT'] }, -30, 180),
  // INTENT: a empresa demonstra intencao de comprar?
  regra('Pediu orçamento', 'INTENT', { tipo: 'resposta', codigos: ['REQUESTED_BUDGET'] }, 60, 120),
  regra('Pediu análise técnica', 'INTENT', { tipo: 'resposta', codigos: ['REQUESTED_TECHNICAL_ANALYSIS'] }, 50, 120),
  regra('Pediu reunião ou apresentação', 'INTENT', { tipo: 'resposta', codigos: ['REQUESTED_MEETING', 'REQUESTED_PRESENTATION'] }, 35, 90),
  sinal('Projeto identificado', 'INTENT', 'PROJECT_IDENTIFIED', 40, 180),
  sinal('Investimento anunciado', 'INTENT', 'INVESTMENT', 25, 180),
  sinal('Captação de recursos', 'INTENT', 'FUNDING', 20, 180),
  sinal('Contratando engenharia', 'INTENT', 'HIRING_ENGINEERING', 20, 120),
  sinal('Contratando operações', 'INTENT', 'HIRING_OPERATIONS', 10, 120),
  sinal('Mudança no site', 'INTENT', 'WEBSITE_CHANGE', 10, 90),
  sinal('Notícia relevante', 'INTENT', 'NEWS', 10, 120),
  regra('Já tem fornecedor ou escolheu concorrente', 'INTENT', { tipo: 'resposta', codigos: ['ALREADY_HAS_SUPPLIER', 'COMPETITOR_SELECTED'] }, -40, 365),
  regra('Sem interesse', 'INTENT', { tipo: 'resposta', codigos: ['NOT_INTERESTED'] }, -35, 180),
  // RELATIONSHIP: quao perto estamos do decisor?
  regra('Decisor identificado', 'RELATIONSHIP', { tipo: 'contato', decisor: true }, 30),
  regra('Contato com e-mail e telefone', 'RELATIONSHIP', { tipo: 'contato', comEmail: true, comTelefone: true }, 15),
  regra('Falou com o decisor', 'RELATIONSHIP', { tipo: 'resposta', codigos: ['DECISION_MAKER_REACHED'] }, 30, 180),
  regra('Reunião ou visita realizada', 'RELATIONSHIP', { tipo: 'atividade', tipos: ['MEETING', 'VISIT', 'PRESENTATION'] }, 35, 365),
  sinal('Indicação de parceiro', 'RELATIONSHIP', 'PARTNER_REFERRAL', 30, 365),
  regra('Contato inválido', 'RELATIONSHIP', { tipo: 'resposta', codigos: ['INVALID_CONTACT'] }, -15, 90),
  // DATA_QUALITY: da para trabalhar a empresa?
  regra('Dados firmográficos', 'DATA_QUALITY', { tipo: 'completude', campos: ['setor', 'faixaFuncionarios', 'cnae', 'faixaReceita', 'capitalSocial'] }, 20),
  regra('Domínio conhecido', 'DATA_QUALITY', { tipo: 'campo', campo: 'dominio', op: 'existe' }, 10),
  regra('CNPJ conhecido', 'DATA_QUALITY', { tipo: 'campo', campo: 'cnpj', op: 'existe' }, 10),
  regra('Localização', 'DATA_QUALITY', { tipo: 'completude', campos: ['cidade', 'uf'] }, 10),
  regra('Decisor identificado', 'DATA_QUALITY', { tipo: 'contato', decisor: true }, 15),
  regra('Contato profissional com canal', 'DATA_QUALITY', { tipo: 'contato', comCanal: true }, 15),
  regra('Sinal identificado', 'DATA_QUALITY', { tipo: 'sinalQualquer' }, 15),
  regra('Contato verificado', 'DATA_QUALITY', { tipo: 'contato', verificado: true }, 5),
];

// ---------------------------------------------------------------------------
// Personas: mapeamento configuravel cargo/departamento -> persona
// ---------------------------------------------------------------------------
let np = 0;
const rp = (persona: RegraPersona['persona'], campo: RegraPersona['campo'], termos: string[], excluir?: string[]): RegraPersona => ({ id: `RP-${String(++np).padStart(3, '0')}`, persona, campo, termos, excluir, prioridade: np, ativo: true });
export const REGRAS_PERSONA_PADRAO: RegraPersona[] = [
  rp('OWNER', 'cargo', ['socio', 'socia', 'proprietario', 'proprietaria', 'dono', 'dona', 'owner', 'fundador', 'fundadora', 'founder', 'socio diretor', 'socia diretora']),
  rp('CEO', 'cargo', ['ceo', 'diretor geral', 'diretora geral', 'diretor executivo', 'diretora executiva', 'chief executive']),
  rp('PRESIDENT', 'cargo', ['presidente', 'president', 'vice presidente', 'vice president', 'vp']),
  rp('COO', 'cargo', ['coo', 'chief operating', 'diretor de operacoes', 'diretora de operacoes'], ['gerente']),
  rp('INDUSTRIAL_DIRECTOR', 'cargo', ['diretor industrial', 'diretora industrial', 'diretor de producao', 'diretora de producao', 'diretor fabril', 'diretor de manufatura', 'plant director', 'industrial director']),
  rp('ENGINEERING_DIRECTOR', 'cargo', ['diretor de engenharia', 'diretora de engenharia', 'diretor tecnico', 'diretora tecnica', 'engineering director', 'cto']),
  rp('OPERATIONS_DIRECTOR', 'cargo', ['diretor de operacoes', 'diretora de operacoes', 'operations director', 'diretor operacional']),
  rp('EXPANSION_DIRECTOR', 'cargo', ['diretor de expansao', 'diretora de expansao', 'expansion director', 'diretor de novos negocios', 'diretor de desenvolvimento', 'head de expansao', 'gerente de expansao']),
  rp('FACILITIES', 'ambos', ['facilities', 'facility', 'infraestrutura', 'manutencao predial', 'utilidades', 'patrimonio']),
  rp('REAL_ESTATE', 'ambos', ['real estate', 'imobiliario', 'imoveis', 'obras', 'construcao']),
  rp('PROCUREMENT', 'ambos', ['compras', 'suprimentos', 'procurement', 'purchasing', 'comprador', 'compradora', 'sourcing']),
  rp('SUPPLY_CHAIN', 'ambos', ['supply chain', 'supply', 'cadeia de suprimentos', 'planejamento logistico']),
  rp('LOGISTICS', 'ambos', ['logistica', 'logistics', 'distribuicao', 'transportes', 'armazem', 'cd']),
  rp('MANUFACTURING', 'ambos', ['producao', 'manufatura', 'fabrica', 'fabril', 'manufacturing', 'plant', 'pcp']),
  rp('ENGINEERING', 'ambos', ['engenharia', 'engineering', 'engenheiro', 'engenheira', 'projetos', 'manutencao']),
  rp('OPERATIONS', 'ambos', ['operacoes', 'operacao', 'operations', 'operacional']),
];

// ---------------------------------------------------------------------------
// Decision fit: matriz de pesos (persona x porte, senioridade, departamento, projeto x persona)
// ---------------------------------------------------------------------------
const P = (chave: string, valor: number): PesoDecisionFit => ({ chave, valor });
const trio = (persona: string, pequena: number, media: number, grande: number) => [P(`persona.${persona}.pequena`, pequena), P(`persona.${persona}.media`, media), P(`persona.${persona}.grande`, grande)];
export const PESOS_DECISION_FIT_PADRAO: PesoDecisionFit[] = [
  P('porte.pequena.max', 50), P('porte.media.max', 500),
  // cobertura de decisores: HIPOTESE OPERACIONAL do piloto (revisar com dados reais): ideal >= 70, utilizavel 50-69
  P('fit.ideal', 70), P('fit.usavel', 50),
  ...trio('OWNER', 70, 55, 35), ...trio('CEO', 68, 55, 35), ...trio('PRESIDENT', 66, 52, 35), ...trio('COO', 55, 55, 45),
  ...trio('INDUSTRIAL_DIRECTOR', 50, 62, 66), ...trio('ENGINEERING_DIRECTOR', 50, 62, 66), ...trio('OPERATIONS_DIRECTOR', 48, 60, 62), ...trio('EXPANSION_DIRECTOR', 50, 64, 68), ...trio('FACILITIES', 40, 55, 60),
  ...trio('ENGINEERING', 35, 45, 48), ...trio('OPERATIONS', 32, 42, 45), ...trio('MANUFACTURING', 32, 42, 45), ...trio('LOGISTICS', 30, 38, 40), ...trio('SUPPLY_CHAIN', 25, 33, 36), ...trio('PROCUREMENT', 25, 30, 32), ...trio('REAL_ESTATE', 35, 45, 50), ...trio('OTHER', 10, 10, 10),
  P('senioridade.C-level', 20), P('senioridade.Diretor', 18), P('senioridade.Gerente', 10), P('senioridade.Coordenador', 4), P('senioridade.Analista', 0), P('senioridade.Outro', 0),
  P('departamento.engenharia', 8), P('departamento.industrial', 8), P('departamento.producao', 6), P('departamento.expansao', 10), P('departamento.operacoes', 6), P('departamento.facilities', 6), P('departamento.compras', 2), P('departamento.logistica', 4),
  P('projeto.expansao.EXPANSION_DIRECTOR', 15), P('projeto.expansao.INDUSTRIAL_DIRECTOR', 8), P('projeto.expansao.OWNER', 6), P('projeto.expansao.CEO', 6),
  P('projeto.fabrica.INDUSTRIAL_DIRECTOR', 15), P('projeto.fabrica.ENGINEERING_DIRECTOR', 10), P('projeto.fabrica.MANUFACTURING', 6), P('projeto.fabrica.ENGINEERING', 6),
  P('projeto.galpao.LOGISTICS', 10), P('projeto.galpao.OPERATIONS_DIRECTOR', 8), P('projeto.galpao.FACILITIES', 8), P('projeto.galpao.EXPANSION_DIRECTOR', 8),
  P('projeto.cd.LOGISTICS', 12), P('projeto.cd.SUPPLY_CHAIN', 8), P('projeto.cd.OPERATIONS_DIRECTOR', 8), P('projeto.cd.EXPANSION_DIRECTOR', 8),
  P('projeto.escritorio.FACILITIES', 12), P('projeto.escritorio.REAL_ESTATE', 10),
  P('projeto.retrofit.FACILITIES', 12), P('projeto.retrofit.ENGINEERING', 8),
];

export const CONFIG_SCORE_PADRAO: ConfigScore[] = [
  { chave: 'peso.FIT', valor: 0.25 }, { chave: 'peso.TIMING', valor: 0.35 }, { chave: 'peso.INTENT', valor: 0.25 }, { chave: 'peso.RELATIONSHIP', valor: 0.10 }, { chave: 'peso.DATA_QUALITY', valor: 0.05 },
  { chave: 'classe.A+', valor: 85 }, { chave: 'classe.A', valor: 70 }, { chave: 'classe.B', valor: 50 }, { chave: 'classe.C', valor: 30 },
];

/** Probabilidade padrao por estagio (0-1), usada no pipeline ponderado. */
export const PROBABILIDADE_ESTAGIO: Record<Estagio, number> = { DETECTED: 0.02, RESEARCHING: 0.05, QUALIFIED: 0.1, DECISION_MAKER_FOUND: 0.15, CONTACT_STARTED: 0.2, ENGAGED: 0.3, NEED_CONFIRMED: 0.4, PROJECT_RECEIVED: 0.5, ENGINEERING: 0.6, PRICING: 0.65, PROPOSAL_SENT: 0.7, NEGOTIATION: 0.85, WON: 1, LOST: 0, NURTURE: 0.05 };

export const NOME_ESTAGIO: Record<Estagio, string> = { DETECTED: 'Detectada', RESEARCHING: 'Em pesquisa', QUALIFIED: 'Qualificada', DECISION_MAKER_FOUND: 'Decisor encontrado', CONTACT_STARTED: 'Contato iniciado', ENGAGED: 'Engajada', NEED_CONFIRMED: 'Necessidade confirmada', PROJECT_RECEIVED: 'Projeto recebido', ENGINEERING: 'Engenharia', PRICING: 'Precificação', PROPOSAL_SENT: 'Proposta enviada', NEGOTIATION: 'Negociação', WON: 'Ganha', LOST: 'Perdida', NURTURE: 'Nutrição' };

export const NOME_SINAL: Record<TipoSinal, string> = { CNO_NEW: 'Obra nova (CNO)', CNO_EXPANSION: 'Expansão (CNO)', WAREHOUSE: 'Galpão', NEW_FACTORY: 'Nova fábrica', NEW_DC: 'Novo CD', NEW_OFFICE: 'Novo escritório', LAND_PURCHASE: 'Compra de terreno', EXPANSION: 'Expansão', INVESTMENT: 'Investimento', FUNDING: 'Captação', HIRING_ENGINEERING: 'Contratando engenharia', HIRING_OPERATIONS: 'Contratando operações', PUBLIC_TENDER: 'Licitação', PUBLIC_PLAN: 'Plano de contratação', PROJECT_IDENTIFIED: 'Projeto identificado', PARTNER_REFERRAL: 'Indicação de parceiro', WEBSITE_CHANGE: 'Mudança no site', NEWS: 'Notícia', MANUAL: 'Manual' };

export const NOME_CANAL: Record<string, string> = { PHONE: 'Telefone', WHATSAPP: 'WhatsApp', EMAIL: 'E-mail', LINKEDIN: 'LinkedIn', VISIT: 'Visita', REFERRAL: 'Indicação', OTHER: 'Outro' };
export const NOME_TIPO_ATIVIDADE: Record<string, string> = { CALL: 'Ligação', MESSAGE: 'Mensagem', EMAIL: 'E-mail', MEETING: 'Reunião', VISIT: 'Visita', PRESENTATION: 'Apresentação', PROPOSAL: 'Proposta', NOTE: 'Anotação', OTHER: 'Outro' };
export const NOME_TIPO_TAREFA: Record<string, string> = { CALL: 'Ligar', FOLLOW_UP: 'Follow-up', EMAIL: 'Enviar e-mail', MEETING: 'Reunião', RESEARCH: 'Pesquisar', PROPOSAL: 'Proposta', VISIT: 'Visitar', OTHER: 'Outra' };
export const FAIXAS_FUNCIONARIOS = ['1-10', '11-50', '51-200', '201-500', '501-1000', '1001-5000', '5000+'];
export const FAIXAS_RECEITA = ['até 4,8 mi', '4,8-16 mi', '16-90 mi', '90-300 mi', '300 mi+'];
