// Gera supabase/migrations/0018_smartfit_proposta.sql a partir da proposta comercial
// PROPOSTA_BTS_SF_CESAR LATTES_R02.pdf (Modo, orcamento n. 328, emissao 05/05/2026): 81 itens em 14 etapas,
// total R$ 4.131.354,17. O PDF e vetorial sem texto; os itens foram transcritos das paginas renderizadas.
// Cada item guarda o preco unitario de venda (total do PDF / quantidade, 6 casas) e o vinculo com o servico do cronograma (SFCL-xx),
// cujo budget_base e exatamente o total da etapa. Custos (composicoes) ficam para vincular depois.
// Uso: node scripts/proposta-smartfit.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OBRA = 'OB-SF-CL-01';
const CODIGO = 'ORC-328';

// etapa da proposta -> [servico do cronograma, total da etapa no PDF]
const ETAPAS = {
  'Etapa 1: Administrativo de obras': ['SFCL-02', 72776.94],
  'Etapa 2: Serviços preliminares': ['SFCL-03', 63264.55],
  'Etapa 3: Movimentação de terra': ['SFCL-04', 240473.61],
  'Etapa 4: Fundação e arrimo': ['SFCL-05', 557042.70],
  'Etapa 5: Impermeabilização': ['SFCL-05', 10368.90], // sem etapa propria no cronograma: acompanha fundacao/baldrames
  'Etapa 6: Instalações gerais': ['SFCL-08', 350949.89],
  'Etapa 7: Piso (térreo)': ['SFCL-12', 266693.32],
  'Etapa 8: Piso térreo - steel deck': ['SFCL-09', 253057.55],
  'Etapa 10: Estrutura metálica': ['SFCL-06', 1456563.44],
  'Etapa 11: Vedação externa': ['SFCL-10', 281512.68],
  'Etapa 12: Cobertura': ['SFCL-07', 276598.74],
  'Etapa 13: Pintura': ['SFCL-13', 244713.48],
  'Etapa 14: Transporte': ['SFCL-11', 47016.20],
  'Etapa 15: Serviços diversos': ['SFCL-17', 10322.17],
};

