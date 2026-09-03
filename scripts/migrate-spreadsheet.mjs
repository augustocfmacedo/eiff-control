// Migracao da planilha Fluxo_de_Caixa_EIFF.xlsx para o dataset-semente do EIFF Control.
// Uso: node scripts/migrate-spreadsheet.mjs [caminho-da-planilha]
// Saida: src/data/seed.json e docs/relatorio-migracao.md
//
// Regras (Blueprint, secao 13):
//  - registros marcados como "Exemplo" NAO entram na carga real (ficam fora do seed)
//  - IDs duplicados, categorias nao cadastradas e vencimentos ausentes sao reportados
//  - todos os valores sao armazenados positivos; o tipo define o sinal

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';

XLSX.set_fs(fs);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const src = process.argv[2] || 'D:/Usuario/Documents/Fluxo_de_Caixa_EIFF.xlsx';

const wb = XLSX.readFile(src, { cellDates: true });
const sheet = (name, headerRow) =>
  XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, range: headerRow, raw: true, defval: '' });

const iso = (v) => {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') {
    const d = XLSX.SSF.parse_date_code(v);
    return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
  }
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  return undefined;
};
const num = (v, def = 0) => (v === '' || v === null || v === undefined ? def : Number(v));
const str = (v) => (v === undefined || v === null ? '' : String(v).trim());
const now = new Date().toISOString();
const report = { aceitos: {}, rejeitados: [], avisos: [], exemplosExcluidos: {} };

// ---------- CONFIG ----------
const cfg = sheet('CONFIG', 0);
const cfgVal = (label) => {
  const row = cfg.find((r) => str(r[0]) === label);
  return row ? row[1] : undefined;
};
const dataBase = iso(cfgVal('Data-base do modelo')) || '2026-09-01';
const cenario = str(cfgVal('Cenário selecionado')) || 'Base';
const incluirDemo = str(cfgVal('Incluir dados demonstrativos?')) === 'Sim';
const reservaMinima = num(cfgVal('Reserva operacional mínima'));
const fatores = {};
for (const r of cfg) {
  if (['Conservador', 'Base', 'Otimista'].includes(str(r[0])) && r[1] !== '' && r[2] !== '') {
    fatores[str(r[0])] = { entradas: num(r[1]), saidas: num(r[2]) };
  }
}
const contas = [];
let inContas = false;
for (const r of cfg) {
  if (str(r[0]) === 'Registro' && str(r[1]) === 'ID') { inContas = true; continue; }
  if (!inContas || !str(r[1])) continue;
  const registro = str(r[0]);
  if (registro === 'Exemplo') { report.exemplosExcluidos.contas = (report.exemplosExcluidos.contas || 0) + 1; continue; }
  contas.push({
    id: str(r[1]), registro, instituicao: str(r[2]), conta: str(r[3]), tipo: str(r[4]),
    saldoInicial: num(r[5]), saldoInicialData: dataBase, reservaVinculada: num(r[6]), ativa: str(r[7]) !== 'Não',
  });
}
report.aceitos.contas = contas.length;

// ---------- PLANO DE CONTAS ----------
const pc = sheet('PLANO CONTAS', 4);
const planoContas = [];
for (const r of pc.slice(1)) {
  if (!str(r[0])) continue;
  planoContas.push({
    categoria: str(r[0]), tipo: str(r[1]), grupoFluxo: str(r[2]),
    grupoDre: str(r[3]) || str(r[2]), classe: str(r[4]), orientacao: str(r[5]), ativa: true,
  });
}
report.aceitos.planoContas = planoContas.length;
const categorias = new Set(planoContas.map((c) => c.categoria));

// ---------- OBRAS ----------
const ob = sheet('OBRAS', 4);
const obras = [];
for (const r of ob.slice(1)) {
  if (!str(r[0])) continue;
  const registro = str(r[1]);
  if (registro === 'Exemplo') { report.exemplosExcluidos.obras = (report.exemplosExcluidos.obras || 0) + 1; continue; }
  obras.push({
    codigo: str(r[0]), registro, nome: str(r[2]), cliente: str(r[3]), cidadeUf: str(r[4]),
    status: str(r[5]) || 'Planejamento', escopo: str(r[6]),
    assinatura: iso(r[7]), inicio: iso(r[8]), fimContratual: iso(r[9]),
    valorContrato: num(r[10]), aditivos: num(r[11]), custoOrcado: num(r[13]),
    execucaoFisica: num(r[16]), medidoFaturado: num(r[17]), estimativaConcluir: num(r[23]),
    observacoes: str(r[29]),
  });
}
report.aceitos.obras = obras.length;
const codigosObra = new Set(obras.map((o) => o.codigo));

