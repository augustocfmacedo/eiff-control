// Importacao CSV do Radar como funcao pura (usada pelo store e pelo script de carga em producao):
// cria o job, linhas e erros; deduplica; sinaliza possiveis duplicatas; nunca descarta linha em silencio.
import { normalizarContatosCsv, normalizarEmpresasCsv } from './csv';
import { PERSONAS } from './contatos';
import { associarEmpresaContato, upsertContato, upsertEmpresa, type Ids } from './ingestao';
import { recalcularEmpresa } from './pipeline';
import type { Fonte, ImportacaoErro, ImportacaoJob, ImportacaoLinha, Persona, RadarDataset, RegistroFonte } from './types';

export interface OpcoesImportacao { tipo: 'empresas' | 'contatos'; fonte: Fonte; arquivo?: string; usuarioId: string; agora: string }

/** Gera ids sequenciais (EMP-00001...) sem colidir com os existentes; espelha o comportamento do store. */
export function criarIds(r: RadarDataset, x: { hoje: string; agora: string; usuarioId: string }): Ids {
  const usados = new Set<string>([...r.fontes, ...r.empresas, ...r.contatos, ...r.projetos, ...r.sinais, ...r.oportunidades, ...r.historicoEstagios, ...r.atividades, ...r.tarefas, ...r.estrategias, ...r.experimentos, ...r.regrasScore, ...r.snapshotsScore, ...r.importacoes, ...r.importacaoLinhas, ...r.importacaoErros, ...r.duplicatas, ...r.supressoes, ...r.registrosFonte].map((e) => e.id));
  const contagem: Record<string, number> = {};
  return {
    novo: (p) => { let k = (contagem[p] ?? usados.size) + 1; let id = `${p}-${String(k).padStart(5, '0')}`; while (usados.has(id)) id = `${p}-${String(++k).padStart(5, '0')}`; contagem[p] = k; usados.add(id); return id; },
    hoje: x.hoje, agora: x.agora, usuarioId: x.usuarioId,
  };
}

/** Recalcula score e caches das empresas informadas; grava snapshot quando o total ou a classe mudam. */
export function recalcularEmpresas(r: RadarDataset, empresaIds: string[], ids: Ids): RadarDataset {
  const snapshots = [...r.snapshotsScore];
  const empresas = r.empresas.map((e) => {
    if (!empresaIds.includes(e.id) || !e.ativo || e.mescladaEm) return e;
    const { empresa, explicacao } = recalcularEmpresa(e, r, ids.hoje);
    const ultimo = snapshots.filter((s) => s.empresaId === e.id).sort((a, b) => (a.em < b.em ? 1 : -1))[0];
    if (!ultimo || Math.abs(ultimo.total - explicacao.total) >= 0.5 || ultimo.classe !== explicacao.classe) {
      const d = (k: string) => explicacao.dimensoes.find((x) => x.dimensao === k)?.score ?? 0;
      snapshots.push({ id: ids.novo('SNP'), empresaId: e.id, em: ids.agora, fit: d('FIT'), timing: d('TIMING'), intent: d('INTENT'), relationship: d('RELATIONSHIP'), dataQuality: d('DATA_QUALITY'), total: explicacao.total, classe: explicacao.classe, explicacao });
    }
    return empresa;
  });
  return { ...r, empresas, snapshotsScore: snapshots };
}