// [etapa, item, descricao, quantidade, unidade, preco unitario (PDF), preco item (PDF)]
const ITENS = [
  ['Etapa 1: Administrativo de obras', '1.1', 'Engenheiro civil de obra júnior (horista)', 192, 'h', 121.99, 23421.25],
  ['Etapa 1: Administrativo de obras', '1.2', 'Encarregado geral de obras (mensalista)', 4, 'mês', 7494.86, 29979.45],
  ['Etapa 1: Administrativo de obras', '1.4', 'Técnico em segurança do trabalho (horista)', 384, 'h', 32.66, 12542.40],
  ['Etapa 1: Administrativo de obras', '1.5', 'Topógrafo com encargos complementares', 1, 'mês', 6833.84, 6833.84],
  ['Etapa 2: Serviços preliminares', '2.1', 'Locação de container 2,30 x 6,00 m, alt. 2,50 m, com 1 sanitário, para escritório, completo, sem divisórias internas (não inclui mobilização/desmobilização)', 4, 'mês', 915.90, 3663.60],
  ['Etapa 2: Serviços preliminares', '2.2', 'Locação de container 2,30 x 6,00 m, alt. 2,50 m, para sanitário, com 4 bacias, 8 chuveiros, 1 lavatório e 1 mictório (não inclui mobilização/desmobilização)', 4, 'mês', 1068.55, 4274.20],
  ['Etapa 2: Serviços preliminares', '2.3', 'Mobilização e desmobilização', 2, 'un', 1404.38, 2808.76],
  ['Etapa 2: Serviços preliminares', '2.4', 'Ligação provisória de luz e força', 1, 'un', 3358.30, 3358.30],
  ['Etapa 2: Serviços preliminares', '2.5', 'Ligação provisória de água, incluso retirada do esgoto sanitário', 1, 'un', 976.96, 976.96],
  ['Etapa 2: Serviços preliminares', '2.6', 'Equipamento de proteção individual (EPI) e equipamento de proteção coletiva (EPC)', 2, 'mês', 1587.56, 3175.12],
  ['Etapa 2: Serviços preliminares', '2.7', 'Locação de equipamentos / ferramentas / caçamba de entulho', 4, 'mês', 1831.80, 7327.20],
  ['Etapa 2: Serviços preliminares', '2.8', 'Material de limpeza', 4, 'mês', 146.54, 586.18],
  ['Etapa 2: Serviços preliminares', '2.10', 'Placa de obra (para construção civil) em chapa galvanizada n. 22, adesivada, de 2,4 x 1,2 m (sem postes para fixação)', 4.32, 'm²', 341.94, 1477.16],
  ['Etapa 2: Serviços preliminares', '2.11', 'Transporte de entulho em caçamba estacionária, incluso a carga manual (entulho estimado em 5% da área total do terreno)', 72.38, 'm³', 113.01, 8179.94],
  ['Etapa 2: Serviços preliminares', '2.12', 'Locação convencional de obra, utilizando gabarito de tábuas corridas pontaletadas a cada 2,00 m, 2 utilizações (af_03/2024)', 167.94, 'm', 78.72, 13219.99],
  ['Etapa 2: Serviços preliminares', '2.13', 'Limpeza mecanizada de camada vegetal, vegetação e pequenas árvores (diâmetro de tronco menor que 0,20 m), com trator de esteiras', 1447.65, 'm²', 9.82, 14217.14],
  ['Etapa 3: Movimentação de terra', '3.1', 'Aterro mecanizado de vala com minicarregadeira, com terra para aterro', 1663.29, 'm³', 144.58, 240473.61],
  ['Etapa 4: Fundação e arrimo', '4.1.1', 'Estrutura principal: estaca escavada mecanicamente, sem fluido estabilizante, com 60 cm de diâmetro, concreto lançado por bomba lança (exclusive bombeamento, mobilização e desmobilização) (af_01/2020)', 416, 'm', 369.85, 153858.69],
  ['Etapa 4: Fundação e arrimo', '4.1.2', 'Estrutura principal: fabricação, montagem e desmontagem de fôrma para bloco de coroamento, em madeira serrada, e=25 mm, 4 utilizações (af_01/2024)', 225.5, 'm²', 109.41, 24671.79],
  ['Etapa 4: Fundação e arrimo', '4.1.3', 'Estrutura principal: armação de estruturas diversas de concreto armado, exceto vigas, pilares, lajes e fundações, aço CA-60 de 5,0 mm, montagem (af_06/2022)', 625.95, 'kg', 20.11, 12589.84],
  ['Etapa 4: Fundação e arrimo', '4.1.4', 'Estrutura principal: armação de estruturas diversas de concreto armado, exceto vigas, pilares, lajes e fundações, aço CA-50 de 10,0 mm, montagem (af_06/2022)', 2108, 'kg', 13.23, 27879.56],
  ['Etapa 4: Fundação e arrimo', '4.1.6', 'Estrutura principal: armação de bloco utilizando aço CA-50 de 6,3 mm, montagem (af_01/2024)', 437.94, 'kg', 21.10, 9241.56],
  ['Etapa 4: Fundação e arrimo', '4.1.8', 'Estrutura principal: lançamento com uso de bomba, adensamento e acabamento de concreto em estruturas (af_02/2022)', 157.7, 'm³', 55.75, 8791.42],
  ['Etapa 4: Fundação e arrimo', '4.6.2', 'Baldrame/arrimo: estaca escavada mecanicamente, sem fluido estabilizante, com 60 cm de diâmetro, concreto lançado por bomba lança (af_01/2020)', 180, 'm', 369.85, 66573.47],
  ['Etapa 4: Fundação e arrimo', '4.6.3', 'Baldrame/arrimo: fôrma para bloco de coroamento, madeira serrada, e=25 mm, 4 utilizações (af_01/2024)', 71.82, 'm²', 109.41, 7857.63],
  ['Etapa 4: Fundação e arrimo', '4.6.4', 'Baldrame/arrimo: fôrma para viga baldrame, madeira serrada, e=25 mm, 4 utilizações (af_01/2024)', 91.2, 'm²', 95.07, 8670.42],
  ['Etapa 4: Fundação e arrimo', '4.6.5', 'Baldrame/arrimo: fabricação de fôrma para pilares e estruturas similares, madeira serrada, e=25 mm (af_09/2020)', 118.2, 'm²', 200.85, 23740.56],
  ['Etapa 4: Fundação e arrimo', '4.6.6', 'Baldrame/arrimo: fabricação de fôrma para lajes, madeira serrada, e=25 mm (af_09/2020)', 48.9, 'm²', 97.17, 4751.66],
  ['Etapa 4: Fundação e arrimo', '4.6.7', 'Baldrame/arrimo: concretagem de bloco de coroamento, fck 30 MPa, com bomba, lançamento, adensamento e acabamento (af_01/2024)', 18.28, 'm³', 1050.16, 19196.90],
  ['Etapa 4: Fundação e arrimo', '4.6.8', 'Baldrame/arrimo: concretagem de viga baldrame, fck 30 MPa, com bomba, lançamento, adensamento e acabamento (af_01/2024)', 28.4, 'm³', 1050.16, 29824.51],
  ['Etapa 4: Fundação e arrimo', '4.6.9', 'Baldrame/arrimo: concretagem de pilares, fck 25 MPa, com bomba, lançamento, adensamento e acabamento (af_02/2022)', 12.96, 'm³', 945.45, 12253.07],
  ['Etapa 4: Fundação e arrimo', '4.6.10', 'Baldrame/arrimo: concretagem de vigas e lajes, fck 25 MPa, lajes pré-moldadas, com bomba (af_02/2022)', 3.7, 'm³', 974.93, 3607.25],
  ['Etapa 4: Fundação e arrimo', '4.6.11', 'Baldrame/arrimo: concretagem de escadas, fck 25 MPa, com bomba, lançamento, adensamento e acabamento (af_02/2022)', 10.73, 'm³', 1040.29, 11162.33],
  ['Etapa 4: Fundação e arrimo', '4.6.12', 'Baldrame/arrimo: armação de bloco utilizando aço CA-50 de 6,3 mm, montagem (af_01/2024)', 272.94, 'kg', 21.10, 5759.67],
  ['Etapa 4: Fundação e arrimo', '4.6.13', 'Baldrame/arrimo: armação de escada, estrutura convencional de concreto armado, aço CA-50 de 6,3 mm, montagem (af_11/2020)', 23.52, 'kg', 24.24, 570.14],
  ['Etapa 4: Fundação e arrimo', '4.6.14', 'Baldrame/arrimo: armação de laje, estrutura convencional de concreto armado, aço CA-50 de 6,3 mm, montagem (af_06/2022)', 147, 'kg', 14.07, 2068.03],
  ['Etapa 4: Fundação e arrimo', '4.6.15', 'Baldrame/arrimo: armação de pilar ou viga embutida em alvenaria de vedação, aço CA-50 de 10,0 mm, montagem (af_06/2022)', 293.2, 'kg', 14.30, 4192.83],
  ['Etapa 4: Fundação e arrimo', '4.6.16', 'Baldrame/arrimo: armação de pilar ou viga, estrutura convencional de concreto armado, aço CA-60 de 5,0 mm, montagem (af_06/2022)', 115.87, 'kg', 16.34, 1893.28],
  ['Etapa 4: Fundação e arrimo', '4.6.17', 'Baldrame/arrimo: armação de escada, estrutura convencional de concreto armado, aço CA-50 de 8,0 mm, montagem (af_11/2020)', 194.34, 'kg', 18.65, 3624.00],
  ['Etapa 4: Fundação e arrimo', '4.6.18', 'Baldrame/arrimo: armação de laje, estrutura convencional de concreto armado, aço CA-50 de 8,0 mm, montagem (af_06/2022)', 66.36, 'kg', 12.83, 851.72],
  ['Etapa 4: Fundação e arrimo', '4.6.19', 'Baldrame/arrimo: armação de pilar ou viga, estrutura convencional de concreto armado, aço CA-50 de 8,0 mm, montagem (af_06/2022)', 568.8, 'kg', 13.52, 7689.43],
  ['Etapa 4: Fundação e arrimo', '4.6.20', 'Baldrame/arrimo: armação de bloco utilizando aço CA-50 de 10 mm, montagem (af_01/2024)', 799.48, 'kg', 15.90, 12711.81],
  ['Etapa 4: Fundação e arrimo', '4.6.21', 'Baldrame/arrimo: armação de laje, estrutura convencional de concreto armado, aço CA-50 de 10,0 mm, montagem (af_06/2022)', 214.72, 'kg', 11.21, 2407.10],
  ['Etapa 4: Fundação e arrimo', '4.6.22', 'Baldrame/arrimo: armação de pilar ou viga, estrutura convencional de concreto armado, aço CA-50 de 10,0 mm, montagem (af_06/2022)', 1088.39, 'kg', 11.83, 12879.36],
  ['Etapa 4: Fundação e arrimo', '4.6.23', 'Baldrame/arrimo: armação de pilar ou viga, estrutura convencional de concreto armado, aço CA-50 de 12,5 mm, montagem (af_06/2022)', 231.12, 'kg', 9.82, 2269.24],
  ['Etapa 4: Fundação e arrimo', '4.6.24', 'Baldrame/arrimo: armação de estruturas diversas de concreto armado, exceto vigas, pilares, lajes e fundações, aço CA-60 de 5,0 mm, montagem (af_06/2022)', 980, 'kg', 20.11, 19710.90],
  ['Etapa 4: Fundação e arrimo', '4.6.25', 'Baldrame/arrimo: alvenaria de blocos de concreto estrutural 14x19x29 cm (espessura 14 cm), fbk 14 MPa, utilizando colher de pedreiro (af_10/2022)', 168, 'm²', 212.35, 35675.55],
  ['Etapa 4: Fundação e arrimo', '4.6.26', 'Baldrame/arrimo: cinta com bloco canaleta, espessura de 15 cm', 240, 'm', 83.62, 20068.98],
  ['Etapa 5: Impermeabilização', '5.1', 'Impermeabilização de superfície com emulsão asfáltica, 2 demãos (af_09/2023)', 216, 'm²', 45.11, 9744.30],
  ['Etapa 5: Impermeabilização', '5.2', 'Aditivo impermeabilizante de pega normal para argamassas e concretos sem armação, líquido e isento de cloretos', 72, 'l', 8.68, 624.60],
  ['Etapa 6: Instalações gerais', '6.1.1.1', 'Elétrica (estimativa): transformador trifásico de 225 kVA com suporte para instalação', 1, 'un', 76519.32, 76519.32],
  ['Etapa 6: Instalações gerais', '6.1.1.2', 'Elétrica (estimativa): assentamento de poste de concreto com comprimento nominal de 10 m, carga nominal de 1000 daN, engastamento base concretada com 1 m de concreto e 0,6 m de solo (não inclui fornecimento) (af_11/2019)', 1, 'un', 2135.66, 2135.66],
  ['Etapa 6: Instalações gerais', '6.1.1.3', 'Elétrica (estimativa): instalações elétricas', 1, 'vb', 82600.00, 82600.00],
  ['Etapa 6: Instalações gerais', '6.1.2.1', 'Projeto e execução de SPDA: estimativa de projeto, material e execução', 1, 'vb', 27140.00, 27140.00],
  ['Etapa 6: Instalações gerais', '6.2.3', 'Instalações hidrossanitárias: água fria, esgoto, pluvial e drenagem', 1562.27, 'm²', 42.66, 66641.92],
  ['Etapa 6: Instalações gerais', '6.2.4', 'Dreno profundo (seção 0,50 x 1,50 m), cego, enchimento de brita, envolvido com manta geotêxtil (af_07/2021)', 70, 'm', 207.04, 14493.00],
  ['Etapa 6: Instalações gerais', '6.3.1', 'Prevenção e combate a incêndio: projeto e execução', 1, 'vb', 70800.00, 70800.00],
  ['Etapa 6: Instalações gerais', '6.4.1', 'Instalação de gás: instalação básica (estimativa)', 1, 'vb', 10620.00, 10620.00],
  ['Etapa 7: Piso (térreo)', '7.11', 'Execução de piso industrial de concreto armado, fck 20 MPa, espessura de 14,0 cm (af_04/2022)', 1447.65, 'm²', 184.22, 266693.32],
  ['Etapa 8: Piso térreo - steel deck', '8.1', 'Concreto usinado bombeável, classe de resistência C30, brita 0 e 1, slump 100 ± 20 mm, com bombeamento (disponibilização de bomba), sem o lançamento (NBR 8953)', 92.63, 'm³', 851.05, 78832.83],
  ['Etapa 8: Piso térreo - steel deck', '8.2', 'Lançamento com uso de bomba, adensamento e acabamento de concreto em estruturas (af_02/2022)', 92.63, 'm³', 57.06, 5285.70],
  ['Etapa 8: Piso térreo - steel deck', '8.3', 'Fabricação, montagem e desmontagem de fôrma para radier, piso de concreto ou laje sobre solo, madeira serrada, 4 utilizações (af_09/2021)', 32.34, 'm²', 168.39, 5445.65],
  ['Etapa 8: Piso térreo - steel deck', '8.4', 'Chapa em aço galvanizado para steel deck, com nervuras trapezoidais, largura útil de 915 mm e espessura de 0,80 mm', 823.38, 'm²', 125.21, 103097.28],
  ['Etapa 8: Piso térreo - steel deck', '8.5', 'Armação para execução de laje, com uso de tela Q-92 (ref. SINAPI)', 1218.6, 'kg', 17.81, 21701.09],
  ['Etapa 8: Piso térreo - steel deck', '8.6', 'Eletrodo revestido AWS E7018, diâmetro 4,00 mm', 28, 'kg', 31.25, 875.00],
  ['Etapa 8: Piso térreo - steel deck', '8.7', 'Pino stud welding 3/4" x 5.3/8" (19 x 110 mm)', 2480, 'un', 15.25, 37820.00],
  ['Etapa 10: Estrutura metálica', '10.1', 'Parafusos, porcas e arruelas', 6911.5, 'un', 2.50, 17278.75],
  ['Etapa 10: Estrutura metálica', '10.2', 'Chumbador 3/4"', 276, 'un', 58.46, 16135.65],
  ['Etapa 10: Estrutura metálica', '10.3', 'Estrutura metálica "MODO" (fabricação e montagem)', 72323.1, 'kg', 18.96, 1371426.78],
  ['Etapa 10: Estrutura metálica', '10.4', 'Eletrodo revestido AWS E7018, diâmetro 4,00 mm', 1655.11, 'kg', 31.25, 51722.25],
  ['Etapa 11: Vedação externa', '11.1', 'Isopainel PIR AP 50 mm microfrisado/liso RAL 9003', 1042.87, 'm²', 248.13, 258761.13],
  ['Etapa 11: Vedação externa', '11.2', 'Fechamento com telha trapezoidal TP-40, montagem incluso pintura', 281.42, 'm²', 80.85, 22751.55],
  ['Etapa 12: Cobertura', '12.1', 'Telhamento com telha metálica isotelha e = 30 mm (PIR aço/filme), com até 2 águas, incluso içamento', 1520.03, 'm²', 150.31, 228477.74],
  ['Etapa 12: Cobertura', '12.2', 'Instalação de cumeeira metálica trapezoidal (largura útil 0,98 m), incluso material e instalação', 43, 'un', 94.68, 4071.44],
  ['Etapa 12: Cobertura', '12.3', 'Rufo externo/interno de chapa de aço galvanizado, corte de 80 cm, incluso içamento', 178.88, 'm', 132.47, 23670.55],
  ['Etapa 12: Cobertura', '12.4', 'Calha em chapa de aço galvanizado nº 24, desenvolvimento de 100 cm, incluso transporte vertical (kit calha + suporte + fixadores e PU) (af_07/2019)', 113.15, 'm', 180.11, 20379.01],
  ['Etapa 13: Pintura', '13.1', 'Pintura com tinta alquídica de acabamento (esmalte sintético acetinado) pulverizada sobre superfícies metálicas (exceto perfil), executada em obra, 2 demãos (af_01/2020)', 3420, 'm²', 67.11, 229524.75],
  ['Etapa 13: Pintura', '13.2', 'Pintura de demarcação de vaga com tinta epóxi, e = 10 cm, aplicação manual (af_05/2021)', 495, 'm', 8.47, 4195.13],
  ['Etapa 13: Pintura', '13.3', 'Aplicação manual de pintura com tinta texturizada acrílica em panos cegos de fachada (sem presença de vãos) de edifícios de múltiplos pavimentos, duas cores (af_03/2024)', 394.04, 'm²', 27.90, 10993.60],
  ['Etapa 14: Transporte', '14.1', 'Custo de transporte por carga: transporte dos materiais, estrutura metálica e demais materiais para o canteiro de obras', 7, 'un', 6716.60, 47016.20],
  ['Etapa 15: Serviços diversos', '15.1', 'Limpeza final de obra', 2231.82, 'm²', 4.63, 10322.17],
];


