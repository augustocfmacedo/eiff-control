// Leitura de CSV/TSV colado ou enviado: detecta separador, aspas e cabecalho; mapeia colunas por sinonimos (PT/EN) para
// os campos normalizados de empresa e contato. Nao decide nada: devolve linhas normalizadas + erros por campo.
import { normalizarCidade, normalizarCnpj, normalizarDominio, normalizarUf, semAcento, normalizarPais } from './normalizar';

export function lerCsv(texto: string): { cabecalho: string[]; linhas: string[][]; separador: string } {
  const t = texto.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const primeira = t.split('\n').find((l) => l.trim()) ?? '';
  const separador = [';', '\t', ',', '|'].map((s) => ({ s, n: primeira.split(s).length })).sort((a, b) => b.n - a.n)[0].s;
  const linhas: string[][] = [];
  let campo = ''; let linha: string[] = []; let aspas = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (aspas) { if (ch === '"') { if (t[i + 1] === '"') { campo += '"'; i++; } else aspas = false; } else campo += ch; continue; }
    if (ch === '"') { aspas = true; continue; }
    if (ch === separador) { linha.push(campo); campo = ''; continue; }
    if (ch === '\n') { linha.push(campo); if (linha.some((c) => c.trim())) linhas.push(linha.map((c) => c.trim())); linha = []; campo = ''; continue; }
    campo += ch;
  }
  if (campo || linha.length) { linha.push(campo); if (linha.some((c) => c.trim())) linhas.push(linha.map((c) => c.trim())); }
  const cabecalho = (linhas.shift() ?? []).map((c) => c.trim());
  return { cabecalho, linhas, separador };
}

const chave = (s: string) => semAcento(s.toLowerCase()).replace(/[^a-z0-9]+/g, '');

export const CAMPOS_EMPRESA: Record<string, string[]> = {
  cnpj: ['cnpj', 'cnpjcpf', 'documento', 'taxid'],
  razaoSocial: ['razaosocial', 'razao', 'empresa', 'nome', 'nomeempresa', 'company', 'companyname', 'legalname', 'name', 'businessname'],
  nomeFantasia: ['nomefantasia', 'fantasia', 'tradename', 'marca'],
  dominio: ['dominio', 'domain', 'companydomain', 'businessdomain'],
  site: ['site', 'website', 'url', 'web', 'homepage', 'companywebsite', 'businesswebsite'],
  linkedin: ['linkedin', 'linkedinurl', 'linkedinempresa', 'companylinkedin'],
  setor: ['setor', 'segmento', 'industria', 'industry', 'ramo', 'atividade', 'businessnaicsdescription', 'naicsdescription'],
  cnae: ['cnae', 'cnaeprincipal', 'cnaefiscal'],
  cidade: ['cidade', 'municipio', 'city', 'businesscityname', 'cityname'],
  uf: ['uf', 'estado', 'state', 'businessregion', 'region'],
  pais: ['pais', 'country', 'businesscountryname', 'countryname'],
  faixaFuncionarios: ['funcionarios', 'faixafuncionarios', 'employees', 'employeerange', 'porte', 'colaboradores', 'numerofuncionarios', 'businessnumberofemployeesrange', 'numberofemployeesrange'],
  faixaReceita: ['faturamento', 'receita', 'revenue', 'revenuerange', 'faixafaturamento', 'businessyearlyrevenuerange', 'yearlyrevenuerange'],
  capitalSocial: ['capitalsocial', 'capital'],
  numeroUnidades: ['unidades', 'filiais', 'numerodeunidades', 'locations', 'numberoflocations'],
  fonteExternaId: ['id', 'idexterno', 'externalid', 'sourceid', 'codigo'],
  businessId: ['businessid', 'exploriumbusinessid', 'idexplorium', 'vibebusinessid'],
  telefone: ['telefone', 'phone', 'telefoneempresa'],
  email: ['email', 'emailempresa'],
  observacoes: ['observacoes', 'obs', 'notes', 'notas'],
};