export function importarCsv(r0: RadarDataset, texto: string, opts: OpcoesImportacao, ids: Ids): { radar: RadarDataset; job: ImportacaoJob; afetadas: string[] } {
  let r = r0;
  const fonte = opts.fonte;
  const agora = opts.agora;
  const job: ImportacaoJob = { id: ids.novo('IMP'), fonteId: fonte.id, tipo: opts.tipo, arquivo: opts.arquivo ?? 'colado', status: 'Processando', total: 0, importados: 0, atualizados: 0, duplicados: 0, erros: 0, criadoPor: opts.usuarioId, criadoEm: agora };
  const linhas: ImportacaoLinha[] = []; const erros: ImportacaoErro[] = []; const afetadas = new Set<string>();
  if (opts.tipo === 'empresas') {
    const { empresas, colunas } = normalizarEmpresasCsv(texto);
    if (!colunas.some((c) => c === 'razaoSocial' || c === 'nomeFantasia')) throw new Error('Não encontrei a coluna de razão social/empresa no cabeçalho.');
    job.total = empresas.length;
    for (const e of empresas) {
      if (e.erros.some((x) => x.campo === 'razaoSocial')) { for (const er of e.erros) erros.push({ id: ids.novo('IER'), jobId: job.id, numero: e.numero, campo: er.campo, mensagem: er.mensagem }); linhas.push({ id: ids.novo('ILN'), jobId: job.id, numero: e.numero, dados: e.dados, status: 'erro', mensagem: e.erros.map((x) => x.mensagem).join('; ') }); job.erros++; continue; }
      for (const er of e.erros) erros.push({ id: ids.novo('IER'), jobId: job.id, numero: e.numero, campo: er.campo, mensagem: er.mensagem });
      const registro: RegistroFonte = { id: ids.novo('REG'), fonteId: fonte.id, tipo: 'empresa', externoId: e.businessId ?? e.fonteExternaId, payload: e.dados, recebidoEm: agora };
      try {
        const up = upsertEmpresa(r, { businessId: e.businessId, cnpj: e.cnpj, razaoSocial: e.razaoSocial, nomeFantasia: e.nomeFantasia, dominio: e.dominio, site: e.site, linkedin: e.linkedin, setor: e.setor, cnae: e.cnae, cidade: e.cidade, uf: e.uf, pais: e.pais, faixaFuncionarios: e.faixaFuncionarios, faixaReceita: e.faixaReceita, capitalSocial: e.capitalSocial, numeroUnidades: e.numeroUnidades, externoId: e.fonteExternaId, observacoes: e.observacoes }, fonte.id, ids);
        r = { ...up.radar, registrosFonte: [...up.radar.registrosFonte, { ...registro, entidadeId: up.empresa.id }] };
        afetadas.add(up.empresa.id);
        if (up.resultado === 'importada') job.importados++; else if (up.resultado === 'atualizada') job.atualizados++; else if (up.resultado === 'duplicata_possivel') { job.duplicados++; job.importados++; }
        linhas.push({ id: ids.novo('ILN'), jobId: job.id, numero: e.numero, dados: e.dados, status: up.resultado, entidadeId: up.empresa.id, mensagem: up.match ? `${up.match.nivel}: ${up.match.motivo}` : undefined });
      } catch (err) {
        job.erros++; erros.push({ id: ids.novo('IER'), jobId: job.id, numero: e.numero, mensagem: (err as Error).message }); linhas.push({ id: ids.novo('ILN'), jobId: job.id, numero: e.numero, dados: e.dados, status: 'erro', mensagem: (err as Error).message });
      }
    }
  } else {
    const { contatos, colunas } = normalizarContatosCsv(texto);
    if (!colunas.includes('nome')) throw new Error('Não encontrei a coluna de nome do contato no cabeçalho.');
    job.total = contatos.length;
    for (const c of contatos) {
      if (c.erros.length) { for (const er of c.erros) erros.push({ id: ids.novo('IER'), jobId: job.id, numero: c.numero, campo: er.campo, mensagem: er.mensagem }); }
      if (c.erros.some((x) => x.campo === 'nome' || x.campo === 'empresa')) { linhas.push({ id: ids.novo('ILN'), jobId: job.id, numero: c.numero, dados: c.dados, status: 'erro', mensagem: c.erros.map((x) => x.mensagem).join('; ') }); job.erros++; continue; }
      const assoc = associarEmpresaContato({ empresaExternoId: c.empresaExternoId, empresaDominio: c.empresaDominio, empresaNome: c.empresaNome, empresaCnpj: c.empresaCnpj }, r.empresas);
      const fonteLinha = c.fonte ? r.fontes.find((f) => f.codigo.toLowerCase() === c.fonte!.toLowerCase() || f.nome.toLowerCase() === c.fonte!.toLowerCase()) ?? fonte : fonte;
      const dadosContato = { nome: c.nome, cargo: c.cargo, departamento: c.departamento, senioridade: c.senioridade, email: c.email, telefone: c.telefone, celular: c.celular, whatsapp: c.whatsapp, linkedin: c.linkedin, decisor: c.decisor, poderDecisao: c.poderDecisao, persona: c.persona && PERSONAS.includes(c.persona as Persona) ? (c.persona as Persona) : undefined, statusEmail: c.statusEmail, statusTelefone: c.statusTelefone, verificadoEm: c.verificadoEm, externoId: c.fonteExternaId, observacoes: c.observacoes };
      if (assoc.nivel === 'ambiguo') {
        // ambiguidade relevante: nunca cria empresa; vai para a fila de revisao com as candidatas
        linhas.push({ id: ids.novo('ILN'), jobId: job.id, numero: c.numero, dados: c.dados, status: 'revisao', mensagem: assoc.motivo, candidatos: assoc.candidatos });
        job.revisao = (job.revisao ?? 0) + 1;
        continue;
      }
      let empresaId = assoc.empresa?.id;
      let nota: string | undefined;
      if (!empresaId) {
        if (!c.empresaNome && !c.empresaCnpj) { linhas.push({ id: ids.novo('ILN'), jobId: job.id, numero: c.numero, dados: c.dados, status: 'revisao', mensagem: 'Empresa não encontrada (id, domínio e nome não casaram)', candidatos: [] }); job.revisao = (job.revisao ?? 0) + 1; continue; }
        const up = upsertEmpresa(r, { cnpj: c.empresaCnpj, razaoSocial: c.empresaNome ?? c.empresaDominio ?? '', dominio: c.empresaDominio, externoId: c.empresaExternoId }, fonteLinha.id, ids);
        r = up.radar; empresaId = up.empresa.id; nota = `empresa criada: ${up.empresa.razaoSocial}`;
        if (up.resultado === 'duplicata_possivel') job.duplicados++;
      }
      const ct = upsertContato(r, empresaId, dadosContato, fonteLinha.id, ids);
      r = { ...ct.radar, registrosFonte: [...ct.radar.registrosFonte, { id: ids.novo('REG'), fonteId: fonteLinha.id, tipo: 'contato', externoId: c.fonteExternaId, payload: c.dados, recebidoEm: agora, entidadeId: ct.contato.id }] };
      afetadas.add(empresaId);
      if (ct.resultado === 'importada') job.importados++; else job.atualizados++;
      linhas.push({ id: ids.novo('ILN'), jobId: job.id, numero: c.numero, dados: c.dados, status: ct.resultado === 'importada' ? 'importada' : 'atualizada', entidadeId: ct.contato.id, mensagem: nota ?? (assoc.nivel === 'provavel' ? `empresa por ${assoc.motivo}` : undefined) });
    }
  }
  job.status = job.erros === 0 && !job.revisao ? 'Concluída' : job.erros === job.total ? 'Falhou' : 'Com erros';
  job.concluidoEm = agora;
  r = { ...r, importacoes: [...r.importacoes, job], importacaoLinhas: [...r.importacaoLinhas, ...linhas], importacaoErros: [...r.importacaoErros, ...erros] };
  return { radar: r, job, afetadas: [...afetadas] };
}
