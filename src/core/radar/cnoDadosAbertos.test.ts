// LE-3A — o contrato da fonte oficial do CNO.
//
// As fixtures sao FICTICIAS e minusculas de proposito: nenhum dado real de obra ou de CNPJ de terceiro entra
// no repositorio, e nenhum dataset publico grande e versionado. O que vem do snapshot real sao apenas os
// CABECALHOS oficiais, transcritos literalmente para prender o contrato.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ARQUIVOS_CNO, CABECALHOS_CNO, CABECALHO_CNO, CABECALHO_CNO_AREAS, CABECALHO_CNO_CNAES,
  CABECALHO_CNO_TOTAIS, CABECALHO_CNO_VINCULOS, CATEGORIAS_AREA, DESTINACOES_AREA, ENCODING_CNO,
  HOST_OFICIAL_CNO, MODO_FONTE_CNO, ORIGENS_DATA_EVENTO_CNO, QUALIFICACAO_CNO, SEM_EVENTO_DATADO,
  SINAL_POR_CATEGORIA, SITUACAO_CNO, TIPOS_AREA, TIPOS_CONSTRUTIVOS,
  SCHEMA_CNO,
  areaDeLinha, cabecalhoCsvCno, camposCsvCno, cnaeDeLinha, cnoNormalizado, cnpjDoResponsavel,
  conferirCabecalho, dataCno, dataEventoCno, envelopeCno, externoIdCno, indicesDe, juntarCno,
  juntarObservacoesCno, lerAreaCno, lerCnaeCno, lerObraCno, lerVinculoCno, linhaComoObjeto, numeroCno,
  obraDeLinha, payloadCno, pedidoIntakeCno, sinalCno, textoCno, totaisDeLinha, vinculoDeLinha,
  type CnoObservacao, type CnoObservacaoCanonica, type EnvelopeCno,
} from './cnoDadosAbertos';
import { adapterCNO } from './adapters';
import { classificarIntake, discoveryRecordDe, payloadFingerprint, registroDeIntake, validarIntake } from './leadEngineIntake';

// --------------------------------------------------------------------------------------------------- fixtures
const CNPJ = '11222333000181';          // CNPJ ficticio com digito verificador valido
const CNO_A = '010010092278';
const CNO_B = '010010119379';

/** Cabecalhos LITERAIS do snapshot oficial de 12/09/2026 — a acentuacao inconsistente e da Receita. */
const CAB_OBRA = '"CNO","Código do Pais","Nome do pais","Data de início","Data de inicio da responsabilidade","Data de registro","CNO vinculado","CEP","NI do responsável","Qualificação do responsavel","Nome","Código do municipio","Nome do município","Tipo de logradouro","Logradouro","Número do logradouro","Bairro","Estado","Caixa Postal","Complemento","Unidade de medida","Área total","Situação","Data da situação","Nome empresarial","Código de localização"';
const CAB_AREAS = '"CNO","Categoria","Destinação","Tipo de obra","Tipo de Área","Tipo de Área Complementar","Metragem"';
const CAB_CNAES = '"CNO","CNAE","Data de registro"';
const CAB_VINCULOS = '"CNO","Data de início","Data de fim","Data de registro","Qualificação do contribuinte","NI do responsável"';
const CAB_TOTAIS = '"Total de obras","Total de cnaes","Total de áreas","Total de vínculos"';

const ixObra = indicesDe(cabecalhoCsvCno(CAB_OBRA));
const ixAreas = indicesDe(cabecalhoCsvCno(CAB_AREAS));
const ixCnaes = indicesDe(cabecalhoCsvCno(CAB_CNAES));
const ixVinculos = indicesDe(cabecalhoCsvCno(CAB_VINCULOS));
const ixTotais = indicesDe(cabecalhoCsvCno(CAB_TOTAIS));

/** Linha de obra ficticia, com a mesma forma do artefato (texto entre aspas, numero e data sem aspas). */
const linhaObra = (p: Partial<Record<string, string>> = {}) => {
  const c: Record<string, string> = {
    CNO: CNO_A, pais: '105', nomePais: '"BRASIL"', inicio: '1992-02-20', inicioResp: '1992-02-20',
    registro: '2022-05-17', vinculado: '', cep: '71215207', ni: CNPJ, qualificacao: '0053',
    nome: '"Galpão Alfa"', municipioCod: '9701', municipio: '"ANÁPOLIS"', tipoLogr: '"RUA"',
    logradouro: '"DAS ACÁCIAS"', numero: '"SN"', bairro: '"DISTRITO INDUSTRIAL"', uf: '"GO"', caixaPostal: '',
    complemento: '"LOTES 3/5"', unidade: '"m2"', areaTotal: '412.00', situacao: '02', dataSituacao: '2002-11-30',
    nomeEmpresarial: '"Construtora Fictícia Alfa Ltda"', localizacao: '"58PJ64Q5+JP"', ...p,
  };
  return [c.CNO, c.pais, c.nomePais, c.inicio, c.inicioResp, c.registro, c.vinculado, c.cep, c.ni,
    c.qualificacao, c.nome, c.municipioCod, c.municipio, c.tipoLogr, c.logradouro, c.numero, c.bairro,
    c.uf, c.caixaPostal, c.complemento, c.unidade, c.areaTotal, c.situacao, c.dataSituacao,
    c.nomeEmpresarial, c.localizacao].join(',');
};

const obra = (p: Partial<Record<string, string>> = {}) => obraDeLinha(camposCsvCno(linhaObra(p)), ixObra)!;

const linhaArea = (cno: string, categoria: string, destinacao = 'Galpão industrial', tipoArea = 'Principal', metragem = '412.00', complementar = '', construtivo = 'Alvenaria') =>
  `${cno},"${categoria}","${destinacao}","${construtivo}","${tipoArea}",${complementar ? `"${complementar}"` : ''},${metragem}`;

const area = (cno: string, categoria: string, ...resto: string[]) => areaDeLinha(camposCsvCno(linhaArea(cno, categoria, ...resto)), ixAreas)!;