// Vinculo item -> composicao SINAPI (C) ou insumo SINAPI (I, embrulhado numa composicao propria INS-<codigo>).
// Escolhidos a partir do catalogo GO 07/2026 (scripts/importar-sinapi.mjs). Sem vinculo: itens sem equivalente no SINAPI
// (estrutura metalica MODO, isopainel PIR, pinos stud, chumbadores, parafusos, estimativas por verba, transporte, EPI, canteiro).
export const VINCULOS = {
  '1.1': 'C90777', '1.2': 'C93572', '1.4': 'C100309', '1.5': 'C94296',
  '2.1': 'I10775', '2.2': 'I10778', '2.10': 'I4813', '2.12': 'C99059', '2.13': 'C98525',
  '3.1': 'C104738',
  '4.1.1': 'C100900', '4.1.2': 'C96531', '4.1.3': 'C92915', '4.1.4': 'C92919', '4.1.6': 'C96544', '4.1.8': 'C103673',
  '4.6.2': 'C100900', '4.6.3': 'C96531', '4.6.4': 'C96533', '4.6.5': 'C92269', '4.6.6': 'C92271', '4.6.7': 'C96557', '4.6.8': 'C96557',
  '4.6.9': 'C103672', '4.6.10': 'C103674', '4.6.11': 'C103686', '4.6.12': 'C96544', '4.6.13': 'C95944', '4.6.14': 'C92769', '4.6.15': 'C104108',
  '4.6.16': 'C92759', '4.6.17': 'C95945', '4.6.18': 'C92770', '4.6.19': 'C92761', '4.6.20': 'C96546', '4.6.21': 'C92771', '4.6.22': 'C92762',
  '4.6.23': 'C92763', '4.6.24': 'C92915', '4.6.25': 'C89480', '4.6.26': 'C105033',
  '5.1': 'C98557', '5.2': 'I123',
  '6.1.1.1': 'C102107', '6.1.1.2': 'C100606', '6.2.4': 'C102679',
  '7.11': 'C103914',
  '8.1': 'I1525', '8.2': 'C103673', '8.3': 'C97086', '8.4': 'I43126', '8.5': 'C97088', '8.6': 'I10997',
  '10.4': 'I10997',
  '11.2': 'C94213', // fechamento em telha trapezoidal: proxy = telhamento com telha de aco 0,5 mm
  '12.1': 'C94216', '12.4': 'C94229',
  '13.1': 'C100757', '13.2': 'C102507', '13.3': 'C88426',
};

