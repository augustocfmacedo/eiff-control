// Geracao de comunicacao a partir do ContentSpec. Interface abstrata de provedor (o LLM server-side entra depois, por
// funcao Netlify protegida, nunca com chave no navegador). Provedor deterministico: compoe o texto SOMENTE com
// allowedClaims, sem nome de conta, pessoa ou lugar no codigo. Fact gate deterministico antes (spec) e depois (validarGeracao).
import type { Canal } from './types';
import { escopoDoClaim, CLAIMS_TECNICOS, PLAYBOOKS, type Claim, type ContentSpec, type EstadoComunicacao } from './comunicacao';

export const PROMPT_VERSION = 'deterministico-2';
export interface ResultadoGeracao {
  versaoPrincipal: string;
  versoesAlternativas: string[];
  assunto?: string; // EMAIL
  roteiroLigacao?: string; // PHONE
  objecoes: { gatilho: string; resposta: string }[];
  claimsUsados: string[]; // ids dos allowedClaims efetivamente usados
  metadados: { provedor: string; modelo?: string; promptVersao: string; geradoEm: string; palavras: number; canal: Canal; objetivo: string; playbook: string; contextHash: string; versoes: { playbook: string; contentSpec: string }; inputTokens?: number; outputTokens?: number; latenciaMs?: number; regenerado?: boolean; juiz?: { modelo: string; inputTokens: number; outputTokens: number; latenciaMs: number } };
}
export interface ProvedorComunicacao { nome: string; modelo?: string; gerar(spec: ContentSpec): ResultadoGeracao | Promise<ResultadoGeracao> }
/** Validacao semantica futura (server-side, com LLM): mesma assinatura da deterministica. */
export interface ValidadorComunicacao { nome: string; validar(spec: ContentSpec, r: ResultadoGeracao): Promise<ValidacaoGeracao> | ValidacaoGeracao }
export interface ValidacaoGeracao { ok: boolean; problemas: string[] }

const lc = (s: string) => (s ? s[0].toLowerCase() + s.slice(1) : s);
const semPontoFinal = (s: string) => s.trim().replace(/[.。]+$/, '');
const palavras = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
const tecnico = (spec: ContentSpec, chave: keyof typeof CLAIMS_TECNICOS): Claim | undefined => spec.technicalClaims.find((c) => c.id === `tec:${chave}` && c.aprovado);

/** Saudacao pelo horario local; sem horario, neutra. Nunca "bom dia" fixo. */
export function saudacao(primeiroNome: string, horaLocal?: number): string {
  if (horaLocal === undefined || !Number.isFinite(horaLocal)) return `Olá, ${primeiroNome}.`;
  const h = ((Math.floor(horaLocal) % 24) + 24) % 24;
  return `${primeiroNome}, ${h < 12 ? 'bom dia' : h < 18 ? 'boa tarde' : 'boa noite'}.`;
}
const tomAbertura: Record<string, string> = { executivo_direto: 'Vou ser breve.', tecnico_consultivo: 'Escrevo pelo lado técnico.', operacional_pratico: 'Falo pelo lado prático da operação.', formal_processual: 'Escrevo para entender o caminho correto.', leve_lembrete: 'Só para não deixar passar.' };

/** Abertura neutra quando nao se pode citar quem indicou (INTERNAL_ONLY) nem ha claim que sustente responsabilidade do destinatario.
 *  Nunca afirma que o destinatario e responsavel, lidera, conduz ou e dono da frente; em GET_REFERRAL, isso contradiria o proprio pedido. */
