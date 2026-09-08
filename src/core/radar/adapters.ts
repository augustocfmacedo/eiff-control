// Adapters de fontes externas: cada fonte transforma o payload bruto em registros normalizados ANTES de persistir.
// O core so conhece o formato normalizado; a integracao profunda (chamadas de API) vem depois, adapter por adapter.
// O payload bruto nunca e descartado: vai para registrosFonte (source_records) e para signal.payload.
import type { TipoFonte, TipoSinal } from './types';

export interface EmpresaNormalizada { cnpj?: string; razaoSocial: string; nomeFantasia?: string; dominio?: string; site?: string; setor?: string; cnae?: string; cidade?: string; uf?: string; pais?: string; faixaFuncionarios?: string; faixaReceita?: string; capitalSocial?: number; externoId?: string }
export interface ContatoNormalizado { nome: string; cargo?: string; email?: string; telefone?: string; celular?: string; linkedin?: string; decisor?: boolean; externoId?: string }
export interface ProjetoNormalizado { nome: string; tipo?: string; cidade?: string; uf?: string; endereco?: string; areaM2?: number; valorEstimado?: number; estagio?: string; inicioPrevisto?: string; externoId?: string }
export interface SinalNormalizado { tipo: TipoSinal; titulo: string; descricao?: string; eventoEm: string; confianca: number; url?: string; externoId?: string }

/** Resultado de um adapter para um registro bruto: tudo que a fonte permitiu extrair, ja normalizado. */
export interface RegistroNormalizado {
  fonte: TipoFonte;
  externoId?: string;
  empresa?: EmpresaNormalizada;
  contatos?: ContatoNormalizado[];
  projeto?: ProjetoNormalizado;
  sinais?: SinalNormalizado[];
  payload: unknown; // bruto, preservado
}

export interface AdapterFonte {
  fonte: TipoFonte;
  nome: string;
  /** Transforma um registro bruto (JSON da API, linha de arquivo, etc.) no formato normalizado. Deve ser pura. */
  normalizar(bruto: unknown): RegistroNormalizado | undefined;
  /** Busca incremental na fonte; nao implementada nesta fase (retorna vazio). */
  buscar?(desde?: string): Promise<unknown[]>;
}

const texto = (o: Record<string, unknown>, ...ks: string[]) => { for (const k of ks) { const v = o[k]; if (v !== undefined && v !== null && String(v).trim()) return String(v).trim(); } return undefined; };
const num = (o: Record<string, unknown>, ...ks: string[]) => { const t = texto(o, ...ks); const n = t ? Number(t.replace(/[^\d.,-]/g, '').replace(',', '.')) : NaN; return Number.isFinite(n) ? n : undefined; };
const obj = (b: unknown): Record<string, unknown> | undefined => (b && typeof b === 'object' ? (b as Record<string, unknown>) : undefined);

/** CNO (Cadastro Nacional de Obras): uma obra registrada vira empresa (responsavel) + projeto + sinal CNO_NEW/CNO_EXPANSION. */
export const adapterCNO: AdapterFonte = {
  fonte: 'CNO', nome: 'Cadastro Nacional de Obras',
  normalizar(bruto) {
    const o = obj(bruto); if (!o) return undefined;
    const razao = texto(o, 'nomeResponsavel', 'responsavel', 'razaoSocial', 'nome'); if (!razao) return undefined;
    const inicio = texto(o, 'dataInicio', 'inicio', 'dataRegistro');
    const expansao = /reforma|amplia|expans/i.test(texto(o, 'tipoObra', 'categoria', 'descricao') ?? '');
    return {
      fonte: 'CNO', externoId: texto(o, 'cno', 'numero', 'id'),
      empresa: { cnpj: texto(o, 'cnpjResponsavel', 'cnpj'), razaoSocial: razao, cidade: texto(o, 'municipio', 'cidade'), uf: texto(o, 'uf'), externoId: texto(o, 'cnpjResponsavel', 'cnpj') },
      projeto: { nome: texto(o, 'nomeObra', 'descricao') ?? `Obra CNO ${texto(o, 'cno', 'numero') ?? ''}`.trim(), tipo: texto(o, 'tipoObra', 'categoria'), cidade: texto(o, 'municipio', 'cidade'), uf: texto(o, 'uf'), endereco: texto(o, 'endereco', 'logradouro'), areaM2: num(o, 'areaTotal', 'area', 'metragem'), estagio: 'Obra', inicioPrevisto: inicio, externoId: texto(o, 'cno', 'numero', 'id') },
      sinais: [{ tipo: expansao ? 'CNO_EXPANSION' : 'CNO_NEW', titulo: `${expansao ? 'Expansão' : 'Obra nova'} registrada no CNO${texto(o, 'municipio', 'cidade') ? ` em ${texto(o, 'municipio', 'cidade')}` : ''}`, descricao: texto(o, 'descricao', 'tipoObra'), eventoEm: inicio ?? new Date().toISOString().slice(0, 10), confianca: 0.9, externoId: texto(o, 'cno', 'numero', 'id') }],
      payload: bruto,
    };
  },
};

