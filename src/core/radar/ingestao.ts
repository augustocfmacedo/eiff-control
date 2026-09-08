// Ingestao normalizada: upsert de empresa/contato/projeto/sinal com deduplicacao e linhagem. Funcoes puras sobre o
// RadarDataset (recebem geradores de id do store) para serem testaveis e reutilizadas por CSV e adapters.
import type { ContatoNormalizado, EmpresaNormalizada, ProjetoNormalizado, RegistroNormalizado, SinalNormalizado } from './adapters';
import { encontrarEmpresa, normalizarCidade, normalizarCnpj, normalizarDominio, normalizarNome, normalizarUf, similaridade } from './normalizar';
import { enriquecerContato } from './contatos';
import { pesoBaseSinal } from './score';
import type { Contato, Empresa, PossivelDuplicata, Projeto, RadarDataset, Sinal, TipoFonte } from './types';

export interface Ids { novo: (prefixo: string) => string; hoje: string; agora: string; usuarioId: string }
export type ResultadoUpsert = 'importada' | 'atualizada' | 'duplicata_possivel' | 'ignorada';

const limpo = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '')) as T;

export const empresaVazia = (id: string, agora: string): Empresa => ({ id, razaoSocial: '', pais: 'Brasil', observacoes: '', ativo: true, criadoEm: agora, atualizadoEm: agora, fitScore: 0, intentScore: 0, timingScore: 0, relationshipScore: 0, dataQualityScore: 0, priorityScore: 0, priorityClass: 'D' });

/**
 * Cria ou atualiza a empresa. Match 'certo'/'provavel' atualiza a existente preenchendo so campos vazios (a fonte nao
 * sobrescreve dado ja curado); 'possivel' cria a nova e registra possible_duplicate para revisao humana.
 */
export function upsertEmpresa(r: RadarDataset, dados: EmpresaNormalizada & { linkedin?: string; numeroUnidades?: number; observacoes?: string }, fonteId: string | undefined, ids: Ids, opts: { sobrescrever?: boolean } = {}): { radar: RadarDataset; empresa: Empresa; resultado: ResultadoUpsert; match?: ReturnType<typeof encontrarEmpresa> } {
  const norm = limpo({ businessId: dados.businessId && /^[a-f0-9]{32}$/i.test(dados.businessId) ? dados.businessId.toLowerCase() : undefined, cnpj: normalizarCnpj(dados.cnpj), razaoSocial: (dados.razaoSocial ?? '').trim(), nomeFantasia: dados.nomeFantasia?.trim(), dominio: normalizarDominio(dados.dominio ?? dados.site), site: dados.site?.trim(), linkedin: dados.linkedin?.trim(), setor: dados.setor?.trim(), cnae: dados.cnae?.trim(), cidade: normalizarCidade(dados.cidade), uf: normalizarUf(dados.uf), pais: dados.pais?.trim() || 'Brasil', faixaFuncionarios: dados.faixaFuncionarios, faixaReceita: dados.faixaReceita, capitalSocial: dados.capitalSocial, numeroUnidades: dados.numeroUnidades, fonteExternaId: dados.externoId, observacoes: dados.observacoes });
  if (!norm.razaoSocial) throw new Error('Razão social é obrigatória.');
  const match = encontrarEmpresa(norm, r.empresas);
  if (match && match.nivel !== 'possivel') {
    const atual = match.empresa;
    const merged: Empresa = { ...atual };
    for (const [k, v] of Object.entries(norm)) {
      const chave = k as keyof Empresa;
      const existente = atual[chave] as unknown;
      if (opts.sobrescrever || existente === undefined || existente === null || existente === '' || existente === 0) (merged as unknown as Record<string, unknown>)[chave] = v;
    }
    merged.atualizadoEm = ids.agora;
    if (!merged.fonteId && fonteId) merged.fonteId = fonteId;
    const mudou = JSON.stringify(merged) !== JSON.stringify({ ...atual, atualizadoEm: ids.agora });
    return { radar: { ...r, empresas: r.empresas.map((e) => (e.id === atual.id ? merged : e)) }, empresa: merged, resultado: mudou ? 'atualizada' : 'ignorada', match };
  }
  const empresa: Empresa = { ...empresaVazia(ids.novo('EMP'), ids.agora), ...norm, observacoes: norm.observacoes ?? '', fonteId };
  let radar: RadarDataset = { ...r, empresas: [...r.empresas, empresa] };
  if (match) {
    const dup: PossivelDuplicata = { id: ids.novo('DUP'), empresaId: empresa.id, candidataId: match.empresa.id, confianca: match.confianca, motivo: match.motivo, status: 'pendente', criadoEm: ids.agora };
    radar = { ...radar, duplicatas: [...radar.duplicatas, dup] };
    return { radar, empresa, resultado: 'duplicata_possivel', match };
  }
  return { radar, empresa, resultado: 'importada', match };
}