export function aberturaNeutra(objetivo: ContentSpec['objetivo']): string {
  return objetivo === 'GET_REFERRAL' ? 'Estou tentando chegar à pessoa que conduz essa frente internamente' : 'Cheguei ao seu contato ao buscar quem acompanha essa frente';
}
function frasesPorObjetivo(spec: ContentSpec, usados: Set<string>): { abertura: string; pedido: string; assuntoBase: string } {
  const p = spec.audiencia.primeiroNome; const cta = spec.cta;
  const s = spec.referenciaPublica ? lc(spec.referenciaPublica) : 'essa frente'; // referencia publica; o tipo interno do sinal nunca chega ao texto
  const aval = tecnico(spec, 'AVALIACAO_PRELIMINAR'); const insumos = tecnico(spec, 'INSUMOS_ESTUDO');
  switch (spec.objetivo) {
    case 'GET_REFERRAL': return { abertura: 'Não quero tomar o seu tempo com isso', pedido: `quem lidera aí a engenharia e a implantação dessa frente e das próximas ampliações? ${cta}`, assuntoBase: `quem responde por engenharia e implantação na ${spec.audiencia.empresa}?` };
    case 'START_DISCOVERY': {
      const citar = spec.sourceDisclosure === 'ALLOWED' && spec.contextoIndicacao?.startsWith('indicado por ');
      const quem = citar ? spec.contextoIndicacao!.replace(/^indicado por /, '').replace(/ em \d{4}-\d{2}-\d{2}$/, '') : undefined;
      return { abertura: quem ? `${quem} me indicou você como responsável por essa frente` : aberturaNeutra(spec.objetivo), pedido: cta, assuntoBase: `conversa sobre ${s} na ${spec.audiencia.empresa}` };
    }
    case 'UNDERSTAND_PROJECT_STAGE': return { abertura: 'Quero entender em que ponto isso está', pedido: cta, assuntoBase: `${s}: estágio de definição na ${spec.audiencia.empresa}` };
    case 'QUALIFY_NEED': return { abertura: 'Falo pelo lado da operação', pedido: `${cta} E quem define o projeto quando isso acontece?`, assuntoBase: `área coberta e ampliação na ${spec.audiencia.empresa}` };
    case 'REQUEST_PROJECT': { if (aval) usados.add(aval.id); return { abertura: 'Para avaliar com responsabilidade', pedido: aval ? `você consegue me enviar o projeto ou o escopo? Com isso consigo ${aval.texto}.` : cta, assuntoBase: 'projeto ou escopo para avaliação preliminar' }; }
    case 'OFFER_PRELIMINARY_STUDY': { const ante = tecnico(spec, 'ANTEPROJETO'); if (ante) usados.add(ante.id); if (insumos) usados.add(insumos.id); return { abertura: 'Uma forma objetiva de apoiar a decisão', pedido: ante ? `posso ${ante.texto}? Para isso preciso ${insumos ? insumos.texto : 'entender as premissas do projeto'}.` : cta, assuntoBase: `anteprojeto para ${s}` }; }
    case 'SEND_REQUESTED_CONTENT': return { abertura: 'Conforme você pediu', pedido: cta, assuntoBase: `material solicitado, ${spec.audiencia.empresa}` };
    case 'SCHEDULE_MEETING': return { abertura: 'Como combinamos', pedido: cta, assuntoBase: `reunião sobre ${s}` };
    case 'FOLLOW_UP': return { abertura: `${p}, só para não deixar passar`, pedido: cta, assuntoBase: `retomando: ${s} na ${spec.audiencia.empresa}` };
    case 'REACTIVATE': return { abertura: 'Retomo o que conversamos', pedido: cta, assuntoBase: `retomando ${s}` };
    case 'PROCUREMENT_ROUTING': return { abertura: 'Para seguir o caminho correto com a empresa', pedido: cta, assuntoBase: `cadastro de fornecedor e interlocutor técnico, ${spec.audiencia.empresa}` };
    default: return { abertura: '', pedido: cta, assuntoBase: spec.audiencia.empresa };
  }
}

