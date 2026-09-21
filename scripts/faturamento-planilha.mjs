// Le a planilha ACOMPANHAMENTO_FATURAMENTO_INVEST_<obra>.xlsx (o controle manual do contrato) e normaliza o que
// ela tem: cronograma contratual (aba Planilha1), notas ja faturadas (aba "Controle de Faturamento") e o
// consolidado por etapa (aba "Resumo Faturamentos"). Com --sql, gera a migration de carga correspondente.
//
//   node scripts/faturamento-planilha.mjs --arquivo <xlsx> [--json <saida.json>] [--sql <migration.sql>]
//
// Nada e gravado no banco aqui: a carga em producao e feita aplicando a migration gerada.

import fs from 'node:fs';
import * as XLSX from 'xlsx';

const args = process.argv.slice(2);
const opt = (nome, padrao) => {
  const i = args.indexOf(`--${nome}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : padrao;
};

const arquivo = opt('arquivo');
if (!arquivo) {
  console.error('uso: node scripts/faturamento-planilha.mjs --arquivo <xlsx> [--json <saida.json>] [--sql <migration.sql>]');
  process.exit(1);
}

const OBRA = opt('obra', 'OB-SF-CL-01');
const ORG = opt('org', 'EIFF');
const PERFIL = opt('perfil', 'augusto@eiff.com.br');

/** Etapa do contrato (texto da planilha) -> codigo do servico da obra no sistema. */
export const ETAPA_SERVICO = {
  'Projetos Executivos': 'SFCL-01',
  'Administração / Mobilização': 'SFCL-02',
  'Serviços Preliminares': 'SFCL-03',
  'Movimentação de Terra': 'SFCL-04',
  'Fundação e Arrimo': 'SFCL-05',
  'Estrutura Metálica': 'SFCL-06',
  Cobertura: 'SFCL-07',
  'Instalações Gerais': 'SFCL-08',
  'Steel Deck': 'SFCL-09',
  'Vedação Externa': 'SFCL-10',
  'Estrutura/Cobertura/Transporte': 'SFCL-11',
  'Piso Industrial': 'SFCL-12',
  Pintura: 'SFCL-13',
  'Instalações / Acabamentos': 'SFCL-14',
  'Acabamentos / Testes': 'SFCL-15',
  'Acabamentos / Pré-entrega': 'SFCL-16',
  'Entrega Final': 'SFCL-17',
};

/** Categoria do plano de contas de cada nota direta, pela descricao (decidido na carga). */
const CATEGORIA = [
  [/container/i, 'Equipamentos e locações'],
  [/rolo compactador|escavadeira|guindaste/i, 'Equipamentos e locações'],
  [/terraplanagem|perfura|furação|minipoço/i, 'Mão de obra terceirizada'],
  [/armação|ferragem|ferro/i, 'Aço e perfis'],
  [/concreto/i, 'Concreto e fundações'],
  [/chumbador|chapas de base|parafuso/i, 'Componentes e fixadores'],
  [/madeira|pontalete|bloco|canaleta|epi/i, 'Outros custos diretos'],
];
const categoriaDe = (d) => (CATEGORIA.find(([re]) => re.test(d)) ?? [null, 'Outros custos diretos'])[1];

/** Eventos ja corretos no sistema em outra forma (E07 da planilha = E07 + E07b, mesma soma e mesmo split). */
const EVENTOS_INTOCADOS = new Set(['E07']);
/** Notas da construtora que ja existem no sistema: so ganham rateio. */
const CODIGO_EXISTENTE = { 47: 'REC-SF-CL-001' };

const data = (v) => {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') return new Date(Date.UTC(1899, 11, 30) + v * 86_400_000).toISOString().slice(0, 10);
  return undefined;
};
const num = (v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : 0);
const txt = (v) => (v === null || v === undefined ? '' : String(v).trim());
const esc = (s) => String(s ?? '').replace(/'/g, "''");
const q = (s) => (s ? `'${esc(s)}'` : 'null');

const wb = XLSX.read(fs.readFileSync(arquivo), { cellDates: true });
const aba = (nome) => XLSX.utils.sheet_to_json(wb.Sheets[nome], { header: 1, defval: null });

// --- cronograma contratual (aba Planilha1) -----------------------------------
const cronograma = aba('Planilha1')
  .slice(1)
  .filter((l) => txt(l[3]).startsWith('E'))
  .map((l) => ({
    evento: txt(l[3]),
    mes: Number(String(l[1]).replace(/\D/g, '')) || 0,
    etapa: txt(l[2]),
    servico: ETAPA_SERVICO[txt(l[2])],
    titulo: txt(l[4]),
    escopo: txt(l[5]),
    bruto: num(l[6]),
    liquido: num(l[7]),
    direto: num(l[9]),
    construtora: num(l[12]),
    retencao: num(l[14]),
  }));

// --- notas ja lancadas (aba "Controle de Faturamento") ------------------------
const notas = aba('Controle de Faturamento')
  .slice(4)
  .filter((l) => txt(l[3]) && num(l[7]) > 0)
  .map((l) => ({
    nf: txt(l[0]) === '-' ? '' : txt(l[0]),
    data: data(l[1]),
    fornecedor: txt(l[2]),
    frente: txt(l[3]) === 'Construtora' ? 'Construtora' : 'Direto',
    descricao: txt(l[4]),
    etapa: txt(l[5]),
    servico: ETAPA_SERVICO[txt(l[5])],
    valor: num(l[7]),
    enviadoCliente: txt(l[8]).toUpperCase() === 'SIM',
    situacao: txt(l[9]).toUpperCase() === 'ESTIMATIVA' ? 'Estimativa' : 'Faturado',
  }));

// --- consolidado por etapa (aba "Resumo Faturamentos") ------------------------
const resumo = aba('Resumo Faturamentos')
  .slice(4)
  .filter((l) => txt(l[0]) && txt(l[0]) !== 'Total Geral')
  .map((l) => ({
    etapa: txt(l[0]),
    servico: ETAPA_SERVICO[txt(l[0])],
    bruto: num(l[1]),
    liquido: num(l[2]),
    previstoDireto: num(l[3]),
    previstoConstrutora: num(l[4]),
    faturadoDireto: num(l[6]),
    faturadoConstrutora: num(l[8]),
    faturadoTotal: num(l[9]),
    saldo: num(l[10]),
  }));

const somar = (lista, campo) => Math.round(lista.reduce((a, x) => a + x[campo], 0) * 100) / 100;
const porFrente = (f) => somar(notas.filter((n) => n.frente === f && n.situacao === 'Faturado'), 'valor');

const saida = {
  arquivo,
  cronograma,
  notas,
  resumo,
  totais: {
    contratoBruto: somar(cronograma, 'bruto'),
    contratoDireto: somar(cronograma, 'direto'),
    contratoConstrutora: somar(cronograma, 'construtora'),
    retencao: somar(cronograma, 'retencao'),
    faturadoDireto: porFrente('Direto'),
    faturadoConstrutora: porFrente('Construtora'),
    faturadoTotal: Math.round((porFrente('Direto') + porFrente('Construtora')) * 100) / 100,
    estimativas: somar(notas.filter((n) => n.situacao === 'Estimativa'), 'valor'),
  },
};

const semServico = [...new Set([...cronograma, ...notas].filter((x) => x.etapa && !x.servico).map((x) => x.etapa))];
if (semServico.length) console.error('etapas sem serviço correspondente:', semServico.join(' | '));

// --- migration de carga (--sql) ----------------------------------------------
function gerarSql() {
  const fonte = arquivo.split(/[\\/]/).pop();
  const L = [];
  const p = (...linhas) => L.push(...linhas);

  p(`-- Carga do acompanhamento de faturamento do contrato ${OBRA}: a planilha ${fonte}`,
    '-- (revisao vigente do cronograma e notas ja faturadas), que passa a viver no sistema.',
    '-- Gerado por scripts/faturamento-planilha.mjs --sql. Idempotente: pode rodar de novo sem duplicar.',
    '--',
    '-- (1) Cronograma na revisao da planilha. O total do contrato nao muda: muda a distribuicao entre eventos e o',
    `--     split direto/construtora. ${[...EVENTOS_INTOCADOS].join(', ')} nao e tocado: no sistema ele esta desdobrado e ja soma o mesmo.`,
    '');

  for (const e of cronograma) {
    if (EVENTOS_INTOCADOS.has(e.evento)) continue;
    p(`update measurement m set gross_amount = ${e.bruto}, direct_amount = ${e.direto}, contractor_amount = ${e.construtora}, retention_amount = ${e.retencao}, stage = ${q(e.etapa)}, month_no = ${e.mes}`,
      `  from project p where m.project_id = p.id and p.code = '${OBRA}' and m.number = '${e.evento}'`,
      `  and (m.gross_amount, m.direct_amount, m.contractor_amount, m.retention_amount) is distinct from (${e.bruto}, ${e.direto}, ${e.construtora}, ${e.retencao});`);
  }

  p('',
    '-- (2) Notas de faturamento direto: cada linha da planilha vira um titulo de saida com faturamento direto,',
    '--     vinculado ao servico da etapa. Situacao ESTIMATIVA entra como Rascunho (a nota ainda nao existe).',
    '--     Faturamento direto nao passa pelo caixa nem pelo DRE da EIFF; conta no comprometido da obra e abate o',
    '--     saldo de faturamento direto do contrato. "ENVIADO INVEST = SIM" vira client_forwarded_on na data da nota.',
    '');

  const diretas = notas.filter((n) => n.frente === 'Direto');
  diretas.forEach((n, ix) => {
    const code = `PAG-FD-${String(ix + 1).padStart(3, '0')}`;
    const dia = n.data ?? cronograma[0]?.data ?? '2026-09-16';
    const rascunho = n.situacao === 'Estimativa';
    p('insert into financial_entry (code, organization_id, company_id, record_kind, entry_type, chart_account_id, cost_center_label, project_id, service_id, direct_billing, client_forwarded_on, counterparty_name, document_number, description, competence_date, due_date, status, confidence, probability, gross_amount, notes, source_system, external_id, created_by, updated_by)',
      `select '${code}', o.id, c.id, 'Real', 'Saída', ca.id, 'Obra', p.id, s.id, true, ${n.enviadoCliente ? `'${dia}'` : 'null'}, ${q(n.fornecedor === '-' ? 'A definir' : n.fornecedor)}, ${q(n.nf)}, ${q(n.descricao)}, '${dia}', '${dia}', '${rascunho ? 'Rascunho' : 'Programado'}', '${rascunho ? 'Estimado' : 'Confirmado'}', 1, ${n.valor},`,
      `  ${q(`Carga do acompanhamento de faturamento (${fonte}) · etapa ${n.etapa}.`)}, 'planilha-faturamento', '${code}', pr.id, pr.id`,
      'from organization o join company c on c.organization_id = o.id and c.code = o.code',
      `  join project p on p.organization_id = o.id and p.code = '${OBRA}'`,
      `  join project_service s on s.project_id = p.id and s.code = '${n.servico}'`,
      `  join chart_account ca on ca.organization_id = o.id and ca.category = ${q(categoriaDe(n.descricao))}`,
      `  join profile pr on pr.organization_id = o.id and pr.email = '${PERFIL}'`,
      `where o.code = '${ORG}' and not exists (select 1 from financial_entry e where e.organization_id = o.id and e.code = '${code}');`,
      '');
  });

  p('-- (3) Notas da construtora: uma NF cobre varias etapas, entao o titulo e unico e quem diz quanto foi faturado',
    '--     em cada etapa e o rateio (entry_service_split). Nota ja existente no sistema so ganha o rateio; as demais',
    '--     entram como recebiveis Programados, a conferir e conciliar com o extrato.',
    '');

  const nfs = [...new Set(notas.filter((n) => n.frente === 'Construtora').map((n) => n.nf))];
  for (const nf of nfs) {
    const linhas = notas.filter((n) => n.frente === 'Construtora' && n.nf === nf);
    const total = Math.round(linhas.reduce((a, l) => a + l.valor, 0) * 100) / 100;
    const dia = linhas[0].data;
    const code = CODIGO_EXISTENTE[nf] ?? `REC-FC-${nf}`;
    if (!CODIGO_EXISTENTE[nf]) {
      p('insert into financial_entry (code, organization_id, company_id, record_kind, entry_type, chart_account_id, cost_center_label, project_id, counterparty_name, document_number, description, competence_date, due_date, status, confidence, probability, gross_amount, notes, source_system, external_id, created_by, updated_by)',
        `select '${code}', o.id, c.id, 'Real', 'Entrada', ca.id, 'Obra', p.id, ${q(linhas[0].fornecedor)}, 'NF ${esc(nf)}', ${q(`${linhas[0].descricao} · NF ${nf}`)}, '${dia}', '${dia}', 'Programado', 'Confirmado', 1, ${total},`,
        `  ${q(`Carga do acompanhamento de faturamento (${fonte}). Conferir recebimento e conciliar com o extrato.`)}, 'planilha-faturamento', '${code}', pr.id, pr.id`,
        'from organization o join company c on c.organization_id = o.id and c.code = o.code',
        `  join project p on p.organization_id = o.id and p.code = '${OBRA}'`,
        "  join chart_account ca on ca.organization_id = o.id and ca.category = 'Medições de obras'",
        `  join profile pr on pr.organization_id = o.id and pr.email = '${PERFIL}'`,
        `where o.code = '${ORG}' and not exists (select 1 from financial_entry e where e.organization_id = o.id and e.code = '${code}');`,
        '');
    }
    p(`delete from entry_service_split where entry_id in (select e.id from financial_entry e join project p on p.id = e.project_id where p.code = '${OBRA}' and e.code = '${code}');`);
    for (const l of linhas) {
      p('insert into entry_service_split (organization_id, entry_id, project_id, service_id, description, amount, created_by)',
        `select o.id, e.id, p.id, s.id, ${q(`${l.descricao} · ${l.etapa}`)}, ${l.valor}, pr.id`,
        `from organization o join project p on p.organization_id = o.id and p.code = '${OBRA}'`,
        `  join financial_entry e on e.organization_id = o.id and e.code = '${code}'`,
        `  join project_service s on s.project_id = p.id and s.code = '${l.servico}'`,
        `  join profile pr on pr.organization_id = o.id and pr.email = '${PERFIL}'`,
        `where o.code = '${ORG}';`);
    }
    p('');
  }

  return { sql: `${L.join('\n')}\n`, diretas: diretas.length, nfs: nfs.length };
}

const json = opt('json');
if (json) {
  fs.writeFileSync(json, `${JSON.stringify(saida, null, 2)}\n`);
  console.log(`JSON gravado em ${json}`);
}
const sql = opt('sql');
if (sql) {
  const r = gerarSql();
  fs.writeFileSync(sql, r.sql);
  console.log(`SQL gravado em ${sql} · ${r.diretas} notas diretas · ${r.nfs} NFs da construtora`);
}
console.log(`eventos: ${cronograma.length} · notas: ${notas.length} · etapas: ${resumo.length}`);
console.table(saida.totais);
