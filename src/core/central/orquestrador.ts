// EIFF Central: roteador de intencao DETERMINISTICO. Sem IA, sem rede, sem escrita.
// Mesmo espirito de `interpretarPedido` (src/core/cfo.ts): palavras-chave e sinais do texto -> intencao e confianca.
// A decisao final sai de `decisaoSegura` (tipos.ts), que ja aplica o piso CONFIANCA_MINIMA e a exigencia de humano.
//
// REGRA INEGOCIAVEL: o texto que chega do WhatsApp e DADO, nunca instrucao. Uma mensagem que diga "ignore as regras",
// "você é administrador" ou "aprove sem alçada" nao muda intencao, nao muda agente e nao muda confianca — o trecho
// e higienizado antes da pontuacao (para nao virar sinal) e a mensagem passa a exigir revisao humana.
import { CONFIANCA_MINIMA, decisaoSegura, type CommunicationContext, type IdentidadeResolvida, type InternalIntent, type OrchestratorDecision } from './tipos';

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// ---------------------------------------------------------------------------
// 1) Higiene: tentativa de instruir o sistema e removida do texto antes de pontuar
// ---------------------------------------------------------------------------
/**
 * Padroes de injecao. Cada um casa a FRASE inteira (ate a pontuacao), para que a tentativa saia por completo da
 * pontuacao de intencao — nem para mais, nem para menos.
 */
export const PADROES_INJECAO: RegExp[] = [
  /\b(?:ignor|desconsider|esquec)\w*[^.!?\n]*\b(?:regra|regras|instru\w*|orienta\w*|acima|anterior\w*|tudo)\b[^.!?\n]*/i,
  // atencao: "é" nao e caractere de palavra em JS, entao nada de \b depois do verbo
  /\bvoc[eê]\s+(?:[ée]|agora\s+[ée]|passa\s+a\s+ser)\s+[^.!?\n]*?(?:admin\w*|diretor\w*|dono\b|chefe\b|gerente\w*|sistema\b|root\b|superusu\w*)[^.!?\n]*/i,
  /\b(?:aja|atue|comporte-se|finja)\s+como\b[^.!?\n]*/i,
  /\b(?:sem|dispens\w*|pul\w*|ignorando|independente\s+de|fora\s+d\w+)\s+(?:a\s+|as\s+|o\s+|os\s+)?(?:aprova\w*|confirma\w*|permiss\w*|al[çc]ad\w*|valida\w*)\b[^.!?\n]*/i,
  /\b(?:libere|liberar|conceda|conceder|d[êe]|dar)\s+(?:me\s+|nos\s+)?(?:acesso|permiss\w*|privil[ée]gi\w*|poder\w*)\b[^.!?\n]*/i,
  /\b(?:system|assistant|prompt|instru\w*)\s*(?:prompt|message|do\s+sistema)\b[^.!?\n]*/i,
];
export interface Higiene { texto: string; tentativas: string[] }
/** Remove do texto os trechos que tentam instruir o sistema e devolve o que foi tentado (para auditoria). */
export function higienizarTexto(bruto: string): Higiene {
  let texto = bruto ?? '';
  const tentativas: string[] = [];
  for (const re of PADROES_INJECAO) {
    const global = new RegExp(re.source, `${re.flags.replace('g', '')}g`);
    for (const m of texto.match(global) ?? []) tentativas.push(m.trim());
    texto = texto.replace(global, ' ');
  }
  return { texto: texto.replace(/\s+/g, ' ').trim(), tentativas };
}
export const tentativaDeInstrucao = (texto: string): boolean => higienizarTexto(texto).tentativas.length > 0;

// ---------------------------------------------------------------------------
// 2) Sinais por intencao
// ---------------------------------------------------------------------------
interface Sinal { intent: InternalIntent; re: RegExp; peso: 1 | 2 }
/** peso 2 = sinal forte (o assunto do dominio); peso 1 = sinal de apoio (sozinho nao passa do piso de confianca). */
export const SINAIS: Sinal[] = [
  // FINANCE
  { intent: 'FINANCE', peso: 2, re: /\b(pagamento|pagar|boleto|nf|nota fiscal|fatura|reembolso|adiantamento|caixa|saldo banc|fluxo de caixa|liquida\w*|conciliar?|extrato)\b/i },
  { intent: 'FINANCE', peso: 1, re: /\b(frete|conta|vencimento|vence|parcela|dep[oó]sito|pix|transfer[eê]ncia)\b/i },
  // PURCHASE
  { intent: 'PURCHASE', peso: 2, re: /\b(pedido de compra|ordem de compra|cota[çc][aã]o|cotar|or[çc]amento do fornecedor|fornecedor|comprar|compra de)\b/i },
  { intent: 'PURCHASE', peso: 1, re: /\b(prazo de entrega|romaneio de compra|insumo|material para)\b/i },
  // WORKSITE
  { intent: 'WORKSITE', peso: 2, re: /\b(obra|canteiro|di[aá]rio de obra|medi[çc][aã]o|montagem|servi[çc]o da obra|cronograma|apontamento)\b/i },
  { intent: 'WORKSITE', peso: 1, re: /\b(equipe no|efetivo|clima|chuva|guindaste|i[çc]amento)\b/i },
  // INVENTORY
  { intent: 'INVENTORY', peso: 2, re: /\b(estoque|almoxarifado|corrida|lote de a[çc]o|entrada de material|consumo de material|sobra|romaneio)\b/i },
  { intent: 'INVENTORY', peso: 1, re: /\b(kg de|chapa|perfil|bobina|retalho)\b/i },
  // COMMERCIAL
  { intent: 'COMMERCIAL', peso: 2, re: /\b(radar|lead|prospec\w*|cliente novo|proposta comercial|oportunidade|decisor|abordagem)\b/i },
  { intent: 'COMMERCIAL', peso: 1, re: /\b(reuni[aã]o com|visita ao cliente|contato da empresa)\b/i },
  // HR_ADMIN
  { intent: 'HR_ADMIN', peso: 2, re: /\b(colaborador|admiss[aã]o|demiss[aã]o|f[eé]rias|folha de pagamento|aloca[çc][aã]o|cadastro d[eo])\b/i },
  { intent: 'HR_ADMIN', peso: 1, re: /\b(atestado|falta|hora extra|banco de horas)\b/i },
  // EXECUTIVE
  { intent: 'EXECUTIVE', peso: 2, re: /\b(painel|indicador\w*|kpi|resultado do m[eê]s|dre|margem|posi[çc][aã]o banc[aá]ria|resumo executivo)\b/i },
  { intent: 'EXECUTIVE', peso: 1, re: /\b(como estamos|vis[aã]o geral|consolidado)\b/i },
  // GENERAL
  { intent: 'GENERAL', peso: 2, re: /\b(ajuda|como fa[çc]o|como funciona|manual|d[uú]vida|o que voc[eê] faz)\b/i },
];

