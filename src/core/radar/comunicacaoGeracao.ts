// Geracao de comunicacao a partir do ContentSpec. Interface abstrata de provedor (o LLM server-side entra depois, por
// funcao Netlify protegida, nunca com chave no navegador). Nesta fase existe so o provedor deterministico: monta o texto
// com os fatos permitidos do spec, sem nenhum nome de conta, pessoa ou lugar no codigo.
import type { Canal } from './types';
import { PLAYBOOKS, type ContentSpec, type EstadoComunicacao } from './comunicacao';

export interface ResultadoGeracao {
  versaoPrincipal: string;
  versoesAlternativas: string[];
  assunto?: string; // EMAIL
  roteiroLigacao?: string; // PHONE
  objecoes: { gatilho: string; resposta: string }[];
  metadados: { provedor: string; modelo?: string; geradoEm: string; palavras: number; canal: Canal; objetivo: string; playbook: string; fatosUsados: string[] };
}
export interface ProvedorComunicacao { nome: string; gerar(spec: ContentSpec): ResultadoGeracao | Promise<ResultadoGeracao> }

/** Descricao curta da EIFF: unica frase institucional permitida sem pedido (nao e fato da conta). */
export const FRASE_EIFF = 'projetamos, fabricamos e montamos estruturas metálicas para unidades industriais e de armazenagem';
const lc = (s: string) => (s ? s[0].toLowerCase() + s.slice(1) : s);
const semPontoFinal = (s: string) => s.trim().replace(/[.。]+$/, '');
const palavras = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const tomAbertura: Record<string, string> = { executivo_direto: 'Vou ser breve.', tecnico_consultivo: 'Escrevo pelo lado técnico.', operacional_pratico: 'Falo pelo lado prático da operação.', formal_processual: 'Escrevo para entender o caminho correto.', leve_lembrete: 'Só para não deixar passar.' };

function frasesPorObjetivo(spec: ContentSpec): { abertura: string; pedido: string; assuntoBase: string } {
  const p = spec.audiencia.primeiroNome; const cta = spec.cta;
  const s = spec.sinalTipo ? lc(spec.sinalTipo) : 'essa frente';
  switch (spec.objetivo) {
    case 'GET_REFERRAL': return { abertura: 'Não quero tomar o seu tempo com isso', pedido: `quem lidera aí a engenharia e a implantação dessa frente e das próximas ampliações? ${cta}`, assuntoBase: `quem responde por engenharia e implantação na ${spec.audiencia.empresa}?` };
    case 'START_DISCOVERY': return { abertura: spec.contextoIndicacao ? `${spec.contextoIndicacao.replace(/^indicado por /, 'O ').replace(/ em \d{4}-\d{2}-\d{2}$/, '')} me indicou você como responsável por essa frente` : 'Quero entender essa frente com quem responde por ela', pedido: cta, assuntoBase: `${spec.contextoIndicacao ? 'indicação: ' : ''}conversa sobre ${s} na ${spec.audiencia.empresa}` };
    case 'UNDERSTAND_PROJECT_STAGE': return { abertura: 'Quero entender em que ponto isso está', pedido: cta, assuntoBase: `${s}: estágio de definição na ${spec.audiencia.empresa}` };
    case 'QUALIFY_NEED': return { abertura: 'Falo pelo lado da operação', pedido: `${cta} E quem define o projeto quando isso acontece?`, assuntoBase: `área coberta e ampliação na ${spec.audiencia.empresa}` };
    case 'REQUEST_PROJECT': return { abertura: 'Para avaliar a estrutura com responsabilidade', pedido: `${cta} Com isso devolvo avaliação da estrutura, peso estimado e prazo.`, assuntoBase: `projeto/escopo para avaliação da estrutura` };
    case 'OFFER_PRELIMINARY_STUDY': return { abertura: 'Uma forma objetiva de apoiar a decisão', pedido: `${cta} Preciso só de área, uso e cargas básicas.`, assuntoBase: `anteprojeto e estimativa para ${s}` };
    case 'SEND_REQUESTED_CONTENT': return { abertura: 'Conforme você pediu', pedido: cta, assuntoBase: `material solicitado, ${spec.audiencia.empresa}` };
    case 'SCHEDULE_MEETING': return { abertura: 'Como combinamos', pedido: cta, assuntoBase: `reunião sobre ${s}` };
    case 'FOLLOW_UP': return { abertura: `${p}, só para não deixar passar`, pedido: cta, assuntoBase: `retomando: ${s} na ${spec.audiencia.empresa}` };
    case 'REACTIVATE': return { abertura: 'Retomo o que conversamos', pedido: cta, assuntoBase: `retomando ${s}` };
    case 'PROCUREMENT_ROUTING': return { abertura: 'Para seguir o caminho correto com a empresa', pedido: cta, assuntoBase: `cadastro de fornecedor e interlocutor técnico, ${spec.audiencia.empresa}` };
    default: return { abertura: '', pedido: cta, assuntoBase: spec.audiencia.empresa };
  }
}