/** PNCP (contratacoes publicas): licitacao ou plano de contratacao vira empresa (orgao) + sinal PUBLIC_TENDER/PUBLIC_PLAN. */
export const adapterPNCP: AdapterFonte = {
  fonte: 'PNCP', nome: 'Portal Nacional de Contratações Públicas',
  normalizar(bruto) {
    const o = obj(bruto); if (!o) return undefined;
    const orgao = obj(o.orgaoEntidade) ?? o;
    const razao = texto(orgao, 'razaoSocial', 'nome', 'orgao'); if (!razao) return undefined;
    const plano = /plano/i.test(texto(o, 'tipo', 'modalidadeNome', 'objeto') ?? '') || !!o.anoPca;
    const data = texto(o, 'dataPublicacaoPncp', 'dataPublicacao', 'dataAtualizacao') ?? new Date().toISOString().slice(0, 10);
    return {
      fonte: 'PNCP', externoId: texto(o, 'numeroControlePNCP', 'id'),
      empresa: { cnpj: texto(orgao, 'cnpj'), razaoSocial: razao, cidade: texto(obj(o.unidadeOrgao) ?? o, 'municipioNome', 'municipio'), uf: texto(obj(o.unidadeOrgao) ?? o, 'ufSigla', 'uf'), setor: 'Setor público', externoId: texto(orgao, 'cnpj') },
      projeto: { nome: (texto(o, 'objetoCompra', 'objeto', 'descricao') ?? 'Contratação pública').slice(0, 140), tipo: 'Licitação', valorEstimado: num(o, 'valorTotalEstimado', 'valorEstimado'), estagio: plano ? 'Estudo' : 'Licitação', externoId: texto(o, 'numeroControlePNCP', 'id') },
      sinais: [{ tipo: plano ? 'PUBLIC_PLAN' : 'PUBLIC_TENDER', titulo: (texto(o, 'objetoCompra', 'objeto') ?? (plano ? 'Plano de contratação' : 'Licitação')).slice(0, 120), eventoEm: data.slice(0, 10), confianca: 0.9, url: texto(o, 'linkSistemaOrigem', 'url'), externoId: texto(o, 'numeroControlePNCP', 'id') }],
      payload: bruto,
    };
  },
};

/** CNPJ (Receita Federal, ex.: BrasilAPI/ReceitaWS): enriquece o cadastro da empresa; sem sinal. */
export const adapterCNPJ: AdapterFonte = {
  fonte: 'CNPJ_RFB', nome: 'Cadastro CNPJ',
  normalizar(bruto) {
    const o = obj(bruto); if (!o) return undefined;
    const razao = texto(o, 'razao_social', 'razaoSocial', 'nome'); if (!razao) return undefined;
    const cnae = obj(o.cnae_fiscal_descricao) ? undefined : texto(o, 'cnae_fiscal', 'cnaeFiscal', 'cnae');
    return { fonte: 'CNPJ_RFB', externoId: texto(o, 'cnpj'), empresa: { cnpj: texto(o, 'cnpj'), razaoSocial: razao, nomeFantasia: texto(o, 'nome_fantasia', 'nomeFantasia', 'fantasia'), cidade: texto(o, 'municipio', 'cidade'), uf: texto(o, 'uf'), cnae, capitalSocial: num(o, 'capital_social', 'capitalSocial'), faixaFuncionarios: texto(o, 'porte'), externoId: texto(o, 'cnpj') }, payload: bruto };
  },
};