// ---------- LANCAMENTOS ----------
const ln = sheet('LANCAMENTOS', 4);
const hdr = ln[0].map(str);
const col = (name) => { const i = hdr.indexOf(name); if (i < 0) throw new Error(`coluna ausente: ${name}`); return i; };
const C = {
  id: col('ID'), registro: col('Registro'), categoria: col('Categoria'), sub: col('Subcategoria'),
  cc: col('Centro de Custo'), obra: col('Código Obra'), contraparte: col('Contraparte'), doc: col('Documento'),
  desc: col('Descrição'), comp: col('Competência'), venc: col('Vencimento'), real: col('Realização'),
  status: col('Status'), conf: col('Confiabilidade'), prob: col('Probabilidade'), conta: col('Conta Financeira'),
  bruto: col('Valor Bruto'), ret: col('Retenções / Impostos'), desc_: col('Desconto'), juros: col('Multa / Juros'),
  realizado: col('Valor Realizado'), conc: col('Conciliado?'), obs: col('Observações'),
};
const lancamentos = [];
const ids = new Set();
for (const r of ln.slice(1)) {
  const id = str(r[C.id]);
  if (!id) continue;
  const registro = str(r[C.registro]);
  if (registro === 'Exemplo') { report.exemplosExcluidos.lancamentos = (report.exemplosExcluidos.lancamentos || 0) + 1; continue; }
  const problemas = [];
  if (ids.has(id)) problemas.push('ID duplicado');
  const categoria = str(r[C.categoria]);
  if (!categorias.has(categoria)) problemas.push(`categoria nao cadastrada: ${categoria}`);
  const status = str(r[C.status]) || 'Programado';
  const vencimento = iso(r[C.venc]);
  if (status !== 'Cancelado' && !vencimento) problemas.push('sem vencimento');
  const realizacao = iso(r[C.real]);
  const valorRealizado = r[C.realizado] === '' ? undefined : num(r[C.realizado]);
  if (status === 'Realizado' && (!realizacao || valorRealizado === undefined)) problemas.push('realizado sem data/valor');
  const bruto = num(r[C.bruto]);
  if (bruto < 0) problemas.push('valor bruto negativo');
  const prob = r[C.prob] === '' ? 1 : num(r[C.prob]);
  if (prob < 0 || prob > 1) problemas.push('probabilidade fora de 0-100%');
  const codigoObra = str(r[C.obra]);
  if (codigoObra && !codigosObra.has(codigoObra)) problemas.push(`obra nao cadastrada: ${codigoObra}`);
  const plano = planoContas.find((p) => p.categoria === categoria);
  if (plano && plano.grupoFluxo === 'Custos Diretos de Obras' && !codigoObra) problemas.push('custo direto sem Código Obra');
  if (problemas.length) { report.rejeitados.push({ id, problemas }); continue; }
  ids.add(id);
  lancamentos.push({
    id, registro, categoria, subcategoria: str(r[C.sub]), centroCusto: str(r[C.cc]) || (codigoObra ? 'Obra' : 'Corporativo'),
    codigoObra, contraparte: str(r[C.contraparte]), documento: str(r[C.doc]), descricao: str(r[C.desc]),
    competencia: iso(r[C.comp]) || vencimento, vencimento, realizacao, status,
    confiabilidade: str(r[C.conf]) || 'Estimado', probabilidade: prob, contaFinanceira: str(r[C.conta]) || (contas[0]?.instituicao ?? 'Caixa'),
    valorBruto: bruto, retencoes: num(r[C.ret]), desconto: num(r[C.desc_]), multaJuros: num(r[C.juros]),
    valorRealizado, conciliado: str(r[C.conc]) === 'Sim', observacoes: str(r[C.obs]), anexos: [],
    origem: 'planilha', idExterno: id, criadoEm: now, criadoPor: 'migracao', atualizadoEm: now, atualizadoPor: 'migracao', versao: 1,
  });
}
report.aceitos.lancamentos = lancamentos.length;