/** Gera 0020_smartfit_vinculos.sql: composicoes-embrulho para insumos diretos e composition_id nos itens do orcamento. */
export function gerarVinculos() {
  const q = (v) => `'${String(v).replace(/'/g, "''")}'`;
  const ORG = "(select id from organization where code = 'EIFF')";
  const insumosDiretos = [...new Set(Object.values(VINCULOS).filter((v) => v.startsWith('I')).map((v) => v.slice(1)))];
  let sql = `-- Vinculo dos itens do orcamento ${CODIGO} a composicoes/insumos do SINAPI (catalogo da migration 0019). Idempotente.
-- Insumos usados diretamente viram composicoes proprias INS-<codigo> com um unico item (coeficiente 1).
`;
  for (const cod of insumosDiretos) {
    sql += `insert into catalog_composition (organization_id, source, code, description, unit, group_name, notes, active)
select ${ORG}, 'Própria', ${q('INS-' + cod)}, 'Insumo SINAPI ' || i.code || ': ' || i.description, i.unit, 'Insumo direto', 'Composição-embrulho gerada para usar o insumo diretamente no orçamento.', true
from catalog_input i where i.organization_id = ${ORG} and i.source = 'SINAPI' and i.code = ${q(cod)}
on conflict (organization_id, source, code) do update set description = excluded.description, unit = excluded.unit;
delete from catalog_composition_item where composition_id = (select id from catalog_composition where organization_id = ${ORG} and source = 'Própria' and code = ${q('INS-' + cod)});
insert into catalog_composition_item (composition_id, item_order, input_id, coefficient)
select c.id, 1, i.id, 1 from catalog_composition c join catalog_input i on i.organization_id = c.organization_id and i.source = 'SINAPI' and i.code = ${q(cod)}
where c.organization_id = ${ORG} and c.source = 'Própria' and c.code = ${q('INS-' + cod)};
`;
  }
  for (const [item, v] of Object.entries(VINCULOS)) {
    const [source, code] = v.startsWith('I') ? ['Própria', 'INS-' + v.slice(1)] : ['SINAPI', v.slice(1)];
    sql += `update estimate_item set composition_id = (select id from catalog_composition where organization_id = ${ORG} and source = ${q(source)} and code = ${q(code)}) where code = ${q(item)} and estimate_id = (select id from estimate where organization_id = ${ORG} and code = ${q(CODIGO)});
`;
  }
  const out = path.join(root, 'supabase', 'migrations', '0020_smartfit_vinculos.sql');
  fs.writeFileSync(out, sql);
  console.log(`gerado ${path.relative(root, out)}: ${Object.keys(VINCULOS).length} vinculos, ${insumosDiretos.length} insumos diretos`);
}