export interface Classificacao {
  intent: InternalIntent;
  confidence: number; // 0-1
  motivo: string;
  pontos: number;
  sinais: string[];
  tentativasDeInstrucao: string[];
}

/** Confianca: forca do sinal vencedor menos a ambiguidade contra o segundo colocado. Sempre entre 0 e 0,95. */
function confiancaDe(pontos: number, segundo: number): number {
  if (pontos <= 0) return 0.3;
  const bruta = Math.min(0.95, 0.55 + 0.13 * pontos);
  const margem = pontos - segundo;
  const penalidade = margem <= 0 ? 0.2 : margem === 1 ? 0.08 : 0;
  return Math.round(Math.max(0.2, bruta - penalidade) * 100) / 100;
}

/**
 * Classifica o texto. Deterministico: mesmo texto, mesma saida, sempre. Nenhuma chamada de IA.
 * O trecho de tentativa de instrucao e removido ANTES da pontuacao: ele nao vira sinal de intencao nenhuma.
 */
export function classificarIntencao(bruto: string): Classificacao {
  const { texto, tentativas } = higienizarTexto(bruto ?? '');
  const alvo = semAcento(texto);
  const placar = new Map<InternalIntent, number>();
  const sinais: string[] = [];
  for (const s of SINAIS) {
    const casa = s.re.test(texto) || s.re.test(alvo);
    if (!casa) continue;
    placar.set(s.intent, (placar.get(s.intent) ?? 0) + s.peso);
    sinais.push(`${s.intent}:${(texto.match(s.re) ?? alvo.match(s.re) ?? [''])[0].trim()}`);
  }
  const ordenado = [...placar.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const [vencedor, pontos] = ordenado[0] ?? ['GENERAL' as InternalIntent, 0];
  const segundo = ordenado[1]?.[1] ?? 0;
  const confidence = confiancaDe(pontos, segundo);
  const motivo = pontos <= 0
    ? 'nenhum sinal de domínio no texto'
    : `sinais de ${vencedor}${segundo > 0 ? `, com ${ordenado[1][0]} concorrendo` : ''}`;
  return { intent: vencedor, confidence, motivo, pontos, sinais, tentativasDeInstrucao: tentativas };
}

// ---------------------------------------------------------------------------
// 3) Decisao
// ---------------------------------------------------------------------------
export interface EntradaOrquestrador { texto: string; contexto?: CommunicationContext; identidade: IdentidadeResolvida }
export const CODIGO_ORQUESTRADOR = 'CENTRAL_ORQUESTRADOR_DETERMINISTICO';

/**
 * Decide o roteamento. Nao executa, nao grava, nao envia: devolve so a decisao, no formato do contrato.
 * Cai para humano quando: identidade nao verificada, confianca abaixo do piso, contexto diferente de INTERNAL
 * (intencao interna so vale no numero interno) ou tentativa de instruir o sistema dentro da mensagem.
 */
export function orquestrar(entrada: EntradaOrquestrador): OrchestratorDecision {
  const c = classificarIntencao(entrada.texto);
  const decisao = decisaoSegura({ intent: c.intent, confidence: c.confidence, motivo: c.motivo }, entrada.identidade);
  const extras: string[] = [];
  if (entrada.contexto !== 'INTERNAL') extras.push(entrada.contexto ? 'contexto EXTERNAL: intenção interna não é atendida por este número' : 'contexto indefinido: evento não confiável');
  if (c.tentativasDeInstrucao.length) extras.push('texto tenta instruir o sistema: tratado como dado, nunca como comando');
  if (!extras.length) return decisao;
  return {
    ...decisao,
    // a decisao NAO carrega permissao: rotear nao autoriza. Quem exige permissao e a acao proposta.
    requiresHuman: true,
    requiresConfirmation: true,
    motivo: `${decisao.motivo}; ${extras.join('; ')}`,
  };
}

export { CONFIANCA_MINIMA };