// ---------- DIVIDAS ----------
const dividas = [];
try {
  const dv = sheet('DIVIDAS', 7);
  for (const r of dv.slice(1)) {
    if (!str(r[0]) || str(r[1]) === 'Exemplo') { if (str(r[1]) === 'Exemplo') report.exemplosExcluidos.dividas = (report.exemplosExcluidos.dividas || 0) + 1; continue; }
    dividas.push({
      id: str(r[0]), registro: str(r[1]), credor: str(r[2]), instrumento: str(r[3]), contratacao: iso(r[4]),
      principal: num(r[5]), saldoDevedor: num(r[6]), taxaAa: num(r[7]), parcelaMensal: num(r[8]),
      proximoVencimento: iso(r[9]), parcelasRestantes: num(r[10]), garantia: str(r[11]), status: str(r[13]) || 'Ativa', observacoes: str(r[14]),
    });
  }
} catch (e) { report.avisos.push(`DIVIDAS nao lida: ${e.message}`); }
report.aceitos.dividas = dividas.length;

// ---------- CONCILIACAO ----------
const transacoes = [];
const cc = sheet('CONCILIACAO', 4);
for (const r of cc.slice(1)) {
  if (!str(r[0])) continue;
  if (str(r[1]) === 'Exemplo') { report.exemplosExcluidos.transacoes = (report.exemplosExcluidos.transacoes || 0) + 1; continue; }
  transacoes.push({
    id: str(r[0]), registro: str(r[1]), data: iso(r[2]), conta: str(r[3]), historico: str(r[4]), documento: str(r[5]),
    debito: num(r[6]), credito: num(r[7]), lancamentoIds: str(r[9]) ? [str(r[9])] : [], origem: 'planilha',
  });
}
report.aceitos.transacoes = transacoes.length;

// ---------- Servicos da obra derivados das receitas previstas ----------
// As receitas "Receita prevista - <servico> - <mes>" da planilha descrevem os servicos contratados.
// Cada servico recebe o preco de venda (soma das receitas), o prazo (primeiro ao ultimo mes) e os
// lancamentos passam a apontar para ele. Custo orcado fica em zero ate a Engenharia informar.
const ETAPA_POR_SERVICO = [
  [/estrutura met/i, 'Fabricação'], [/pintura/i, 'Pintura'], [/telha|cobertura|fechamento/i, 'Cobertura e fechamento'],
  [/concreto|piso|laje|funda/i, 'Civil'], [/m[aã]o de obra|montagem/i, 'Montagem'], [/projeto/i, 'Projeto'],
];
const servicos = [];
for (const l of lancamentos) {
  const m = l.descricao.match(/^Receita prevista\s*-\s*(.+?)\s*-\s*[a-z]{3}\/\d{2}$/i);
  if (!m || !l.codigoObra) continue;
  const nome = m[1].trim();
  const cap = nome.charAt(0).toUpperCase() + nome.slice(1);
  let s = servicos.find((x) => x.codigoObra === l.codigoObra && x.nome === cap);
  if (!s) {
    const sigla = l.codigoObra.split('-').slice(1, 3).join('');
    s = {
      id: `SRV-${sigla}-${String(servicos.filter((x) => x.codigoObra === l.codigoObra).length + 1).padStart(2, '0')}`,
      codigoObra: l.codigoObra, codigo: `${sigla}-${String(servicos.filter((x) => x.codigoObra === l.codigoObra).length + 1).padStart(2, '0')}`,
      nome: cap, etapa: (ETAPA_POR_SERVICO.find(([re]) => re.test(nome)) || [null, 'Outros'])[1],
      unidade: 'vb', quantidadeOrcada: 1, quantidadeExecutada: 0, custoOrcado: 0, precoVenda: 0,
      inicioPrevisto: undefined, fimPrevisto: undefined, status: 'Não iniciado', categoriaPadrao: undefined,
      observacoes: 'Derivado das receitas previstas da planilha; informar custo orçado, quantidades e prazos reais.', ativo: true,
    };
    servicos.push(s);
  }
  s.precoVenda += l.valorBruto - l.retencoes - l.desconto + l.multaJuros;
  const ini = `${l.competencia.slice(0, 7)}-01`;
  if (!s.inicioPrevisto || ini < s.inicioPrevisto) s.inicioPrevisto = ini;
  if (!s.fimPrevisto || l.vencimento > s.fimPrevisto) s.fimPrevisto = l.vencimento;
  l.servicoId = s.id;
}
for (const s of servicos) s.precoVenda = Math.round(s.precoVenda * 100) / 100;
report.aceitos.servicos = servicos.length;