export { ITENS, ETAPAS };
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { gerar(); gerarVinculos(); }

function gerar() {
const q = (v) => `'${String(v).replace(/'/g, "''")}'`;
const r2 = (v) => Math.round(v * 100) / 100;

// preco unitario efetivo = total do PDF / quantidade (4 casas), para que os totais por item e por etapa
// fechem com a proposta; o preco unitario impresso no PDF fica na descricao quando diverge em mais de 1 centavo
let sql = `-- Proposta comercial 328 R02 (Modo, 05/05/2026) da obra ${OBRA}: ${ITENS.length} itens com preco de venda
-- vinculados aos servicos do cronograma. Gerado por scripts/proposta-smartfit.mjs. Idempotente.
insert into estimate (organization_id, company_id, code, title, client_name, project_id, estimate_date, status, bdi, price_reference, notes)
select o.id, c.id, ${q(CODIGO)}, 'Proposta 328 R02 · Smart Fit César Lattes (BTS)', p.client_name, p.id, '2026-05-05', 'Contratado', 0,
  'Proposta Modo nº 328 R02 (preços de venda contratados)',
  'Itens transcritos do PDF PROPOSTA_BTS_SF_CESAR LATTES_R02. Total R$ 4.131.354,17. Custos por composição a vincular.'
from organization o
join company c on c.organization_id = o.id and c.code = o.code
join project p on p.organization_id = o.id and p.code = ${q(OBRA)}
where o.code = 'EIFF' and not exists (select 1 from estimate e where e.organization_id = o.id and e.code = ${q(CODIGO)});

delete from estimate_item where estimate_id in (select id from estimate where code = ${q(CODIGO)});
`;
const totais = {};
let total = 0;
ITENS.forEach(([etapa, item, desc, qtd, un, pu, pi], i) => {
  const [servico] = ETAPAS[etapa];
  const puEfetivo = Math.round((pi / qtd) * 1e6) / 1e6;
  const diverge = Math.abs(puEfetivo * qtd - pi) > 0.01;
  const nota = Math.abs(pu * qtd - pi) > 0.05 ? ` [PU proposta R$ ${pu.toFixed(2)}]` : '';
  totais[etapa] = (totais[etapa] ?? 0) + r2(puEfetivo * qtd);
  total += r2(puEfetivo * qtd);
  if (diverge) console.warn(`aviso: ${item} total ${pi} nao fecha com PU ${puEfetivo} x ${qtd}`);
  sql += `insert into estimate_item (estimate_id, item_order, stage, code, description, unit, quantity, sale_unit_price, service_id)
select e.id, ${i + 1}, ${q(etapa)}, ${q(item)}, ${q(desc + nota)}, ${q(un)}, ${qtd}, ${puEfetivo}, (select s.id from project_service s where s.project_id = e.project_id and s.code = ${q(servico)})
from estimate e where e.code = ${q(CODIGO)} and e.organization_id = (select id from organization where code = 'EIFF');\n`;
});

for (const [etapa, [, pdf]] of Object.entries(ETAPAS)) {
  const calc = r2(totais[etapa] ?? 0);
  console.log(`${etapa.padEnd(40)} ${calc.toFixed(2).padStart(14)} ${pdf.toFixed(2).padStart(14)} ${Math.abs(calc - pdf) > 0.02 ? 'DIVERGE' : 'ok'}`);
}
console.log(`TOTAL ${r2(total).toFixed(2)} (PDF 4131354.17) ${Math.abs(r2(total) - 4131354.17) > 0.05 ? 'DIVERGE' : 'ok'}`);

const out = path.join(root, 'supabase', 'migrations', '0018_smartfit_proposta.sql');
fs.writeFileSync(out, sql);
console.log(`gerado ${path.relative(root, out)} (${ITENS.length} itens)`);
}