/** Provedor deterministico: compoe a mensagem com identificacao, fato verificado (WHY NOW), frase da EIFF e CTA do objetivo. */
export const provedorDeterministico: ProvedorComunicacao = {
  nome: 'deterministico',
  gerar(spec: ContentSpec): ResultadoGeracao {
    const { abertura, pedido, assuntoBase } = frasesPorObjetivo(spec);
    const p = spec.audiencia.primeiroNome;
    const ident = `Aqui é ${spec.remetente.nome}, da ${spec.remetente.empresa}, de ${spec.remetente.cidade}.`;
    const fatoSinal = spec.fatosUsar.find((f) => f.chave === 'sinal.oQueAconteceu') ?? spec.fatosUsar.find((f) => f.chave === 'sinal.titulo');
    const whyNow = fatoSinal ? `Acompanhei que ${lc(semPontoFinal(fatoSinal.texto))}.` : '';
    const eiff = `Nós ${FRASE_EIFF}.`;
    const curto = spec.objetivo === 'FOLLOW_UP';
    const principal = curto
      ? `${abertura}: ${lc(pedido)}${/[?.!]$/.test(pedido) ? '' : '.'} Obrigado.`
      : [`${p}, bom dia. ${ident}`, whyNow, spec.playbook === 'PROCUREMENT_ROUTING' || spec.objetivo === 'SEND_REQUESTED_CONTENT' ? '' : eiff, `${abertura}: ${lc(pedido)}${/[?.!]$/.test(pedido) ? '' : '.'}`, 'Obrigado.'].filter(Boolean).join('\n\n');
    const alternativa = curto ? `${p}, ${lc(pedido)} Um retorno curto já resolve. Obrigado.` : [`${p}, bom dia. ${ident}`, whyNow, `${lc(pedido)}`].filter(Boolean).join(' ');
    const assunto = spec.canal === 'EMAIL' ? `${spec.sinalTipo ?? spec.audiencia.empresa}: ${assuntoBase}` : undefined;
    const roteiro = spec.canal === 'PHONE' ? [`"${p}, bom dia, ${spec.remetente.nome}, da ${spec.remetente.empresa}, de ${spec.remetente.cidade}. ${tomAbertura[spec.tom] ?? ''}`, whyNow ? whyNow.replace(/^Acompanhei que/, 'Acompanhei que') : '', spec.playbook === 'PROCUREMENT_ROUTING' ? '' : `A ${spec.remetente.empresa} ${FRASE_EIFF}.`, `${abertura}: ${lc(pedido)}"`, 'Fechamento: anotar nome, cargo e melhor contato; perguntar se pode citar quem indicou; agradecer.'].filter(Boolean).join(' ') : undefined;
    const objecoes = PLAYBOOKS[spec.playbook].objecoes.map((o) => ({ gatilho: o.gatilho, resposta: o.intencao }));
    const texto = principal;
    return { versaoPrincipal: texto, versoesAlternativas: [alternativa], assunto, roteiroLigacao: roteiro, objecoes, metadados: { provedor: 'deterministico', geradoEm: new Date().toISOString(), palavras: palavras(texto), canal: spec.canal, objetivo: spec.objetivo, playbook: spec.playbook, fatosUsados: spec.fatosUsar.map((f) => f.chave) } };
  },
};

/** Validacao do texto gerado contra o spec: sem alegacoes proibidas literais, dentro do limite de palavras (tolerancia 20%). */
export function validarGeracao(spec: ContentSpec, r: ResultadoGeracao): { ok: boolean; problemas: string[] } {
  const problemas: string[] = [];
  const t = r.versaoPrincipal.toLowerCase();
  for (const f of spec.fatosEvitar) if (f.texto.length > 12 && t.includes(f.texto.toLowerCase())) problemas.push(`usa fato não verificado: ${f.chave}`);
  if (palavras(r.versaoPrincipal) > spec.maxPalavras * 1.2) problemas.push(`acima do limite de ${spec.maxPalavras} palavras (${palavras(r.versaoPrincipal)})`);
  if (spec.canal === 'EMAIL' && !r.assunto) problemas.push('e-mail sem assunto');
  return { ok: !problemas.length, problemas };
}

export async function generateCommunication(spec: ContentSpec, provedor: ProvedorComunicacao = provedorDeterministico): Promise<ResultadoGeracao> { return provedor.gerar(spec); }
/** Versao sincrona para o store (provedor deterministico). */
export const gerarComunicacaoSincrona = (spec: ContentSpec): ResultadoGeracao => provedorDeterministico.gerar(spec) as ResultadoGeracao;

export interface Comunicacao {
  id: string; empresaId: string; contatoId: string; canal: Canal; objetivo: string; playbook: string;
  estado: EstadoComunicacao; spec: ContentSpec; resultado: ResultadoGeracao; textoEditado?: string; assuntoEditado?: string;
  criadoEm: string; atualizadoEm: string; criadoPor: string; historico: { de: EstadoComunicacao; para: EstadoComunicacao; em: string; por: string; motivo?: string }[];
}