// ---------- Usuarios demonstrativos (DEC-02 pendente) ----------
const usuarios = [
  { id: 'u-augusto', nome: 'Augusto Macedo', email: 'augustocfmacedo@gmail.com', papel: 'Diretoria', obras: '*', ativo: true },
  { id: 'u-admin', nome: 'Administrador', email: 'admin@eiff.local', papel: 'Administrador', obras: '*', ativo: true },
  { id: 'u-fin', nome: 'Financeiro EIFF', email: 'financeiro@eiff.local', papel: 'Financeiro', obras: '*', ativo: true },
  { id: 'u-obra', nome: 'Gestor Smart Fit', email: 'gestor.obra@eiff.local', papel: 'Gestor de obra', obras: obras.map((o) => o.codigo), ativo: true },
  { id: 'u-eng', nome: 'Engenharia', email: 'engenharia@eiff.local', papel: 'Engenharia', obras: obras.map((o) => o.codigo), ativo: true },
  { id: 'u-compras', nome: 'Compras', email: 'compras@eiff.local', papel: 'Compras', obras: '*', ativo: true },
  { id: 'u-contab', nome: 'Contabilidade', email: 'contabilidade@eiff.local', papel: 'Contabilidade', obras: '*', ativo: true },
  { id: 'u-audit', nome: 'Auditoria', email: 'auditoria@eiff.local', papel: 'Auditoria', obras: '*', ativo: true },
];

const dataset = {
  params: {
    organizacao: 'EIFF', empresa: 'EIFF Engenharia', dataBase, cenario, incluirDemo, reservaMinima,
    fatores: {
      Conservador: fatores.Conservador || { entradas: 0.85, saidas: 1.05 },
      Base: fatores.Base || { entradas: 1, saidas: 1 },
      Otimista: fatores.Otimista || { entradas: 1.1, saidas: 0.95 },
    },
    // DEC-03: valores a confirmar pela Diretoria/Financeiro antes do go-live
    alcadas: { limiteGestorObra: 20000, limiteFinanceiro: 100000, limiteDiretoria: 100000, desvioOrcamentoPermitido: 0.05, toleranciaConciliacao: 0.01, slaAprovacaoHoras: 48 },
    responsavel: str(cfgVal('Responsável pelo modelo')) || 'Diretoria Financeira',
    versao: str(cfgVal('Versão')) || '1.0',
  },
  planoContas, contas, obras, lancamentos, liquidacoes: [], transacoes, dividas,
  aprovacoes: [], auditoria: [{ id: 'aud-0001', ts: now, usuario: 'migracao', acao: 'carga_planilha', entidade: 'dataset', entidadeId: path.basename(src), depois: report.aceitos }],
  comentarios: [], tarefas: [], usuarios, fechamentos: [],
  servicos, demandas: [], ordens: [], colaboradores: [], apontamentos: [],
};

fs.mkdirSync(path.join(root, 'src', 'data'), { recursive: true });
fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
fs.writeFileSync(path.join(root, 'src', 'data', 'seed.json'), JSON.stringify(dataset, null, 2));

const md = `# Relatorio de migracao da planilha

Fonte: \`${src}\`
Gerado em: ${now}
Data-base: ${dataBase} | Cenario: ${cenario} | Dados demonstrativos na planilha: ${incluirDemo ? 'Sim' : 'Nao'}

## Aceitos
${Object.entries(report.aceitos).map(([k, v]) => `- ${k}: ${v}`).join('\n')}

## Exemplos excluidos da carga
${Object.keys(report.exemplosExcluidos).length ? Object.entries(report.exemplosExcluidos).map(([k, v]) => `- ${k}: ${v}`).join('\n') : '- nenhum'}

## Rejeitados
${report.rejeitados.length ? report.rejeitados.map((r) => `- ${r.id}: ${r.problemas.join('; ')}`).join('\n') : '- nenhum'}

## Avisos
${report.avisos.length ? report.avisos.map((a) => `- ${a}`).join('\n') : '- nenhum'}
`;
fs.writeFileSync(path.join(root, 'docs', 'relatorio-migracao.md'), md);
console.log(JSON.stringify(report, null, 2));