/** Contato: casa por e-mail, senao por nome normalizado na mesma empresa. */
export function upsertContato(r: RadarDataset, empresaId: string, c: ContatoNormalizado & { departamento?: string; senioridade?: string; whatsapp?: string; poderDecisao?: Contato['poderDecisao']; statusEmail?: Contato['statusEmail']; statusTelefone?: Contato['statusTelefone']; persona?: Contato['persona']; verificadoEm?: string; observacoes?: string }, fonteId: string | undefined, ids: Ids): { radar: RadarDataset; contato: Contato; resultado: ResultadoUpsert } {
  const nome = (c.nome ?? '').trim();
  if (!nome) throw new Error('Nome do contato é obrigatório.');
  const email = c.email?.trim().toLowerCase() || undefined;
  const chaveNome = nome.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  const atual = r.contatos.find((x) => x.empresaId === empresaId && ((c.externoId && x.fonteExternaId && x.fonteExternaId === c.externoId) || (email && x.email?.toLowerCase() === email) || x.nome.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '') === chaveNome));
  const dados = limpo({ cargo: c.cargo, departamento: c.departamento, senioridade: c.senioridade, email, telefone: c.telefone, celular: c.celular, whatsapp: c.whatsapp, linkedin: c.linkedin, poderDecisao: c.poderDecisao, statusEmail: c.statusEmail, statusTelefone: c.statusTelefone, persona: c.persona, verificadoEm: c.verificadoEm, fonteExternaId: c.externoId, observacoes: c.observacoes });
  const empresa = r.empresas.find((e) => e.id === empresaId);
  if (atual) {
    const merged: Contato = { ...atual };
    for (const [k, v] of Object.entries(dados)) { const chave = k as keyof Contato; if (!atual[chave]) (merged as unknown as Record<string, unknown>)[chave] = v; }
    merged.decisor = atual.decisor || !!c.decisor;
    merged.atualizadoEm = ids.agora;
    const enr = enriquecerContato(merged, empresa, r, ids.hoje);
    return { radar: { ...r, contatos: r.contatos.map((x) => (x.id === atual.id ? enr : x)) }, contato: enr, resultado: 'atualizada' };
  }
  const base: Contato = { id: ids.novo('CTT'), empresaId, nome, ...dados, decisor: !!c.decisor, qualidade: 0, situacao: 'ATIVO', fonteId, observacoes: c.observacoes ?? '', ativo: true, criadoEm: ids.agora, atualizadoEm: ids.agora };
  const contato = enriquecerContato(base, empresa, r, ids.hoje);
  return { radar: { ...r, contatos: [...r.contatos, contato] }, contato, resultado: 'importada' };
}

export interface AssociacaoEmpresa { empresa?: Empresa; nivel?: 'certo' | 'provavel' | 'ambiguo' | 'nenhum'; motivo: string; candidatos: { empresaId: string; motivo: string; confianca: number }[] }

/**
 * Associa um contato importado a uma empresa: 1) id externo da empresa (business identifier), 2) dominio,
 * 3) razao social normalizada (+ cidade/UF quando houver). Mais de uma candidata ou so match aproximado = ambiguo
 * (vai para a fila de revisao; nunca cria empresa automaticamente).
 */