/** Provedor deterministico: identificacao, fato do sinal (referido pela fonte real), frase da EIFF (claim tecnico aprovado) e CTA do objetivo. */
export const provedorDeterministico: ProvedorComunicacao = {
  nome: 'deterministico',
  gerar(spec: ContentSpec): ResultadoGeracao {
    const usados = new Set<string>();
    const { abertura, pedido, assuntoBase } = frasesPorObjetivo(spec, usados);
    const p = spec.audiencia.primeiroNome;
    const ident = `Aqui é ${spec.remetente.nome}, da ${spec.remetente.empresa}, de ${spec.remetente.cidade}.`;
    const fatoWhat = spec.allowedClaims.find((f) => f.chave === 'sinal.oQueAconteceu'); const fatoTitulo = spec.allowedClaims.find((f) => f.chave === 'sinal.titulo');
    // WHAT do analista (frase completa) entra como oracao; so o titulo entra como referencia na linguagem da fonte
    let whyNow = '';
    if (fatoWhat) { whyNow = `Acompanhei que ${lc(semPontoFinal(fatoWhat.texto))}.`; usados.add(fatoWhat.id); }
    else if (fatoTitulo && spec.referenciaSinal) { whyNow = `Acompanhei ${spec.referenciaSinal}${fatoTitulo.eventoEm ? ` (${fatoTitulo.eventoEm.slice(0, 10).split('-').reverse().join('/')})` : ''}.`; usados.add(fatoTitulo.id); }
    const desc = tecnico(spec, 'DESCRICAO_EIFF');
    const eiff = desc && spec.playbook !== 'PROCUREMENT_ROUTING' && spec.objetivo !== 'SEND_REQUESTED_CONTENT' ? `Nós ${desc.texto}.` : '';
    if (eiff && desc) usados.add(desc.id);
    const curto = spec.objetivo === 'FOLLOW_UP';
    const fecho = (t: string) => `${t}${/[?.!]$/.test(t) ? '' : '.'}`;
    const principal = curto
      ? `${abertura}: ${fecho(lc(pedido))} Obrigado.`
      : [`${saudacao(p, spec.horaLocal)} ${ident}`, whyNow, eiff, `${abertura}: ${fecho(lc(pedido))}`, 'Obrigado.'].filter(Boolean).join('\n\n');
    const alternativa = curto ? `${p}, ${fecho(lc(pedido))} Um retorno curto já resolve. Obrigado.` : [`${saudacao(p, spec.horaLocal)} ${ident}`, whyNow, fecho(lc(pedido))].filter(Boolean).join(' ');
    const assunto = spec.canal === 'EMAIL' ? `${spec.referenciaPublica ? spec.referenciaPublica[0].toUpperCase() + spec.referenciaPublica.slice(1) : spec.audiencia.empresa}: ${assuntoBase}` : undefined;
    const roteiro = spec.canal === 'PHONE' ? [`"${saudacao(p, spec.horaLocal).replace(/\.$/, ',')} ${spec.remetente.nome}, da ${spec.remetente.empresa}, de ${spec.remetente.cidade}. ${tomAbertura[spec.tom] ?? ''}`, whyNow, eiff ? `A ${spec.remetente.empresa} ${desc!.texto}.` : '', `${abertura}: ${fecho(lc(pedido))}"`, 'Fechamento: anotar nome, cargo e melhor contato; perguntar se pode citar quem indicou; agradecer.'].filter(Boolean).join(' ') : undefined;
    const objecoes = PLAYBOOKS[spec.playbook].objecoes.map((o) => ({ gatilho: o.gatilho, resposta: o.intencao }));
    return { versaoPrincipal: principal, versoesAlternativas: [alternativa], assunto, roteiroLigacao: roteiro, objecoes, claimsUsados: [...usados], metadados: { provedor: 'deterministico', promptVersao: PROMPT_VERSION, geradoEm: new Date().toISOString(), palavras: palavras(principal), canal: spec.canal, objetivo: spec.objetivo, playbook: spec.playbook, contextHash: spec.contextHash, versoes: spec.versoes } };
  },
};