/** Observacao COMPLETA (evidencia + canonica), que e o que o intake consome desde o LE3-A1. */
const obsCom = (categorias: string[], base: Partial<Record<string, string>> = {}, cabObra = CAB_OBRA): CnoObservacao =>
  juntarObservacoesCno({
    obras: [lerObraCno(cabecalhoCsvCno(cabObra), indicesDe(cabecalhoCsvCno(cabObra)), camposCsvCno(linhaObra(base)))!],
    areas: categorias.map((c) => lerAreaCno(cabecalhoCsvCno(CAB_AREAS), ixAreas, camposCsvCno(linhaArea(CNO_A, c)))!),
  }).observacoes[0];

/** Só a projeção canônica, para os testes que falam de normalização. */
const comAreas = (categorias: string[], base: Partial<Record<string, string>> = {}): CnoObservacaoCanonica =>
  obsCom(categorias, base).canonical;

// ---------------------------------------------------------------------------------------------------------
describe('LE-3A · schema e leitura do CSV', () => {
  it('1 · reconhece os cabeçalhos oficiais dos cinco arquivos, exatamente como a Receita escreve', () => {
    expect(cabecalhoCsvCno(CAB_OBRA)).toEqual([...CABECALHO_CNO]);
    expect(cabecalhoCsvCno(CAB_AREAS)).toEqual([...CABECALHO_CNO_AREAS]);
    expect(cabecalhoCsvCno(CAB_CNAES)).toEqual([...CABECALHO_CNO_CNAES]);
    expect(cabecalhoCsvCno(CAB_VINCULOS)).toEqual([...CABECALHO_CNO_VINCULOS]);
    expect(cabecalhoCsvCno(CAB_TOTAIS)).toEqual([...CABECALHO_CNO_TOTAIS]);
    // a acentuacao inconsistente da fonte esta preservada, nao "corrigida"
    expect(CABECALHO_CNO).toContain('Código do Pais');
    expect(CABECALHO_CNO).toContain('Nome do pais');
    expect(CABECALHO_CNO).toContain('Data de inicio da responsabilidade');
    expect(CABECALHO_CNO).toContain('Qualificação do responsavel');
    expect(CABECALHO_CNO_AREAS).toContain('Tipo de obra');
  });

  it('2 · ignora BOM no início do cabeçalho', () => {
    expect(cabecalhoCsvCno('﻿' + CAB_OBRA)[0]).toBe('CNO');
    expect(cabecalhoCsvCno(CAB_OBRA)[0]).toBe('CNO');
  });

  it('3 · o encoding real da fonte é declarado como latin1 e os nomes dos arquivos são minúsculos', () => {
    expect(ENCODING_CNO).toBe('latin1');
    expect([...ARQUIVOS_CNO]).toEqual(['cno.csv', 'cno_cnaes.csv', 'cno_vinculos.csv', 'cno_areas.csv', 'cno_totais.csv']);
    // o texto acentuado do cabecalho sobrevive a ida e volta por latin1, que e como o snapshot chega
    const voltou = Buffer.from(CAB_OBRA, 'latin1').toString('latin1');
    expect(cabecalhoCsvCno(voltou)).toEqual([...CABECALHO_CNO]);
  });

  it('4 · o separador é vírgula: ponto-e-vírgula não quebra a linha em campos', () => {
    expect(camposCsvCno('a,b,c')).toEqual(['a', 'b', 'c']);
    expect(camposCsvCno('a;b;c')).toEqual(['a;b;c']);
  });

  it('5 · campo vazio é preservado como posição e vira ausência no domínio', () => {
    expect(camposCsvCno('a,,c')).toEqual(['a', '', 'c']);
    expect(camposCsvCno(',,')).toEqual(['', '', '']);
    expect(textoCno('')).toBeUndefined();
    expect(textoCno('   ')).toBeUndefined();
  });

  it('6 · aspas: campo entre aspas com vírgula dentro e aspas escapadas por duplicação', () => {
    expect(camposCsvCno('1,"ALFA, BETA",3')).toEqual(['1', 'ALFA, BETA', '3']);
    expect(camposCsvCno('1,"diz ""oi""",3')).toEqual(['1', 'diz "oi"', '3']);
    expect(camposCsvCno('"",x')).toEqual(['', 'x']);
  });

  it('7 · acentos atravessam o parser sem perda', () => {
    expect(camposCsvCno('1,"ANÁPOLIS","Galpão industrial"')).toEqual(['1', 'ANÁPOLIS', 'Galpão industrial']);
    expect(obra().municipio).toBe('ANÁPOLIS');
  });

  it('8 · cabeçalho desconhecido não passa em silêncio: o diagnóstico nomeia a diferença', () => {
    expect(conferirCabecalho([...CABECALHO_CNO_CNAES], CABECALHO_CNO_CNAES).ok).toBe(true);
    const c = conferirCabecalho(['CNO', 'CNAE', 'Data de registro', 'Coluna Nova'], CABECALHO_CNO_CNAES);
    expect(c.ok).toBe(false);
    expect(c.inesperados).toEqual(['Coluna Nova']);
    const f = conferirCabecalho(['CNO', 'CNAE'], CABECALHO_CNO_CNAES);
    expect(f.ok).toBe(false);
    expect(f.faltando).toEqual(['Data de registro']);
    // e todo arquivo declarado tem cabecalho esperado
    for (const a of ARQUIVOS_CNO) expect(CABECALHOS_CNO[a].length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('LE-3A · a obra', () => {
  it('9 · o CNO é normalizado para 12 dígitos e continua string (zero à esquerda é significativo)', () => {
    expect(obra().cno).toBe(CNO_A);
    expect(cnoNormalizado('01.001.009227-8')).toBe(CNO_A);
    expect(cnoNormalizado('123')).toBeUndefined();
    expect(cnoNormalizado('')).toBeUndefined();
    expect(obra().cno.startsWith('0')).toBe(true);
  });

  it('10 · "Nome" vira nomeObra', () => {
    expect(obra().nomeObra).toBe('Galpão Alfa');
  });

  it('11 · "Nome empresarial" vira nomeResponsavel', () => {
    expect(obra().nomeResponsavel).toBe('Construtora Fictícia Alfa Ltda');
  });

  it('12 · "Nome" NUNCA vira razão social — nem no parser, nem no payload, nem no adapter', () => {
    const o = obra({ nome: '"Galpão Alfa"', nomeEmpresarial: '"Construtora Fictícia Alfa Ltda"' });
    expect(o.nomeResponsavel).not.toBe(o.nomeObra);
    const p = payloadCno(o);
    expect(p.nomeResponsavel).toBe('Construtora Fictícia Alfa Ltda');
    expect(p.nomeObra).toBe('Galpão Alfa');
    const reg = adapterCNO.normalizar(p)!;
    expect(reg.empresa?.razaoSocial).toBe('Construtora Fictícia Alfa Ltda');
    expect(reg.empresa?.razaoSocial).not.toBe('Galpão Alfa');
    // sem PJ, o nome da obra nao pode salvar o adapter: nao nasce empresa nenhuma
    const semPj = payloadCno(obra({ ni: '', nomeEmpresarial: '' }));
    expect(adapterCNO.normalizar(semPj)).toBeUndefined();
  });

  it('13 · município', () => {
    expect(obra().municipio).toBe('ANÁPOLIS');
    expect(obra().codigoMunicipioTom).toBe('9701'); // codigo TOM da Receita, 4 digitos, nao IBGE
  });

  it('14 · UF', () => {
    expect(obra().uf).toBe('GO');
  });

  it('15 · endereço composto de tipo + logradouro + número', () => {
    expect(obra().endereco).toBe('RUA DAS ACÁCIAS SN');
    expect(obra().bairro).toBe('DISTRITO INDUSTRIAL');
    expect(obra().complemento).toBe('LOTES 3/5');
    expect(obraDeLinha(camposCsvCno(linhaObra({ tipoLogr: '', logradouro: '', numero: '' })), ixObra)!.endereco).toBeUndefined();
  });

  it('16 · CEP', () => {
    expect(obra().cep).toBe('71215207');
    expect(obra({ cep: '' }).cep).toBeUndefined();
  });

  it('17 · área total numérica com ponto decimal, e unidade de medida preservada', () => {
    expect(obra().areaTotal).toBe(412);
    expect(obra({ areaTotal: '5258.21' }).areaTotal).toBeCloseTo(5258.21, 2);
    expect(obra().unidadeMedida).toBe('m2');
    expect(numeroCno('')).toBeUndefined();
    expect(numeroCno('abc')).toBeUndefined();
  });

  it('18 · situação vem como código e ganha o nome oficial', () => {
    expect(obra({ situacao: '02' }).situacao).toBe('02');
    expect(obra({ situacao: '02' }).situacaoNome).toBe('ATIVA');
    expect(obra({ situacao: '15' }).situacaoNome).toBe('ENCERRADA');
    expect(SITUACAO_CNO).toEqual({ '01': 'NULA', '02': 'ATIVA', '03': 'SUSPENSA', '14': 'PARALISADA', '15': 'ENCERRADA' });
    // codigo desconhecido nao inventa nome
    expect(obra({ situacao: '99' }).situacaoNome).toBeUndefined();
  });

  it('19 · as quatro datas são lidas só no formato oficial AAAA-MM-DD', () => {
    const o = obra();
    expect(o.dataInicio).toBe('1992-02-20');
    expect(o.dataInicioResponsabilidade).toBe('1992-02-20');
    expect(o.dataRegistro).toBe('2022-05-17');
    expect(o.dataSituacao).toBe('2002-11-30');
    expect(dataCno('20/02/1992')).toBeUndefined();
    expect(dataCno('')).toBeUndefined();
    expect(obra({ inicio: '20/02/1992' }).dataInicio).toBeUndefined();
  });

  it('19b · a qualificação do responsável é atributo de fonte, com os códigos oficiais congelados', () => {
    expect(obra({ qualificacao: '0053' }).qualificacaoResponsavelNome).toBe('Pessoa Jurídica Construtora');
    expect(Object.keys(QUALIFICACAO_CNO).sort()).toEqual(['0053', '0057', '0064', '0070', '0109', '0110', '0111']);
  });

  it('19c · o "Código de localização" é preservado como está (plus code), sem interpretação', () => {
    expect(obra().localizacao).toBe('58PJ64Q5+JP');
    expect(obra({ localizacao: '' }).localizacao).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('LE-3A · identidade', () => {
  it('20 · CNPJ de 14 dígitos com DV válido vira identidade forte', () => {
    expect(obra().cnpjResponsavel).toBe(CNPJ);
    expect(cnpjDoResponsavel(CNPJ)).toBe(CNPJ);
  });

  it('21 · NI ausente (pessoa física) NÃO vira CNPJ nem empresa', () => {
    const o = obra({ ni: '', nomeEmpresarial: '' });
    expect(o.cnpjResponsavel).toBeUndefined();
    expect(o.nomeResponsavel).toBeUndefined();
    expect(cnpjDoResponsavel('')).toBeUndefined();
    expect(cnpjDoResponsavel(undefined)).toBeUndefined();
    // e a obra continua sendo descoberta bruta valida: o CNO segue lá
    expect(o.cno).toBe(CNO_A);
    expect(payloadCno(o).cno).toBe(CNO_A);
  });

  it('22 · NI com dígito verificador inválido não vira identidade forte', () => {
    expect(cnpjDoResponsavel('11222333000182')).toBeUndefined();
    expect(cnpjDoResponsavel('11111111111111')).toBeUndefined();
    expect(cnpjDoResponsavel('1122233300018')).toBeUndefined();
    expect(obra({ ni: '11222333000182' }).cnpjResponsavel).toBeUndefined();
  });

  it('23 · externoId é o número do CNO — nunca CNPJ, nome da obra, hash ou posição no arquivo', () => {
    const o = obra();
    expect(externoIdCno(o)).toBe(CNO_A);
    expect(externoIdCno(o)).not.toBe(o.cnpjResponsavel);
    expect(externoIdCno(o)).not.toBe(o.nomeObra);
    expect(pedidoIntakeCno(obsCom(['Obra Nova']), 'FONTE-CNO', '2026-09-23T10:00:00.000Z').externoId).toBe(CNO_A);
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('LE-3A · áreas', () => {
  it('24-28 · as cinco categorias oficiais são lidas como texto, como o artefato entrega', () => {
    expect([...CATEGORIAS_AREA]).toEqual(['Obra Nova', 'Acréscimo', 'Reforma', 'Demolição', 'Existente']);
    for (const c of CATEGORIAS_AREA) expect(area(CNO_A, c).area.categoria).toBe(c);
  });

  it('29 · destinação "Galpão industrial" e as demais do catálogo oficial', () => {
    expect(area(CNO_A, 'Obra Nova', 'Galpão industrial').area.destinacao).toBe('Galpão industrial');
    expect([...DESTINACOES_AREA]).toContain('Galpão industrial');
    expect([...DESTINACOES_AREA]).toHaveLength(7);
    expect([...TIPOS_CONSTRUTIVOS]).toEqual(['Alvenaria', 'Madeira', 'Mista']);
    expect([...TIPOS_AREA]).toEqual(['Principal', 'Complementar']);
    // "Tipo de obra" e metodo construtivo, NAO natureza da obra
    expect(area(CNO_A, 'Demolição').area.tipoConstrutivo).toBe('Alvenaria');
  });

  it('30 · todas as áreas de um mesmo CNO são preservadas — nunca só a primeira', () => {
    const r = juntarCno({
      obras: [obra()],
      areas: [
        area(CNO_A, 'Obra Nova', 'Galpão industrial', 'Principal', '1000.00'),
        area(CNO_A, 'Acréscimo', 'Comercial salas e lojas', 'Principal', '250.50'),
        area(CNO_A, 'Obra Nova', 'Residencial unifamiliar', 'Complementar', '80.00', 'Piscina'),
      ],
    });
    expect(r.observacoes[0].areas).toHaveLength(3);
    expect(r.observacoes[0].areas.map((a) => a.metragem).sort((a, b) => a! - b!)).toEqual([80, 250.5, 1000]);
    expect(r.observacoes[0].areas.find((a) => a.tipoArea === 'Complementar')?.tipoAreaComplementar).toBe('Piscina');
  });

  it('31 · a ordem das áreas é determinística, independente da ordem de entrada', () => {
    const as = [
      area(CNO_A, 'Reforma', 'Casa popular', 'Principal', '10.00'),
      area(CNO_A, 'Obra Nova', 'Galpão industrial', 'Complementar', '20.00', 'Piscina'),
      area(CNO_A, 'Acréscimo', 'Casa popular', 'Principal', '30.00'),
    ];
    const direta = juntarCno({ obras: [obra()], areas: as }).observacoes[0].areas;
    const invertida = juntarCno({ obras: [obra()], areas: [...as].reverse() }).observacoes[0].areas;
    expect(invertida).toEqual(direta);
    // e o payload — logo o fingerprint — nao depende da ordem de leitura do arquivo
    const p1 = juntarCno({ obras: [obra()], areas: as }).observacoes[0];
    const p2 = juntarCno({ obras: [obra()], areas: [...as].reverse() }).observacoes[0];
    expect(payloadFingerprint(payloadCno(p1))).toBe(payloadFingerprint(payloadCno(p2)));
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('LE-3A · joins por CNO', () => {
  it('32 · CNAEs são agrupados pelo CNO', () => {
    const r = juntarCno({
      obras: [obra(), obra({ CNO: CNO_B })],
      cnaes: [
        cnaeDeLinha(camposCsvCno(`${CNO_A},4120400,2022-05-17`), ixCnaes)!,
        cnaeDeLinha(camposCsvCno(`${CNO_A},4399103,2022-05-18`), ixCnaes)!,
        cnaeDeLinha(camposCsvCno(`${CNO_B},4120400,2026-06-30`), ixCnaes)!,
      ],
    });
    expect(r.observacoes.find((o) => o.cno === CNO_A)!.cnaes.map((c) => c.cnae)).toEqual(['4120400', '4399103']);
    expect(r.observacoes.find((o) => o.cno === CNO_B)!.cnaes).toHaveLength(1);
    expect(r.diagnosticos).toHaveLength(0);
  });

  it('33 · vínculos são agrupados pelo CNO, com qualificação nomeada e CNPJ validado', () => {
    const v = vinculoDeLinha(camposCsvCno(`${CNO_A},1988-08-01,,2022-05-26,0053,${CNPJ}`), ixVinculos)!;
    const semNi = vinculoDeLinha(camposCsvCno(`${CNO_A},2025-05-23,,2025-05-23,0110,`), ixVinculos)!;
    const r = juntarCno({ obras: [obra()], vinculos: [v, semNi] });
    expect(r.observacoes[0].vinculos).toHaveLength(2);
    expect(r.observacoes[0].vinculos[0].inicio).toBe('1988-08-01');
    expect(r.observacoes[0].vinculos[0].qualificacaoNome).toBe('Pessoa Jurídica Construtora');
    expect(r.observacoes[0].vinculos[0].cnpjResponsavel).toBe(CNPJ);
    expect(r.observacoes[0].vinculos[1].cnpjResponsavel).toBeUndefined();
    expect(r.observacoes[0].vinculos[1].fim).toBeUndefined();
  });

  it('34 · área órfã é diagnosticada, não descartada em silêncio', () => {
    const r = juntarCno({ obras: [obra()], areas: [area(CNO_A, 'Obra Nova'), area(CNO_B, 'Reforma')] });
    expect(r.observacoes).toHaveLength(1);
    expect(r.observacoes[0].areas).toHaveLength(1);
    expect(r.diagnosticos).toEqual([{ tipo: 'AREA_ORFA', cno: CNO_B }]);
  });

  it('35 · CNAE e vínculo órfãos também são diagnosticados', () => {
    const r = juntarCno({
      obras: [obra()],
      cnaes: [cnaeDeLinha(camposCsvCno(`${CNO_B},4120400,2022-05-17`), ixCnaes)!],
      vinculos: [vinculoDeLinha(camposCsvCno(`${CNO_B},1988-08-01,,2022-05-26,0053,`), ixVinculos)!],
    });
    expect(r.diagnosticos).toEqual([{ tipo: 'CNAE_ORFAO', cno: CNO_B }, { tipo: 'VINCULO_ORFAO', cno: CNO_B }]);
    expect(r.observacoes[0].cnaes).toHaveLength(0);
    expect(r.observacoes[0].vinculos).toHaveLength(0);
  });

  it('35b · os totais oficiais são lidos e servem de conferência do snapshot', () => {
    const t = totaisDeLinha(camposCsvCno('"00003604156","00003942713","00004553076","00000431211"'), ixTotais);
    expect(t).toEqual({ obras: 3604156, cnaes: 3942713, areas: 4553076, vinculos: 431211 });
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('LE-3A · adapter', () => {
  const reg = (categorias: string[], base: Partial<Record<string, string>> = {}) =>
    adapterCNO.normalizar(envelopeCno(obsCom(categorias, base)));

  it('36 · a PJ responsável vira a empresa, com CNPJ e local da obra', () => {
    const r = reg(['Obra Nova'])!;
    expect(r.fonte).toBe('CNO');
    expect(r.empresa?.razaoSocial).toBe('Construtora Fictícia Alfa Ltda');
    expect(r.empresa?.cnpj).toBe(CNPJ);
    expect(r.externoId).toBe(CNO_A);
  });

  it('37 · o projeto sai correto: nome da obra, endereço, área e externoId = CNO', () => {
    const r = reg(['Obra Nova'])!;
    expect(r.projeto?.nome).toBe('Galpão Alfa');
    expect(r.projeto?.cidade).toBe('ANÁPOLIS');
    expect(r.projeto?.uf).toBe('GO');
    expect(r.projeto?.endereco).toBe('RUA DAS ACÁCIAS SN');
    expect(r.projeto?.areaM2).toBe(412);
    expect(r.projeto?.externoId).toBe(CNO_A);
  });

  it('38 · Obra Nova → CNO_NEW', () => {
    expect(sinalCno(comAreas(['Obra Nova']))).toBe('CNO_NEW');
    expect(reg(['Obra Nova'])!.sinais?.[0].tipo).toBe('CNO_NEW');
    expect(SINAL_POR_CATEGORIA['Obra Nova']).toBe('CNO_NEW');
  });

  it('39 · Acréscimo e Reforma → CNO_EXPANSION', () => {
    expect(sinalCno(comAreas(['Acréscimo']))).toBe('CNO_EXPANSION');
    expect(sinalCno(comAreas(['Reforma']))).toBe('CNO_EXPANSION');
    expect(reg(['Acréscimo'])!.sinais?.[0].tipo).toBe('CNO_EXPANSION');
    expect(reg(['Reforma'])!.sinais?.[0].tipo).toBe('CNO_EXPANSION');
    // precedencia declarada: qualquer Obra Nova vence
    expect(sinalCno(comAreas(['Reforma', 'Obra Nova']))).toBe('CNO_NEW');
    expect(sinalCno(comAreas(['Demolição', 'Acréscimo']))).toBe('CNO_EXPANSION');
  });

  it('40 · Demolição NÃO vira CNO_NEW — não vira sinal nenhum', () => {
    expect(sinalCno(comAreas(['Demolição']))).toBe('NENHUM');
    expect(reg(['Demolição'])!.sinais).toEqual([]);
    expect(SINAL_POR_CATEGORIA['Demolição']).toBe('NENHUM');
  });

  it('41 · Existente não vira obra nova; sem área ou com categoria desconhecida também não há sinal', () => {
    expect(sinalCno(comAreas(['Existente']))).toBe('NENHUM');
    expect(reg(['Existente'])!.sinais).toEqual([]);
    expect(sinalCno({ areas: [] })).toBe('NENHUM');
    expect(sinalCno({ areas: [{ categoria: 'Categoria Que Não Existe' }] })).toBe('NENHUM');
    // o metodo construtivo nunca decide a natureza da obra
    expect(sinalCno({ areas: [{ categoria: 'Demolição', tipoConstrutivo: 'Alvenaria' }] })).toBe('NENHUM');
  });

  it('42 · o payload bruto/canônico é preservado inteiro no registro normalizado', () => {
    const p = envelopeCno(obsCom(['Obra Nova']));
    const r = adapterCNO.normalizar(p)!;
    expect(r.payload).toBe(p); // a LINHAGEM recebe o envelope, nao so o canonico
    expect((r.payload as EnvelopeCno).evidence.obra['CNO']).toBe(CNO_A);
    expect((r.payload as EnvelopeCno).evidence.areas).toHaveLength(1);
    expect(((r.payload as EnvelopeCno).canonical as Record<string, unknown>).cno).toBe(CNO_A);
  });

  it('43 · sem data oficial o adapter NÃO inventa hoje: não produz sinal', () => {
    const semData = comAreas(['Obra Nova'], { inicio: '', registro: '', dataSituacao: '' });
    expect(dataEventoCno(semData)).toBeUndefined();
    expect(payloadCno(semData).origemDataEvento).toBe(SEM_EVENTO_DATADO);
    const r = adapterCNO.normalizar(envelopeCno(obsCom(['Obra Nova'], { inicio: '', registro: '', dataSituacao: '' })))!;
    expect(r.sinais).toEqual([]);
    const hoje = new Date().toISOString().slice(0, 10);
    expect(JSON.stringify(r.sinais)).not.toContain(hoje);
    // e a precedencia declarada e respeitada quando ha data
    expect([...ORIGENS_DATA_EVENTO_CNO]).toEqual(['dataInicio', 'dataRegistro', 'dataSituacao']);
    expect(dataEventoCno(comAreas(['Obra Nova'])!)!.origem).toBe('dataInicio');
    expect(dataEventoCno(comAreas(['Obra Nova'], { inicio: '' }))!.origem).toBe('dataRegistro');
    expect(dataEventoCno(comAreas(['Obra Nova'], { inicio: '', registro: '' }))!.origem).toBe('dataSituacao');
    expect(adapterCNO.normalizar(envelopeCno(obsCom(['Obra Nova'])))!.sinais?.[0].eventoEm).toBe('1992-02-20');
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('LE-3A · intake do LE-1', () => {
  const FONTE = 'FONTE-CNO';
  const EM = '2026-09-23T10:00:00.000Z';
  const pedido = (o: CnoObservacao) => pedidoIntakeCno(o, FONTE, EM);

  it('44 · o pedido usa a fonte informada e a evidência canônica', () => {
    const p = pedido(obsCom(['Obra Nova']));
    expect(p.fonteId).toBe(FONTE);
    expect(p.recebidoEm).toBe(EM);
    expect((p.payload as EnvelopeCno).schema).toBe(SCHEMA_CNO);
    expect(((p.payload as EnvelopeCno).canonical as Record<string, unknown>).fonte).toBe('CNO');
  });

  it('45 · o tipo do registro é `projeto`: uma obra é um projeto, não uma empresa', () => {
    expect(pedido(obsCom(['Obra Nova'])).tipo).toBe('projeto');
  });

  it('46 · externoId do pedido é o CNO', () => {
    expect(pedido(obsCom(['Obra Nova'])).externoId).toBe(CNO_A);
  });

  it('47 · o fingerprint é determinístico para a mesma observação', () => {
    const a = envelopeCno(obsCom(['Obra Nova']));
    const b = envelopeCno(obsCom(['Obra Nova']));
    expect(payloadFingerprint(a)).toBe(payloadFingerprint(b));
    const v1 = validarIntake(pedido(obsCom(['Obra Nova'])));
    expect(v1.ok).toBe(true);
    if (v1.ok) expect(v1.payloadFingerprint).toBe(payloadFingerprint(a));
  });

  it('48 · repetição exata do mesmo CNO com o mesmo payload é IDEMPOTENT_NOOP', () => {
    const p = pedido(obsCom(['Obra Nova']));
    const v = validarIntake(p);
    if (!v.ok) throw new Error('intake inválido');
    expect(classificarIntake(v, []).resultado).toBe('NOVO_REGISTRO');
    const existente = discoveryRecordDe(registroDeIntake(v, p, 'SR-1'))!;
    expect(classificarIntake(v, [existente]).resultado).toBe('IDEMPOTENT_NOOP');
  });

  it('49 · mesmo CNO com payload diferente é NOVA_OBSERVACAO — nunca sobrescreve a anterior', () => {
    const p1 = pedido(obsCom(['Obra Nova']));
    const v1 = validarIntake(p1);
    if (!v1.ok) throw new Error('intake inválido');
    const existente = discoveryRecordDe(registroDeIntake(v1, p1, 'SR-1'))!;

    const p2 = pedido(obsCom(['Obra Nova'], { situacao: '15', dataSituacao: '2026-09-01' }));
    const v2 = validarIntake(p2);
    if (!v2.ok) throw new Error('intake inválido');
    expect(v2.identidade.externoId).toBe(v1.identidade.externoId); // mesmo objeto externo
    expect(v2.payloadFingerprint).not.toBe(v1.payloadFingerprint); // outra observacao
    expect(classificarIntake(v2, [existente]).resultado).toBe('NOVA_OBSERVACAO');
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('LE-3A · fronteiras', () => {
  const fonte = readFileSync('src/core/radar/cnoDadosAbertos.ts', 'utf8');
  const semComentario = fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('50 · o core não faz rede', () => {
    for (const proibido of ['fetch(', 'XMLHttpRequest', 'axios', 'http://', 'node:http', 'undici']) {
      expect(semComentario).not.toContain(proibido);
    }
  });

  it('50b · o core não faz I/O de arquivo nem lê ambiente', () => {
    for (const proibido of ['node:fs', "from 'fs'", 'readFileSync', 'process.env', 'import.meta.env']) {
      expect(semComentario).not.toContain(proibido);
    }
  });

  it('51 · o core não conhece o store nem React', () => {
    for (const proibido of ['data/store', 'actions.', "from 'react'", 'useState', 'useEffect']) {
      expect(semComentario).not.toContain(proibido);
    }
  });

  it('52 · o core não conhece Supabase nem Netlify', () => {
    for (const proibido of ['supabase', 'Supabase', 'netlify', 'service_role', 'SERVICE_ROLE']) {
      expect(semComentario).not.toContain(proibido);
    }
    // e importa só de dentro do core do Radar
    const imports = [...fonte.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    expect(imports.every((i) => i.startsWith('./'))).toBe(true);
  });

  it('53 · zero score, peso, fit ou prioridade', () => {
    for (const proibido of ['score', 'Score', 'fitScore', 'priorityScore', 'decisionFit', 'peso']) {
      expect(semComentario).not.toContain(proibido);
    }
  });

  it('54 · zero Commercial Queue, cadência ou política comercial de seleção', () => {
    for (const proibido of ['CommercialQueue', 'commercialQueue', 'cadencia', 'Cadencia', 'playbook']) {
      expect(semComentario).not.toContain(proibido);
    }
    // e nenhum filtro geografico ou de porte embutido
    for (const proibido of ['GO', 'Goiânia', 'Goiania', 'areaMinima', 'ticket']) {
      expect(semComentario).not.toContain(`'${proibido}'`);
    }
  });

  it('55-58 · zero oportunidade, tarefa, atividade e comunicação', () => {
    for (const proibido of ['oportunidade', 'Oportunidade', 'tarefa', 'Tarefa', 'atividade', 'Atividade', 'comunicac', 'Comunicac']) {
      expect(semComentario).not.toContain(proibido);
    }
  });

  it('58b · o gate não persiste: o core só produz observação e pedido, nunca RegistroFonte gravado', () => {
    for (const proibido of ['persistir', 'gravar', 'insert', 'INSERT', 'migration', 'RegistroFonte']) {
      expect(semComentario).not.toContain(proibido);
    }
    // a fonte oficial e o modo estao congelados e sao fail-closed
    expect(MODO_FONTE_CNO).toBe('SNAPSHOT');
    expect(HOST_OFICIAL_CNO).toBe('arquivos.receitafederal.gov.br');
    expect(semComentario).not.toContain('e-cac');
    expect(semComentario).not.toContain('gov.br/login');
  });
});

// ---------------------------------------------------------------------------------------------------------
// LE-3A1 — a evidência da fonte vive ao lado da projeção canônica, nunca no lugar dela.
//
// A primeira versão do LE-3A mandava só `payloadCno(obs)` para o intake. Isso perdia a origem: o "null"
// literal sumia, o NI com pontuação sumia, e coluna que a EIFF ainda não usa sumia. Normalização é uma
// LEITURA do dado, não o dado.
describe('LE-3A1 · evidência bruta separada da canônica', () => {
  const evid = (o: CnoObservacao) => o.evidence.obra;

  it('1 · o valor bruto de cada célula é preservado com o nome real da coluna', () => {
    const o = obsCom(['Obra Nova']);
    expect(evid(o)['CNO']).toBe(CNO_A);
    expect(evid(o)['Nome']).toBe('Galpão Alfa');
    expect(evid(o)['Nome empresarial']).toBe('Construtora Fictícia Alfa Ltda');
    expect(evid(o)['Situação']).toBe('02');                 // código original, não "ATIVA"
    expect(evid(o)['Data de início']).toBe('1992-02-20');    // data como texto
    expect(evid(o)['Área total']).toBe('412.00');            // texto, não número 412
    expect(evid(o)['Caixa Postal']).toBe('');                // string vazia preservada como tal
    expect(evid(o)['Qualificação do responsavel']).toBe('0053');
  });

  it('2 · o literal "null" continua na evidência', () => {
    const o = obsCom(['Obra Nova'], { nome: 'null' });
    expect(evid(o)['Nome']).toBe('null');
  });

  it('3 · e o canônico não o propaga', () => {
    const o = obsCom(['Obra Nova'], { nome: 'null' });
    expect(o.canonical.nomeObra).toBeUndefined();
    // a separação perfeita: os dois coexistem sem se contaminar
    expect(evid(o)['Nome']).toBe('null');
  });

  it('4 · o NI é preservado exatamente como veio, com pontuação e tudo', () => {
    const o = obsCom(['Obra Nova'], { ni: '"11.222.333/0001-81"' });
    expect(evid(o)['NI do responsável']).toBe('11.222.333/0001-81');
  });

  it('5 · e o canônico guarda o CNPJ normalizado — ambos coexistem', () => {
    const o = obsCom(['Obra Nova'], { ni: '"11.222.333/0001-81"' });
    expect(o.canonical.cnpjResponsavel).toBe(CNPJ);
    expect(evid(o)['NI do responsável']).not.toBe(o.canonical.cnpjResponsavel);
  });

  it('6 · coluna que a EIFF ainda não projeta é preservada, e o canônico não muda', () => {
    const cabFuturo = CAB_OBRA + ',"Campo futuro"';
    const o = obsCom(['Obra Nova'], {}, cabFuturo);
    // a linha da fixture nao tem a celula extra: a coluna existe e vem vazia, sem quebrar nada
    expect(Object.keys(evid(o))).toContain('Campo futuro');
    expect(o.canonical).toEqual(obsCom(['Obra Nova']).canonical);
    // e com valor de verdade, o valor chega intacto
    const comValor = linhaComoObjeto(cabecalhoCsvCno(cabFuturo), camposCsvCno(linhaObra() + ',"ABC"'));
    expect(comValor['Campo futuro']).toBe('ABC');
    // célula além do cabeçalho também é evidência, não lixo descartado
    expect(linhaComoObjeto(['a', 'b'], ['1', '2', '3'])).toEqual({ a: '1', b: '2', '#2': '3' });
  });

  it('7 · a linha bruta da área é preservada ao lado da canônica', () => {
    const o = obsCom(['Demolição']);
    expect(o.evidence.areas).toHaveLength(1);
    expect(o.evidence.areas[0]['Categoria']).toBe('Demolição');
    expect(o.evidence.areas[0]['Tipo de obra']).toBe('Alvenaria');
    expect(o.evidence.areas[0]['Metragem']).toBe('412.00');
    expect(o.evidence.areas[0]['Tipo de Área Complementar']).toBe('');
    expect(o.canonical.areas[0].metragem).toBe(412);
  });

  it('8 · a linha bruta do CNAE é preservada', () => {
    const cab = cabecalhoCsvCno(CAB_CNAES);
    const o = juntarObservacoesCno({
      obras: [lerObraCno(cabecalhoCsvCno(CAB_OBRA), ixObra, camposCsvCno(linhaObra()))!],
      cnaes: [lerCnaeCno(cab, ixCnaes, camposCsvCno(`${CNO_A},4120400,2022-05-17`))!],
    }).observacoes[0];
    expect(o.evidence.cnaes[0]).toEqual({ CNO: CNO_A, CNAE: '4120400', 'Data de registro': '2022-05-17' });
    expect(o.canonical.cnaes[0].cnae).toBe('4120400');
  });

  it('9 · a linha bruta do vínculo é preservada, inclusive o NI vazio', () => {
    const cab = cabecalhoCsvCno(CAB_VINCULOS);
    const o = juntarObservacoesCno({
      obras: [lerObraCno(cabecalhoCsvCno(CAB_OBRA), ixObra, camposCsvCno(linhaObra()))!],
      vinculos: [lerVinculoCno(cab, ixVinculos, camposCsvCno(`${CNO_A},1988-08-01,,2022-05-26,0053,`))!],
    }).observacoes[0];
    expect(o.evidence.vinculos[0]['Data de fim']).toBe('');
    expect(o.evidence.vinculos[0]['NI do responsável']).toBe('');
    expect(o.evidence.vinculos[0]['Qualificação do contribuinte']).toBe('0053');
    expect(o.canonical.vinculos[0].fim).toBeUndefined();
    expect(o.canonical.vinculos[0].cnpjResponsavel).toBeUndefined();
  });

  it('10 · a ordem é determinística nos DOIS lados, e a linha bruta i continua sendo a origem da canônica i', () => {
    const cats = ['Reforma', 'Obra Nova', 'Acréscimo'];
    const direta = obsCom(cats);
    const invertida = obsCom([...cats].reverse());
    expect(invertida.evidence.areas).toEqual(direta.evidence.areas);
    expect(invertida.canonical.areas).toEqual(direta.canonical.areas);
    // o pareamento nao se perde na ordenacao
    direta.evidence.areas.forEach((bruta, i) => expect(bruta['Categoria']).toBe(direta.canonical.areas[i].categoria));
  });

  it('11 · o fingerprint é estável para a mesma observação, inclusive com ordem de propriedades diferente', () => {
    const a = envelopeCno(obsCom(['Obra Nova']));
    const b = envelopeCno(obsCom(['Obra Nova']));
    expect(payloadFingerprint(a)).toBe(payloadFingerprint(b));
    // `jsonCanonico` ordena as chaves: montar o mesmo objeto ao contrario dá a mesma impressão
    const espelho = { canonical: a.canonical, evidence: a.evidence, schema: a.schema };
    expect(payloadFingerprint(espelho)).toBe(payloadFingerprint(a));
  });

  it('12 · mudar uma célula da fonte muda o fingerprint', () => {
    const base = payloadFingerprint(envelopeCno(obsCom(['Obra Nova'])));
    expect(payloadFingerprint(envelopeCno(obsCom(['Obra Nova'], { situacao: '15' })))).not.toBe(base);
    // e mesmo uma mudanca que o canonico DESCARTA muda a impressao, porque a evidencia mudou de verdade
    expect(payloadFingerprint(envelopeCno(obsCom(['Obra Nova'], { nome: 'null' })))).not.toBe(base);
  });

  it('13-14 · ETag e Last-Modified do snapshot não entram no envelope e não podem mover o fingerprint', () => {
    const e = envelopeCno(obsCom(['Obra Nova']));
    const texto = JSON.stringify(e);
    for (const proibido of ['etag', 'ETag', 'lastModified', 'Last-Modified', 'last_modified', 'baixadoEm', 'downloadedAt', 'snapshot', 'offLocal', 'zip']) {
      expect(texto).not.toContain(proibido);
    }
    expect(Object.keys(e).sort()).toEqual(['canonical', 'evidence', 'schema']);
  });

  it('15 · o instante em que recebemos NÃO integra o payload: dois recebimentos dão a mesma impressão', () => {
    const o = obsCom(['Obra Nova']);
    const p1 = pedidoIntakeCno(o, 'FONTE-CNO', '2026-09-23T10:00:00.000Z');
    const p2 = pedidoIntakeCno(o, 'FONTE-CNO', '2026-11-30T23:59:59.999Z');
    expect(p1.recebidoEm).not.toBe(p2.recebidoEm);
    expect(payloadFingerprint(p1.payload)).toBe(payloadFingerprint(p2.payload));
    const v1 = validarIntake(p1);
    const v2 = validarIntake(p2);
    if (!v1.ok || !v2.ok) throw new Error('intake inválido');
    expect(v2.payloadFingerprint).toBe(v1.payloadFingerprint);
    // logo, reler o mesmo snapshot amanhã é IDEMPOTENT_NOOP, não observação nova
    expect(classificarIntake(v2, [discoveryRecordDe(registroDeIntake(v1, p1, 'SR-1'))!]).resultado).toBe('IDEMPOTENT_NOOP');
  });

  it('16 · o adapter normaliza a partir de `canonical`, sob guarda de versão', () => {
    const e = envelopeCno(obsCom(['Obra Nova']));
    expect(e.schema).toBe(SCHEMA_CNO);
    const r = adapterCNO.normalizar(e)!;
    expect(r.empresa?.razaoSocial).toBe('Construtora Fictícia Alfa Ltda');
    expect(r.projeto?.nome).toBe('Galpão Alfa');
    // sem schema reconhecido nao ha heuristica: o envelope nao e lido como payload plano
    expect(adapterCNO.normalizar({ ...e, schema: 'OUTRO' })).toBeUndefined();
    // e o formato plano antigo continua funcionando
    expect(adapterCNO.normalizar(payloadCno(obsCom(['Obra Nova']).canonical))?.empresa?.razaoSocial)
      .toBe('Construtora Fictícia Alfa Ltda');
  });

  it('17 · a linhagem recebe o ENVELOPE completo, não só o canônico', () => {
    const e = envelopeCno(obsCom(['Obra Nova']));
    const r = adapterCNO.normalizar(e)!;
    expect(r.payload).toBe(e);
    // é este objeto que o LE2-B repassa ao sinal (`payload: bruto.payload`), então a evidência chega lá
    expect((r.payload as EnvelopeCno).evidence.obra['Nome']).toBe('Galpão Alfa');
    expect((r.payload as EnvelopeCno).evidence.obra['NI do responsável']).toBe(CNPJ);
  });

  it('18 · nenhum caminho entrega `payloadCno(obs)` sozinho ao intake', () => {
    const o = obsCom(['Obra Nova']);
    const p = pedidoIntakeCno(o, 'FONTE-CNO', '2026-09-23T10:00:00.000Z');
    const envelope = p.payload as EnvelopeCno;
    expect(envelope.schema).toBe(SCHEMA_CNO);
    expect(envelope.evidence).toBeDefined();
    expect(envelope.canonical).toBeDefined();
    expect(payloadFingerprint(p.payload)).not.toBe(payloadFingerprint(payloadCno(o.canonical)));

    // guarda estrutural: a assinatura exige a observacao COMPLETA, e o envelope e montado em um lugar so
    const fonte = readFileSync('src/core/radar/cnoDadosAbertos.ts', 'utf8');
    const semComentario = fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(semComentario).toContain('payload: envelopeCno(o)');
    expect(semComentario).not.toContain('payload: payloadCno(');
    expect(semComentario).toMatch(/pedidoIntakeCno\(o: CnoObservacao,/);
  });
});