export function associarEmpresaContato(dados: { empresaExternoId?: string; empresaDominio?: string; empresaNome?: string; empresaCnpj?: string; cidade?: string; uf?: string }, empresas: Empresa[]): AssociacaoEmpresa {
  const ativas = empresas.filter((e) => e.ativo && !e.mescladaEm);
  const cnpj = normalizarCnpj(dados.empresaCnpj);
  if (cnpj) { const e = ativas.find((x) => x.cnpj === cnpj); if (e) return { empresa: e, nivel: 'certo', motivo: 'CNPJ', candidatos: [] }; }
  const extId = dados.empresaExternoId?.trim();
  if (extId && /^[a-f0-9]{32}$/i.test(extId)) {
    // business_id da Explorium (32 hex): casa com o business_id gravado na empresa (match ou lista importada do Vibe)
    const es = ativas.filter((x) => x.businessId && x.businessId === extId.toLowerCase());
    if (es.length === 1) return { empresa: es[0], nivel: 'certo', motivo: `business_id ${extId.toLowerCase()}`, candidatos: [] };
    if (es.length > 1) return { nivel: 'ambiguo', motivo: `business_id ${extId.toLowerCase()} em ${es.length} empresas`, candidatos: es.map((e) => ({ empresaId: e.id, motivo: 'mesmo business_id', confianca: 0.6 })) };
  }
  if (extId) {
    const es = ativas.filter((x) => x.fonteExternaId && x.fonteExternaId === extId);
    if (es.length === 1) return { empresa: es[0], nivel: 'certo', motivo: `id externo ${dados.empresaExternoId}`, candidatos: [] };
    if (es.length > 1) return { nivel: 'ambiguo', motivo: `id externo ${dados.empresaExternoId} em ${es.length} empresas`, candidatos: es.map((e) => ({ empresaId: e.id, motivo: 'mesmo id externo', confianca: 0.6 })) };
  }
  const dom = normalizarDominio(dados.empresaDominio);
  if (dom) {
    const es = ativas.filter((x) => x.dominio === dom);
    if (es.length === 1) return { empresa: es[0], nivel: 'certo', motivo: `domínio ${dom}`, candidatos: [] };
    if (es.length > 1) return { nivel: 'ambiguo', motivo: `domínio ${dom} em ${es.length} empresas`, candidatos: es.map((e) => ({ empresaId: e.id, motivo: 'mesmo domínio', confianca: 0.6 })) };
  }
  const nome = normalizarNome(dados.empresaNome);
  if (nome) {
    const es = ativas.filter((x) => normalizarNome(x.razaoSocial) === nome || (x.nomeFantasia && normalizarNome(x.nomeFantasia) === nome));
    const uf = normalizarUf(dados.uf);
    const local = uf ? es.filter((x) => x.uf === uf) : es;
    if (local.length === 1) return { empresa: local[0], nivel: 'provavel', motivo: 'razão social igual', candidatos: [] };
    if (es.length === 1) return { empresa: es[0], nivel: 'provavel', motivo: 'razão social igual', candidatos: [] };
    if (es.length > 1) return { nivel: 'ambiguo', motivo: `razão social igual em ${es.length} empresas`, candidatos: es.map((e) => ({ empresaId: e.id, motivo: `${e.cidade ?? ''}/${e.uf ?? ''}`, confianca: 0.5 })) };
    const parecidas = ativas.map((x) => ({ x, s: Math.max(similaridade(nome, x.razaoSocial), x.nomeFantasia ? similaridade(nome, x.nomeFantasia) : 0) })).filter((k) => k.s >= 0.8).sort((a, b) => b.s - a.s).slice(0, 3);
    if (parecidas.length) return { nivel: 'ambiguo', motivo: 'nome parecido, sem correspondência exata', candidatos: parecidas.map((k) => ({ empresaId: k.x.id, motivo: `${Math.round(k.s * 100)}% parecido`, confianca: k.s })) };
  }
  return { nivel: 'nenhum', motivo: 'empresa não encontrada', candidatos: [] };
}

export function upsertProjeto(r: RadarDataset, empresaId: string, p: ProjetoNormalizado, fonteId: string | undefined, ids: Ids): { radar: RadarDataset; projeto: Projeto; resultado: ResultadoUpsert } {
  const atual = r.projetos.find((x) => x.empresaId === empresaId && ((p.externoId && x.fonteExternaId === p.externoId) || x.nome.toLowerCase() === p.nome.toLowerCase()));
  if (atual) {
    const merged: Projeto = { ...atual, ...limpo({ tipo: p.tipo, cidade: p.cidade, uf: p.uf, endereco: p.endereco, areaM2: p.areaM2, valorEstimado: p.valorEstimado, estagio: p.estagio, inicioPrevisto: p.inicioPrevisto }), atualizadoEm: ids.agora };
    return { radar: { ...r, projetos: r.projetos.map((x) => (x.id === atual.id ? merged : x)) }, projeto: merged, resultado: 'atualizada' };
  }
  const projeto: Projeto = { id: ids.novo('PRJ'), empresaId, nome: p.nome, ...limpo({ tipo: p.tipo, cidade: normalizarCidade(p.cidade), uf: normalizarUf(p.uf), endereco: p.endereco, areaM2: p.areaM2, valorEstimado: p.valorEstimado, estagio: p.estagio, inicioPrevisto: p.inicioPrevisto, fonteExternaId: p.externoId }), fonteId, observacoes: '', criadoEm: ids.agora, atualizadoEm: ids.agora };
  return { radar: { ...r, projetos: [...r.projetos, projeto] }, projeto, resultado: 'importada' };
}

