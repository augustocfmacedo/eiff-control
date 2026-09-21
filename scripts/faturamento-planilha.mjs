// Le a planilha ACOMPANHAMENTO_FATURAMENTO_INVEST_<obra>.xlsx (controle manual do contrato)
// e normaliza o que ela tem: cronograma contratual (aba Planilha1), notas ja faturadas
// (aba "Controle de Faturamento") e o consolidado por etapa (aba "Resumo Faturamentos").
//
//   node scripts/faturamento-planilha.mjs --arquivo <xlsx> [--json <saida.json>]
//
// Nao grava nada no banco: a carga em producao e feita pela migration gerada a partir deste JSON.

import fs from 'node:fs';
import * as XLSX from 'xlsx';

const args = process.argv.slice(2);
const opt = (nome, padrao) => {
  const i = args.indexOf(`--${nome}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : padrao;
};

const arquivo = opt('arquivo');
if (!arquivo) {
  console.error('uso: node scripts/faturamento-planilha.mjs --arquivo <xlsx> [--json <saida.json>]');
  process.exit(1);
}

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

const data = (v) => {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') return new Date(Date.UTC(1899, 11, 30) + v * 86_400_000).toISOString().slice(0, 10);
  return undefined;
};
const num = (v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : 0);
const txt = (v) => (v === null || v === undefined ? '' : String(v).trim());

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
if (semServico.length) console.error('etapas sem servico correspondente:', semServico.join(' | '));

const json = opt('json');
if (json) {
  fs.writeFileSync(json, `${JSON.stringify(saida, null, 2)}\n`);
  console.log(`JSON gravado em ${json}`);
}
console.log(`eventos: ${cronograma.length} · notas: ${notas.length} · etapas: ${resumo.length}`);
console.table(saida.totais);