// ---------------------------------------------------------------------------------------------------------------------
// Fact gate pos-geracao (deterministico)
// ---------------------------------------------------------------------------------------------------------------------
const NUM = /R\$\s?[\d.,]+\s?(?:mil|milh[õo]es|bi)?|\b\d[\d.,]*\s?(?:mil|milh[õo]es|m²|m2|ha|km|%)?\b/gi;
const DATA = /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b|\b(?:19|20)\d{2}\b/g;
/** Entidades nomeadas simples: sequencias de palavras capitalizadas (lugares, unidades, projetos). */
const ENT = /\b[A-ZÁÉÍÓÚÂÊÔÃÕÇ][\wáéíóúâêôãõç]{3,}(?:\s+(?:d[aeo]s?\s+)?[A-ZÁÉÍÓÚÂÊÔÃÕÇ][\wáéíóúâêôãõç]{2,})*/g;
const extrair = (re: RegExp, s: string) => [...new Set((s.match(re) ?? []).map((x) => norm(x.trim())))];
const faltantes = (base: string, itens: string[]) => itens.filter((i) => !base.includes(i));
/** Entidades capitalizadas que NAO iniciam frase (inicio de frase e maiuscula por gramatica, nao por nome proprio). */
function entidadesNomeadas(texto: string): string[] {
  const out = new Set<string>();
  for (const m of texto.matchAll(ENT)) {
    const antes = texto.slice(0, m.index).replace(/[\s"'(]+$/, '');
    if (!antes || /[.!?:\n]$/.test(antes)) continue;
    const e = norm(m[0].trim());
    if (e.length > 4 && e !== 'eiff') out.add(e);
  }
  return [...out];
}
const DETECTORES_OBRIGATORIOS: [RegExp, (spec: ContentSpec, t: string) => boolean][] = [
  [/identifica/i, (spec, t) => t.includes(norm(spec.remetente.nome)) && t.includes(norm(spec.remetente.empresa))],
  [/fato verificado/i, (spec, t) => !spec.sinalId || spec.objetivo === 'FOLLOW_UP' || spec.allowedClaims.filter((c) => c.origem === 'sinal').some((c) => t.includes(norm(semPontoFinal(c.texto)).slice(0, 30))) || (!!spec.referenciaSinal && t.includes(norm(spec.referenciaSinal)))],
  [/frase sobre a eiff/i, (_spec, t) => t.includes('estruturas metalicas')],
  [/pergunta de roteamento|pedido de encaminhamento|pergunta sobre o est[aá]gio|pergunta [uú]nica|pedido de conversa|pedido de cadastro|pedido do interlocutor|pergunta sobre necessidade|pergunta sobre quem define|pedido do projeto|oferta do estudo|oferta de apoio/i, (_spec, t) => t.includes('?')],
  [/origem da indica/i, (spec, t) => spec.sourceDisclosure !== 'ALLOWED' || !spec.contextoIndicacao?.startsWith('indicado por ') || t.includes('me indicou')],
  [/refer[eê]ncia [àa] tentativa anterior|refer[eê]ncia ao que foi dito/i, (_spec, t) => /nao deixar passar|retomo|conversamos|combinamos|voltando/.test(t)],
  [/o que ser[aá] devolvido|insumos necess[aá]rios/i, (spec, t) => spec.technicalClaims.some((c) => t.includes(norm(c.texto).slice(0, 25)))],
];
const PROIBIDOS: [RegExp, RegExp][] = [
  [/pre[cç]o/i, /\bpreco|\borcamento|\bcotacao de preco/],
  [/desconto/i, /\bdesconto/],
  [/proposta/i, /\bproposta comercial|\bnossa proposta/],
  [/cat[aá]logo|portf[oó]lio/i, /\bcatalogo|\bportfolio/],
  [/reuni[aã]o como primeiro/i, /\bmarcar (uma )?reuniao|\bagendar/],
  [/urg[eê]ncia/i, /\burgente|\bainda hoje|\bultima chance/],
  [/pedido de indica/i, /\bindicar quem responde/],
  [/anexos/i, /\bem anexo|\bsegue anexo/],
  [/tom de cobran[cç]a/i, /\bcobrar|\bvoce nao respondeu/],
];
const PRESUNCOES: [RegExp, string][] = [
  [/\bprojeto em aberto|\bem contratacao|\blicitacao aberta|\bestao contratando|\bvoces vao contratar/, 'presume projeto aberto ou contratação'],
  [/\bsua obra\b|\bseu projeto\b|\bvoce e o responsavel|\bcomo responsavel pela obra/, 'presume responsabilidade do contato'],
  [/\bgarant\w+|\beconomia de|\breducao de custo|\bprazo de \d|\bpeso estimado|\bmais barato/, 'promete preço, prazo, economia ou engenharia sem autorização'],
];

// Detector contextual (Live Calibration 01): o texto apresenta o DESTINATARIO como responsavel/lider/dono/condutor da frente.
// Bloqueia "cheguei ao seu contato como responsável por essa frente", "você conduz/lidera essa frente", "seu nome como responsável";
// nao bloqueia a pergunta "quem responde por essa frente?" (um "quem" entre o pronome e o papel encerra a busca).
const ATRIBUI_RESPONSABILIDADE: RegExp[] = [
  /\b(seu contato|seu nome|voce|voces|a voce|ate voce|com voce)\b(?:(?!\bquem\b)[^.?!;])*?\b(como|e|sendo|enquanto)\s+(o |a )?(responsavel|lider|dono|dona|encarregad\w*|gestor\w*|pessoa que (conduz|lidera|responde|cuida))\b/,
  /\bvoce\s+(conduz|lidera|comanda|coordena|responde por|esta a frente|toca|cuida d)\b/,
  /\b(seu contato|seu nome)\b(?:(?!\bquem\b)[^.?!;])*?\b(a frente d|conduz|lidera|coordena)\b/,
];
/** Regra contextual: em GET_REFERRAL e proibido sempre (pedimos indicacao justamente porque nao sabemos quem responde);
 *  nos demais objetivos so passa quando existe indicacao real e autorizada (REFERRAL_INTRODUCTION: "Fulano me indicou você como responsável"). */
export function presumeResponsabilidade(spec: Pick<ContentSpec, 'objetivo' | 'sourceDisclosure' | 'contextoIndicacao'>, textoNormalizado: string): boolean {
  const indicacaoAutorizada = spec.sourceDisclosure === 'ALLOWED' && !!spec.contextoIndicacao;
  if (spec.objetivo !== 'GET_REFERRAL' && indicacaoAutorizada) return false;
  return ATRIBUI_RESPONSABILIDADE.some((re) => re.test(textoNormalizado));
}

// ---------------------------------------------------------------------------------------------------------------------
// Relational Fact Binding (Live Calibration 02): fatos verdadeiros isoladamente nao autorizam uma relacao nova. A base
// permitida valida entidades soltas; aqui validamos a LIGACAO. Primeiro caso: LOCALIZACAO (sede da conta != local do evento).
// Extensoes previstas, nao implementadas: numero, data e projeto.
// ---------------------------------------------------------------------------------------------------------------------
const PALAVRAS_EVENTO = /\b(infraestrutura|unidade|fabrica|planta|galpao|armazem|armazenagem|centro de distribuicao|cd|obra|expansao|ampliacao|projeto|inaugur\w*|comunicado|noticia|publicacao|registro de obra|movimento|instalacao|investimento|camara fria|empreendimento|construcao)\b/;
const CIDADE_UF = /\b([A-ZÀ-Ú][\wà-úÀ-Ú.'-]*(?: (?:d[aeo]s?|[A-ZÀ-Ú][\wà-úÀ-Ú.'-]*))*)\s*\/\s*([A-Z]{2})\b/g; // "Cidade/UF", "Porto Nacional/TO"
const SEDE = /\b(sediad\w+|sede|com base|baseada|matriz|escritorio)\b/;
/** Locais mencionados numa frase: pares Cidade/UF e o local da conta (inteiro ou so a cidade). Normalizados. */
export function locaisNaFrase(frase: string, localConta?: string): string[] {
  const t = norm(frase); const out = new Set<string>();
  for (const m of frase.matchAll(CIDADE_UF)) { out.add(norm(`${m[1]}/${m[2]}`)); out.add(norm(m[1])); }
  if (localConta) { const lc = norm(localConta); const cidade = lc.split('/')[0].trim(); if (lc && t.includes(lc)) out.add(lc); if (cidade.length > 3 && new RegExp(`\\b${cidade.replace(/[.*+?^${}()|[\]\\]/g, '\\/** Fact gate pos-geracao: numeros, datas e entidades so de allowedClaims; elementos obrigatorios/proibidos; CTA do objetivo; sem presuncoes. */')}\\b`).test(t)) out.add(cidade); }
  return [...out];
}
/** Frases que falam do sinal/evento so podem citar um local presente em claim do sinal (SIGNAL_FACT ou SIGNAL_LOCATION).
 *  audiencia.local e contexto da CONTA e, sozinho, nao basta; "sediada em X" na mesma frase e permitido (fala da sede, nao do evento). */