/** Sinal: deduplica por fonte + externoId (ou tipo + titulo + data). */
export function registrarSinalNormalizado(r: RadarDataset, empresaId: string, s: SinalNormalizado, fonte: { id: string; tipo: TipoFonte; confiabilidade: number }, ids: Ids, extras: { projetoId?: string; payload?: unknown; verificado?: boolean } = {}): { radar: RadarDataset; sinal: Sinal; resultado: ResultadoUpsert } {
  const existente = r.sinais.find((x) => x.empresaId === empresaId && x.fonteId === fonte.id && ((s.externoId && x.externoId === s.externoId) || (x.tipo === s.tipo && x.titulo === s.titulo && x.eventoEm.slice(0, 10) === s.eventoEm.slice(0, 10))));
  if (existente) return { radar: r, sinal: existente, resultado: 'ignorada' };
  const base = pesoBaseSinal(s.tipo, r.regrasScore);
  const confianca = Math.max(0, Math.min(1, s.confianca * fonte.confiabilidade));
  const sinal: Sinal = { id: ids.novo('SIN'), empresaId, projetoId: extras.projetoId, fonteId: fonte.id, fonteTipo: fonte.tipo, tipo: s.tipo, titulo: s.titulo, descricao: s.descricao ?? '', eventoEm: s.eventoEm, detectadoEm: ids.agora, confianca, url: s.url, externoId: s.externoId, payload: extras.payload, scoreBase: base, scoreEfetivo: Math.round(base * confianca * 10) / 10, verificado: !!extras.verificado, verificadoPor: extras.verificado ? ids.usuarioId : undefined, criadoEm: ids.agora };
  return { radar: { ...r, sinais: [...r.sinais, sinal] }, sinal, resultado: 'importada' };
}

/** Ingere um registro normalizado de adapter: guarda o bruto, faz upsert de empresa, projeto, contatos e sinais. */
export function ingerirRegistro(r: RadarDataset, reg: RegistroNormalizado, fonte: { id: string; tipo: TipoFonte; confiabilidade: number }, ids: Ids): { radar: RadarDataset; empresaId?: string; resultado: ResultadoUpsert; sinais: number; contatos: number } {
  let radar = r;
  const registro = { id: ids.novo('REG'), fonteId: fonte.id, tipo: 'empresa' as const, externoId: reg.externoId, payload: reg.payload, recebidoEm: ids.agora, entidadeId: undefined as string | undefined };
  if (!reg.empresa) return { radar: { ...radar, registrosFonte: [...radar.registrosFonte, registro] }, resultado: 'ignorada', sinais: 0, contatos: 0 };
  const up = upsertEmpresa(radar, reg.empresa, fonte.id, ids);
  radar = up.radar;
  registro.entidadeId = up.empresa.id;
  radar = { ...radar, registrosFonte: [...radar.registrosFonte, registro] };
  let projetoId: string | undefined;
  if (reg.projeto) { const p = upsertProjeto(radar, up.empresa.id, reg.projeto, fonte.id, ids); radar = p.radar; projetoId = p.projeto.id; }
  let contatos = 0;
  for (const c of reg.contatos ?? []) { const x = upsertContato(radar, up.empresa.id, c, fonte.id, ids); radar = x.radar; if (x.resultado === 'importada') contatos++; }
  let sinais = 0;
  for (const s of reg.sinais ?? []) { const x = registrarSinalNormalizado(radar, up.empresa.id, s, fonte, ids, { projetoId, payload: reg.payload }); radar = x.radar; if (x.resultado === 'importada') sinais++; }
  return { radar, empresaId: up.empresa.id, resultado: up.resultado, sinais, contatos };
}