export const CAMPOS_CONTATO: Record<string, string[]> = {
  nome: ['nome', 'contato', 'nomecontato', 'fullname', 'name', 'nomecompleto', 'prospectfullname'],
  cargo: ['cargo', 'jobtitle', 'title', 'funcao', 'position', 'prospectjobtitle'],
  departamento: ['departamento', 'department', 'area', 'jobdepartmentmain', 'jobdepartment', 'prospectjobdepartment'],
  senioridade: ['senioridade', 'seniority', 'nivel', 'joblevelmain', 'joblevel', 'prospectjobsenioritylevel', 'jobsenioritylevel'],
  email: ['email', 'emailcontato', 'e-mail', 'professionalemail', 'workemail', 'contactprofessionalemail'],
  telefone: ['telefone', 'phone', 'fone', 'telefonefixo'],
  celular: ['celular', 'mobile', 'mobilephone', 'cel', 'contactmobilephone'],
  whatsapp: ['whatsapp', 'zap', 'wpp'],
  linkedin: ['linkedin', 'linkedinurl', 'perfil', 'linkedinurlarray', 'prospectlinkedin'],
  decisor: ['decisor', 'decisionmaker', 'isdecisionmaker', 'decide'],
  poderDecisao: ['poderdecisao', 'decisionpower', 'poder'],
  persona: ['persona'],
  statusEmail: ['statusemail', 'emailstatus', 'statusdoemail', 'emailverificado', 'emailvalido', 'professionalemailstatus', 'contactprofessionalemailstatus'],
  statusTelefone: ['statustelefone', 'phonestatus', 'statusdotelefone'],
  verificadoEm: ['verificadoem', 'lastverifiedat', 'ultimaverificacao', 'dataverificacao'],
  empresaExternoId: ['empresaid', 'idempresa', 'companyid', 'businessid', 'businessexternalid', 'companyexternalid', 'idexternoempresa', 'ideiff'],
  empresaCnpj: ['cnpj', 'cnpjempresa', 'companycnpj'],
  empresaNome: ['empresa', 'razaosocial', 'company', 'companyname', 'nomeempresa', 'businessname'],
  empresaDominio: ['dominio', 'domain', 'site', 'website', 'companydomain', 'companywebsite', 'businessdomain', 'businesswebsite'],
  fonte: ['fonte', 'source', 'origem'],
  fonteExternaId: ['id', 'idexterno', 'externalid', 'contactid', 'prospectid'],
  observacoes: ['observacoes', 'obs', 'notes'],
};

const statusEmailDe = (v?: string): 'valido' | 'invalido' | 'devolvido' | 'desconhecido' | 'catch_all' | undefined => { const s = (v ?? '').trim().toLowerCase(); if (!s) return undefined; if (/^(valid|válido|valido|verified|verificado|ok|deliverable|sim|yes|true)/.test(s)) return 'valido'; if (/bounce|devolv/.test(s)) return 'devolvido'; if (/^(invalid|inválido|invalido|undeliverable|nao|não|no|false)/.test(s)) return 'invalido'; if (/catch/.test(s)) return 'catch_all'; return 'desconhecido'; };
const statusTelefoneDe = (v?: string): 'valido' | 'invalido' | 'desconhecido' | undefined => { const s = (v ?? '').trim().toLowerCase(); if (!s) return undefined; if (/^(valid|válido|valido|ok|verificado|sim|yes|true)/.test(s)) return 'valido'; if (/^(invalid|inválido|invalido|nao|não|no|false)/.test(s)) return 'invalido'; return 'desconhecido'; };
const dataIso = (v?: string) => { const s = (v ?? '').trim(); if (!s) return undefined; const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s); if (m) return `${m[3]}-${m[2]}-${m[1]}`; return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : undefined; };

/** Mapeia cada coluna do cabecalho para um campo conhecido (ou undefined). Cabecalho exato vence sinonimo parcial. */
export function mapearColunas(cabecalho: string[], campos: Record<string, string[]>): (string | undefined)[] {
  // duas passadas globais: todos os cabecalhos exatos primeiro (em qualquer posicao), depois prefixo/sufixo para o que sobrou
  const usados = new Set<string>();
  const chaves = cabecalho.map(chave);
  const saida: (string | undefined)[] = chaves.map(() => undefined);
  chaves.forEach((k, i) => { if (!k) return; for (const [campo, sins] of Object.entries(campos)) if (!usados.has(campo) && sins.includes(k)) { usados.add(campo); saida[i] = campo; return; } });
  chaves.forEach((k, i) => { if (!k || saida[i]) return; for (const [campo, sins] of Object.entries(campos)) if (!usados.has(campo) && sins.some((s) => s.length > 3 && (k.startsWith(s) || k.endsWith(s)))) { usados.add(campo); saida[i] = campo; return; } });
  return saida;
}