export function localEventoNaoSuportado(spec: Pick<ContentSpec, 'allowedClaims' | 'audiencia'>, texto: string): string[] {
  const doSinal = norm(spec.allowedClaims.filter((c) => { const e = escopoDoClaim(c); return e === 'SIGNAL_FACT' || e === 'SIGNAL_LOCATION'; }).map((c) => c.texto).join(' | '));
  const problemas: string[] = [];
  for (const frase of texto.split(/(?<=[.!?])\s+|\n+/)) {
    const nf = norm(frase); if (!PALAVRAS_EVENTO.test(nf)) continue;
    const locais = locaisNaFrase(frase, spec.audiencia.local);
    for (const local of locais.filter((l) => !locais.some((o) => o !== l && o.startsWith(`${l}/`)))) { // "cidade" e "cidade/uf" contam uma vez
      if (doSinal.includes(local)) continue;
      const antes = nf.slice(Math.max(0, nf.indexOf(local) - 30), nf.indexOf(local));
      if (SEDE.test(antes)) continue; // "empresa sediada em X" fala da conta, nao do evento
      const msg = `local do evento não suportado pelo sinal: ${local}`; if (!problemas.includes(msg)) problemas.push(msg);
    }
  }
  return problemas;
}

/** Diferenca estrutural entre o snapshot persistido (contentSpecPersistivel: deniedClaims sem texto, technicalClaims como ids)
 *  e o ContentSpec completo que o fact gate exige. Devolve os motivos; vazio = completo. Defesa: nunca TypeError. */
