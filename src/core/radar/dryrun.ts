// Dry run da importacao de contatos (decisores): simula a associacao a empresas e o enriquecimento (persona,
// decision fit, qualidade) sem gravar nada, para validar um lote real antes de importar.
import { normalizarContatosCsv } from './csv';
import { associarEmpresaContato, upsertContato, type Ids } from './ingestao';
import { NOME_PERSONA } from './contatos';
import type { Contato, Persona, RadarDataset } from './types';

export type StatusLinhaDryRun = 'ok' | 'revisao' | 'invalido' | 'duplicata_arquivo' | 'ja_no_radar';
export interface LinhaDryRun {
  numero: number; nome: string; empresa: string; status: StatusLinhaDryRun; associacao: string; nivel?: 'certo' | 'provavel' | 'ambiguo' | 'nenhum';
  via?: 'cnpj' | 'id_externo' | 'business_id' | 'dominio' | 'nome'; empresaId?: string; persona?: Persona; senioridade?: string; decisionFit?: number; qualidade?: number;
  email?: string; statusEmail?: string; emailValido: boolean; mensagem?: string;
}
export interface DryRunContatos {
  linhas: number; contatosUnicos: number; empresasUnicas: number;
  associacoes: { exatas: number; businessId: number; dominio: number; provaveis: number; ambiguas: number; naoEncontradas: number };
  duplicatas: { noArquivo: number; jaNoRadar: number };
  invalidos: number;
  emailsValidos: number; emailsStatusValido: number;
  porPersona: Record<string, number>; porSenioridade: Record<string, number>;
  decisionFitMedio: number | null;
  empresasCobertas: number; totalEmpresas: number; cobertura: number | null;
  colunas: { coluna: string; campo?: string }[];
  detalhes: LinhaDryRun[];
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const viaDe = (motivo: string): LinhaDryRun['via'] => (motivo === 'CNPJ' ? 'cnpj' : motivo.startsWith('business_id') ? 'business_id' : motivo.startsWith('id externo') ? 'id_externo' : motivo.startsWith('domínio') ? 'dominio' : 'nome');
const inc = (m: Record<string, number>, k: string) => { m[k] = (m[k] ?? 0) + 1; };

/**
 * Simula a importacao de um CSV de contatos contra o Radar atual. Nada e gravado: o radar recebido nao muda.
 * totalEmpresas: base da cobertura (padrao: empresas ativas do Radar; informe 91 para o lote piloto quando a lista ainda nao estiver carregada).
 */
export function dryRunContatosCsv(texto: string, r: RadarDataset, hoje: string, totalEmpresas?: number): DryRunContatos {
  const { contatos, colunas, cabecalho } = normalizarContatosCsv(texto);
  let seq = 0;
  const ids: Ids = { novo: (p) => `${p}-DRY-${++seq}`, hoje, agora: `${hoje}T00:00:00.000Z`, usuarioId: 'dry-run' };
  let sim: RadarDataset = { ...r, contatos: [...r.contatos] }; // copia rasa: upsertContato devolve um novo objeto
  const vistos = new Set<string>(); const empresasArquivo = new Set<string>(); const cobertas = new Set<string>();
  const assoc = { exatas: 0, businessId: 0, dominio: 0, provaveis: 0, ambiguas: 0, naoEncontradas: 0 };
  const dup = { noArquivo: 0, jaNoRadar: 0 };
  let invalidos = 0; let emailsValidos = 0; let emailsStatusValido = 0;
  const porPersona: Record<string, number> = {}; const porSenioridade: Record<string, number> = {}; const fits: number[] = [];
  const detalhes: LinhaDryRun[] = [];
  const nomeEmpresa = (c: { empresaNome?: string; empresaDominio?: string; empresaExternoId?: string; empresaCnpj?: string }) => c.empresaNome ?? c.empresaDominio ?? c.empresaExternoId ?? c.empresaCnpj ?? '';
  for (const c of contatos) {
    const emailOk = !!c.email && EMAIL.test(c.email) && c.statusEmail !== 'invalido' && c.statusEmail !== 'devolvido';
    const base: LinhaDryRun = { numero: c.numero, nome: c.nome, empresa: nomeEmpresa(c), status: 'ok', associacao: '', email: c.email, statusEmail: c.statusEmail, emailValido: emailOk };
    if (c.erros.some((x) => x.campo === 'nome' || x.campo === 'empresa' || x.campo === 'email')) { invalidos++; detalhes.push({ ...base, status: 'invalido', mensagem: c.erros.map((x) => x.mensagem).join('; ') }); continue; }
    const chaveEmpresa = (c.empresaExternoId ?? c.empresaCnpj ?? c.empresaDominio ?? c.empresaNome ?? '').toLowerCase();
    if (chaveEmpresa) empresasArquivo.add(chaveEmpresa);
    const chave = (c.fonteExternaId ?? c.email ?? `${c.nome}|${chaveEmpresa}`).toLowerCase();
    if (vistos.has(chave)) { dup.noArquivo++; detalhes.push({ ...base, status: 'duplicata_arquivo', mensagem: 'repetido no arquivo (mesmo id/e-mail/nome+empresa)' }); continue; }
    vistos.add(chave);
    if (emailOk) emailsValidos++; if (c.statusEmail === 'valido') emailsStatusValido++;
    const a = associarEmpresaContato({ empresaExternoId: c.empresaExternoId, empresaDominio: c.empresaDominio, empresaNome: c.empresaNome, empresaCnpj: c.empresaCnpj }, sim.empresas);
    base.associacao = a.motivo; base.nivel = a.nivel;
    if (a.nivel === 'ambiguo') { assoc.ambiguas++; detalhes.push({ ...base, status: 'revisao', mensagem: `ambígua: ${a.motivo} (${a.candidatos.length} candidata(s))` }); continue; }
    if (!a.empresa) { assoc.naoEncontradas++; detalhes.push({ ...base, status: 'revisao', mensagem: c.empresaNome || c.empresaCnpj ? 'empresa não encontrada: seria criada na importação' : 'empresa não encontrada: iria para a fila de revisão' }); continue; }
    const via = viaDe(a.motivo); base.via = via; base.empresaId = a.empresa.id;
    if (a.nivel === 'provavel') assoc.provaveis++; else if (via === 'business_id') assoc.businessId++; else if (via === 'dominio') assoc.dominio++; else assoc.exatas++;
    const existente = sim.contatos.find((x) => x.empresaId === a.empresa!.id && ((c.fonteExternaId && x.fonteExternaId === c.fonteExternaId) || (c.email && x.email?.toLowerCase() === c.email.toLowerCase()) || x.nome.toLowerCase() === c.nome.toLowerCase()));
    const up = upsertContato(sim, a.empresa.id, { nome: c.nome, cargo: c.cargo, departamento: c.departamento, senioridade: c.senioridade, email: c.email, telefone: c.telefone, celular: c.celular, whatsapp: c.whatsapp, linkedin: c.linkedin, decisor: c.decisor, poderDecisao: c.poderDecisao, statusEmail: c.statusEmail, statusTelefone: c.statusTelefone, verificadoEm: c.verificadoEm, externoId: c.fonteExternaId, observacoes: c.observacoes } as Parameters<typeof upsertContato>[2], undefined, ids);
    sim = up.radar;
    const ct: Contato = up.contato;
    cobertas.add(a.empresa.id);
    if (ct.persona) inc(porPersona, NOME_PERSONA[ct.persona] ?? ct.persona); else inc(porPersona, 'sem persona');
    inc(porSenioridade, ct.senioridade ?? 'não informada');
    if (typeof ct.decisionFitScore === 'number') fits.push(ct.decisionFitScore);
    if (existente) dup.jaNoRadar++;
    detalhes.push({ ...base, status: existente ? 'ja_no_radar' : 'ok', persona: ct.persona, senioridade: ct.senioridade, decisionFit: ct.decisionFitScore, qualidade: ct.qualidade, mensagem: existente ? `já existe no Radar (${existente.id}): seria atualizado nos campos vazios` : undefined });
  }
  const ativas = r.empresas.filter((e) => e.ativo && !e.mescladaEm).length;
  const total = totalEmpresas ?? ativas;
  const contatosUnicos = vistos.size;
  return {
    linhas: contatos.length, contatosUnicos, empresasUnicas: empresasArquivo.size, associacoes: assoc, duplicatas: dup, invalidos, emailsValidos, emailsStatusValido, porPersona, porSenioridade,
    decisionFitMedio: fits.length ? Math.round((fits.reduce((s, x) => s + x, 0) / fits.length) * 10) / 10 : null,
    empresasCobertas: cobertas.size, totalEmpresas: total, cobertura: total ? cobertas.size / total : null,
    colunas: cabecalho.map((coluna, i) => ({ coluna, campo: colunas[i] })), detalhes,
  };
}

/** Relatorio em texto (CLI e tela). */
export function relatorioDryRun(d: DryRunContatos): string[] {
  const pct = (v: number | null) => (v == null ? '—' : `${Math.round(v * 1000) / 10}%`);
  const dist = (m: Record<string, number>) => Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}: ${v}`).join(' · ') || '—';
  return [
    `linhas do arquivo: ${d.linhas}`,
    `contatos únicos: ${d.contatosUnicos}`,
    `empresas únicas no arquivo: ${d.empresasUnicas}`,
    `associações exatas (CNPJ / id externo): ${d.associacoes.exatas}`,
    `associações por business_id: ${d.associacoes.businessId}`,
    `associações por domínio: ${d.associacoes.dominio}`,
    `associações prováveis (razão social): ${d.associacoes.provaveis}`,
    `ambiguidades (fila de revisão): ${d.associacoes.ambiguas}`,
    `empresa não encontrada: ${d.associacoes.naoEncontradas}`,
    `duplicatas: ${d.duplicatas.noArquivo} no arquivo · ${d.duplicatas.jaNoRadar} já no Radar`,
    `registros inválidos: ${d.invalidos}`,
    `e-mails válidos: ${d.emailsValidos} (${d.emailsStatusValido} com status "valid")`,
    `distribuição por persona: ${dist(d.porPersona)}`,
    `distribuição por senioridade: ${dist(d.porSenioridade)}`,
    `decision fit médio: ${d.decisionFitMedio ?? '—'}`,
    `empresas cobertas: ${d.empresasCobertas} de ${d.totalEmpresas}`,
    `cobertura: ${pct(d.cobertura)}`,
  ];
}