export interface EmpresaCsv { numero: number; dados: Record<string, string>; businessId?: string; cnpj?: string; razaoSocial: string; nomeFantasia?: string; dominio?: string; site?: string; linkedin?: string; setor?: string; cnae?: string; cidade?: string; uf?: string; pais: string; faixaFuncionarios?: string; faixaReceita?: string; capitalSocial?: number; numeroUnidades?: number; fonteExternaId?: string; telefone?: string; email?: string; observacoes?: string; erros: { campo?: string; mensagem: string }[] }
export interface ContatoCsv { numero: number; dados: Record<string, string>; nome: string; cargo?: string; departamento?: string; senioridade?: string; email?: string; telefone?: string; celular?: string; whatsapp?: string; linkedin?: string; decisor: boolean; poderDecisao?: 'Baixo' | 'Médio' | 'Alto'; persona?: string; statusEmail?: 'valido' | 'invalido' | 'devolvido' | 'desconhecido' | 'catch_all'; statusTelefone?: 'valido' | 'invalido' | 'desconhecido'; verificadoEm?: string; empresaExternoId?: string; empresaCnpj?: string; empresaNome?: string; empresaDominio?: string; fonte?: string; fonteExternaId?: string; observacoes?: string; erros: { campo?: string; mensagem: string }[] }

const numero = (v?: string) => { if (!v) return undefined; const n = Number(v.replace(/[R$\s.]/g, '').replace(',', '.')); return Number.isFinite(n) ? n : undefined; };
const faixaFunc = (v?: string) => { if (!v) return undefined; const n = numero(v); if (n === undefined) return v; return n <= 10 ? '1-10' : n <= 50 ? '11-50' : n <= 200 ? '51-200' : n <= 500 ? '201-500' : n <= 1000 ? '501-1000' : n <= 5000 ? '1001-5000' : '5000+'; };
const sim = (v?: string) => /^(s|sim|y|yes|true|1|x)$/i.test((v ?? '').trim());
/** business_id da Explorium: 32 caracteres hexadecimais; qualquer outra coisa e ignorada. */
export const businessIdDe = (v?: string) => { const s = (v ?? '').trim().toLowerCase(); return /^[a-f0-9]{32}$/.test(s) ? s : undefined; };
/** Senioridade na escala do Radar; aceita os niveis da Explorium (cxo, vp, director, manager, senior, entry, owner...). */
export const senioridadeDe = (v?: string): string | undefined => { const s = (v ?? '').trim(); if (!s) return undefined; const k = s.toLowerCase(); if (/^(analista|coordenador|gerente|diretor|c-level|s[oó]cio)$/i.test(s)) return s; if (/owner|partner|founder|s[oó]cio|propriet/.test(k)) return 'Sócio'; if (/cxo|c-level|chief|presiden/.test(k)) return 'C-level'; if (/\bvp\b|vice|director|diretor/.test(k)) return 'Diretor'; if (/manager|head|gerente/.test(k)) return 'Gerente'; if (/senior|lead|coorden|supervis/.test(k)) return 'Coordenador'; if (/entry|junior|staff|non-managerial|analista|assistente/.test(k)) return 'Analista'; return s; };
const emailValido = (v?: string) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