/** Enriquecimento B2B (Vibe, Apollo, etc.): empresa + contatos. Campos comuns; o que nao existir fica em branco. */
export const adapterB2B: AdapterFonte = {
  fonte: 'VIBE', nome: 'Enriquecimento B2B',
  normalizar(bruto) {
    const o = obj(bruto); if (!o) return undefined;
    const razao = texto(o, 'company', 'companyName', 'empresa', 'razaoSocial', 'name'); if (!razao) return undefined;
    const contatos = (Array.isArray(o.contacts) ? o.contacts : Array.isArray(o.contatos) ? o.contatos : []).map((c) => obj(c)).filter((c): c is Record<string, unknown> => !!c).map((c) => ({ nome: texto(c, 'name', 'nome', 'fullName') ?? '', cargo: texto(c, 'title', 'cargo', 'jobTitle'), email: texto(c, 'email'), telefone: texto(c, 'phone', 'telefone'), celular: texto(c, 'mobile', 'celular'), linkedin: texto(c, 'linkedin', 'linkedinUrl'), decisor: /diretor|director|ceo|cfo|coo|presidente|owner|sócio|socio|head|gerente de engenharia|vp/i.test(texto(c, 'title', 'cargo', 'jobTitle') ?? ''), externoId: texto(c, 'id') })).filter((c) => c.nome);
    return { fonte: 'VIBE', externoId: texto(o, 'id', 'companyId'), empresa: { cnpj: texto(o, 'cnpj'), razaoSocial: razao, nomeFantasia: texto(o, 'tradeName', 'nomeFantasia'), dominio: texto(o, 'domain', 'website', 'site'), site: texto(o, 'website', 'site'), setor: texto(o, 'industry', 'setor', 'segment'), cidade: texto(o, 'city', 'cidade'), uf: texto(o, 'state', 'uf'), faixaFuncionarios: texto(o, 'employeeRange', 'employees', 'funcionarios'), faixaReceita: texto(o, 'revenueRange', 'revenue'), externoId: texto(o, 'id', 'companyId') }, contatos, payload: bruto };
  },
};

/** Noticias: manchete + empresa citada vira sinal (tipo inferido pelo texto). */
export const adapterNoticias: AdapterFonte = {
  fonte: 'NEWS', nome: 'Notícias',
  normalizar(bruto) {
    const o = obj(bruto); if (!o) return undefined;
    const titulo = texto(o, 'title', 'titulo', 'headline'); const empresa = texto(o, 'company', 'empresa', 'organization'); if (!titulo || !empresa) return undefined;
    const t = `${titulo} ${texto(o, 'summary', 'resumo', 'description') ?? ''}`;
    const tipo: TipoSinal = /f[aá]brica|planta industrial/i.test(t) ? 'NEW_FACTORY' : /centro de distribui|\bCD\b/i.test(t) ? 'NEW_DC' : /galp[aã]o|armaz[eé]m|warehouse/i.test(t) ? 'WAREHOUSE' : /terreno|lote industrial/i.test(t) ? 'LAND_PURCHASE' : /expans|amplia/i.test(t) ? 'EXPANSION' : /invest|aporte/i.test(t) ? 'INVESTMENT' : /capta|rodada|funding/i.test(t) ? 'FUNDING' : 'NEWS';
    return { fonte: 'NEWS', externoId: texto(o, 'url', 'id'), empresa: { razaoSocial: empresa, dominio: texto(o, 'domain'), externoId: texto(o, 'companyId') }, sinais: [{ tipo, titulo: titulo.slice(0, 140), descricao: texto(o, 'summary', 'resumo', 'description'), eventoEm: (texto(o, 'publishedAt', 'date', 'data') ?? new Date().toISOString()).slice(0, 10), confianca: 0.6, url: texto(o, 'url', 'link'), externoId: texto(o, 'url', 'id') }], payload: bruto };
  },
};

export const ADAPTERS: AdapterFonte[] = [adapterCNO, adapterPNCP, adapterCNPJ, adapterB2B, adapterNoticias];
export const adapterDe = (fonte: TipoFonte) => ADAPTERS.find((a) => a.fonte === fonte);