export function problemasEstruturaisDoSpec(spec: unknown): string[] {
  const p: string[] = [];
  if (!spec || typeof spec !== 'object') return ['content spec ausente'];
  const s = spec as Record<string, unknown>;
  const lista = (nome: string) => { const v = s[nome]; if (!Array.isArray(v)) { p.push(`${nome} ausente`); return []; } return v as unknown[]; };
  for (const nome of ['allowedClaims', 'deniedClaims', 'technicalClaims']) { const v = lista(nome); if (v.some((c) => !c || typeof c !== 'object' || typeof (c as Record<string, unknown>).texto !== 'string')) p.push(`${nome} sem texto (snapshot minimizado)`); }
  for (const nome of ['elementosObrigatorios', 'elementosProibidos']) if (!Array.isArray(s[nome])) p.push(`${nome} ausente`);
  for (const nome of ['audiencia', 'remetente']) if (!s[nome] || typeof s[nome] !== 'object') p.push(`${nome} ausente`);
  if (typeof s.cta !== 'string' || typeof s.objetivo !== 'string' || typeof s.canal !== 'string') p.push('objetivo, canal ou cta ausente');
  if (typeof s.maxPalavras !== 'number') p.push('maxPalavras ausente');
  return p;
}
export const ehContentSpecCompleto = (spec: unknown): spec is ContentSpec => problemasEstruturaisDoSpec(spec).length === 0;
/** Fact gate pos-geracao: numeros, datas e entidades so de allowedClaims; elementos obrigatorios/proibidos; CTA do objetivo; sem presuncoes. */
export function validarGeracao(spec: ContentSpec, r: ResultadoGeracao): ValidacaoGeracao {
  // defesa estrutural: um snapshot minimizado ou um resultado incompleto devolvem FAIL explicito, nunca excecao
  const estrutura = problemasEstruturaisDoSpec(spec);
  if (!r || typeof r !== 'object' || typeof r.versaoPrincipal !== 'string' || !Array.isArray(r.claimsUsados)) estrutura.push('resultado da geração incompleto');
  if (estrutura.length) return { ok: false, problemas: [`content spec incompleto para validação: ${estrutura.join('; ')}`] };
  const problemas: string[] = [];
  const texto = [r.versaoPrincipal, r.assunto ?? ''].join('\n');
  const t = norm(texto);
  const basePermitida = norm([...spec.allowedClaims.map((c) => c.texto), spec.cta, spec.remetente.nome, spec.remetente.empresa, spec.remetente.cidade, spec.audiencia.nome, spec.audiencia.empresa, spec.audiencia.local ?? '', spec.referenciaSinal ?? '', spec.referenciaPublica ?? '', ...spec.allowedClaims.map((c) => (c.eventoEm ? c.eventoEm.slice(0, 10).split('-').reverse().join('/') : ''))].join(' | '));
  for (const id of r.claimsUsados) if (!spec.allowedClaims.some((c) => c.id === id)) problemas.push(`claim fora de allowedClaims: ${id}`);
  for (const f of spec.deniedClaims) if (f.texto.length > 12 && t.includes(norm(f.texto))) problemas.push(`usa claim não permitido: ${f.chave}`);
  for (const n of faltantes(basePermitida, extrair(NUM, texto).filter((x) => x.length > 1))) problemas.push(`número sem fato permitido: ${n}`);
  for (const d of faltantes(basePermitida, extrair(DATA, texto))) problemas.push(`data sem fato permitido: ${d}`);
  for (const e of faltantes(basePermitida, entidadesNomeadas(texto))) problemas.push(`entidade sem fato permitido: ${e}`);
  for (const el of spec.elementosObrigatorios) { const det = DETECTORES_OBRIGATORIOS.find(([re]) => re.test(el)); if (det && !det[1](spec, t)) problemas.push(`elemento obrigatório ausente: ${el}`); }
  for (const el of spec.elementosProibidos) { const det = PROIBIDOS.find(([re]) => re.test(el)); if (det && det[1].test(t)) problemas.push(`elemento proibido presente: ${el}`); }
  const nucleo = norm(spec.cta).split(/[?.]/)[0].split(' ').slice(-4).join(' ');
  if (!t.includes(nucleo) && spec.objetivo !== 'REQUEST_PROJECT' && spec.objetivo !== 'OFFER_PRELIMINARY_STUDY') problemas.push('CTA não corresponde ao objetivo');
  for (const [re, msg] of PRESUNCOES) if (re.test(t) && !spec.technicalClaims.some((c) => re.test(norm(c.texto)))) problemas.push(msg);
  if (presumeResponsabilidade(spec, t) && !problemas.includes('presume responsabilidade do contato')) problemas.push('presume responsabilidade do contato');
  problemas.push(...localEventoNaoSuportado(spec, texto)); // ligacao local x evento (Relational Fact Binding)
  for (const [chave, c] of Object.entries(CLAIMS_TECNICOS)) if (!c.aprovado && t.includes(norm(c.texto))) problemas.push(`claim técnico não aprovado: ${chave}`);
  if (spec.sourceDisclosure === 'INTERNAL_ONLY' && /me indicou|me contou|recebi (a )?informa|me passou|me falou/.test(t)) problemas.push('revela fonte confidencial sem autorização');
  if (palavras(r.versaoPrincipal) > spec.maxPalavras * 1.2) problemas.push(`acima do limite de ${spec.maxPalavras} palavras (${palavras(r.versaoPrincipal)})`);
  if (spec.canal === 'EMAIL' && !r.assunto) problemas.push('e-mail sem assunto');
  return { ok: !problemas.length, problemas };
}
export const validadorDeterministico: ValidadorComunicacao = { nome: 'deterministico', validar: validarGeracao };

export async function generateCommunication(spec: ContentSpec, provedor: ProvedorComunicacao = provedorDeterministico): Promise<ResultadoGeracao> { return provedor.gerar(spec); }
/** Versao sincrona para o store (provedor deterministico). */
export const gerarComunicacaoSincrona = (spec: ContentSpec): ResultadoGeracao => provedorDeterministico.gerar(spec) as ResultadoGeracao;

export interface Comunicacao {
  id: string; empresaId: string; contatoId: string; canal: Canal; objetivo: string; playbook: string;
  estado: EstadoComunicacao; spec: ContentSpec; resultado: ResultadoGeracao; textoEditado?: string; assuntoEditado?: string;
  criadoEm: string; atualizadoEm: string; criadoPor: string; historico: { de: EstadoComunicacao; para: EstadoComunicacao; em: string; por: string; motivo?: string }[];
}