export function normalizarEmpresasCsv(texto: string): { colunas: (string | undefined)[]; cabecalho: string[]; empresas: EmpresaCsv[] } {
  const { cabecalho, linhas } = lerCsv(texto);
  const colunas = mapearColunas(cabecalho, CAMPOS_EMPRESA);
  const empresas = linhas.map((l, i) => {
    const d: Record<string, string> = {};
    cabecalho.forEach((c, j) => { d[c] = l[j] ?? ''; });
    const g = (campo: string) => { const j = colunas.indexOf(campo); return j >= 0 ? (l[j] ?? '').trim() || undefined : undefined; };
    const erros: EmpresaCsv['erros'] = [];
    const cnpjBruto = g('cnpj'); const cnpj = normalizarCnpj(cnpjBruto);
    if (cnpjBruto && !cnpj) erros.push({ campo: 'cnpj', mensagem: `CNPJ inválido: ${cnpjBruto}` });
    const razaoSocial = g('razaoSocial') ?? g('nomeFantasia') ?? '';
    if (!razaoSocial) erros.push({ campo: 'razaoSocial', mensagem: 'Razão social ausente' });
    const dominio = normalizarDominio(g('dominio') ?? g('site') ?? g('email'));
    const uf = normalizarUf(g('uf')); if (g('uf') && !uf) erros.push({ campo: 'uf', mensagem: `UF inválida: ${g('uf')}` });
    return { numero: i + 2, dados: d, cnpj, razaoSocial, nomeFantasia: g('nomeFantasia'), dominio, site: g('site'), linkedin: g('linkedin'), setor: g('setor'), cnae: g('cnae'), cidade: normalizarCidade(g('cidade')), uf, pais: normalizarPais(g('pais')) ?? 'Brasil', faixaFuncionarios: faixaFunc(g('faixaFuncionarios')), faixaReceita: g('faixaReceita'), capitalSocial: numero(g('capitalSocial')), numeroUnidades: numero(g('numeroUnidades')), fonteExternaId: g('fonteExternaId'), businessId: businessIdDe(g('businessId')), telefone: g('telefone'), email: g('email'), observacoes: g('observacoes'), erros };
  });
  return { colunas, cabecalho, empresas };
}

export function normalizarContatosCsv(texto: string): { colunas: (string | undefined)[]; cabecalho: string[]; contatos: ContatoCsv[] } {
  const { cabecalho, linhas } = lerCsv(texto);
  const colunas = mapearColunas(cabecalho, CAMPOS_CONTATO);
  const contatos = linhas.map((l, i) => {
    const d: Record<string, string> = {};
    cabecalho.forEach((c, j) => { d[c] = l[j] ?? ''; });
    const g = (campo: string) => { const j = colunas.indexOf(campo); return j >= 0 ? (l[j] ?? '').trim() || undefined : undefined; };
    const erros: ContatoCsv['erros'] = [];
    const nome = g('nome') ?? '';
    if (!nome) erros.push({ campo: 'nome', mensagem: 'Nome ausente' });
    const email = g('email'); if (!emailValido(email)) erros.push({ campo: 'email', mensagem: `E-mail inválido: ${email}` });
    const cnpj = normalizarCnpj(g('empresaCnpj'));
    const empresaNome = g('empresaNome'); const empresaDominio = normalizarDominio(g('empresaDominio') ?? email); const empresaExternoId = g('empresaExternoId');
    if (!cnpj && !empresaNome && !empresaDominio && !empresaExternoId) erros.push({ campo: 'empresa', mensagem: 'Sem empresa (id, CNPJ, nome ou domínio)' });
    const pd = (g('poderDecisao') ?? '').toLowerCase();
    const poderDecisao: ContatoCsv['poderDecisao'] = pd.startsWith('a') || pd.startsWith('h') ? 'Alto' : pd.startsWith('m') ? 'Médio' : pd.startsWith('b') || pd.startsWith('l') ? 'Baixo' : undefined;
    return { numero: i + 2, dados: d, nome, cargo: g('cargo'), departamento: g('departamento'), senioridade: senioridadeDe(g('senioridade')), email, telefone: g('telefone'), celular: g('celular'), whatsapp: g('whatsapp'), linkedin: g('linkedin'), decisor: sim(g('decisor')), poderDecisao, persona: g('persona')?.toUpperCase().replace(/\s+/g, '_'), statusEmail: statusEmailDe(g('statusEmail')), statusTelefone: statusTelefoneDe(g('statusTelefone')), verificadoEm: dataIso(g('verificadoEm')), empresaExternoId, empresaCnpj: cnpj, empresaNome, empresaDominio, fonte: g('fonte'), fonteExternaId: g('fonteExternaId'), observacoes: g('observacoes'), erros };
  });
  return { colunas, cabecalho, contatos };
}
