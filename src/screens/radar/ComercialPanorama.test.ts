// Commercial UX 1.0 — UX-1: prova do Panorama operacional.
//
// O projeto roda vitest em `environment: 'node'` e sem testing-library: componente React nao e renderizado aqui (e o
// `include` do vitest e `src/**/*.test.ts`, entao um arquivo .test.tsx nunca rodaria). Por isso o que o Panorama decide
// mora em funcoes puras — provadas caso a caso sobre a saida REAL dos motores — e o que so existe no JSX fica preso por
// guardas estaticas. Nada aqui reimplementa classificacao: o Panorama e o UX-0 continuam sendo a unica autoridade.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CASOS, HOJE } from '../../core/radar/cadenciaParidadeCM.fixtures';
import { TEXTO_BLOQUEIO_PLANO_CM } from '../../core/radar/commercialActionPlan';
import { planosDaFilaCM } from '../../core/radar/commercialActionPlan';
import { cadenciasDaFilaCM } from '../../core/radar/commercialCadence';
import { sugestoesTarefaDaFilaCM } from '../../core/radar/commercialCadenceTask';
import { TEXTO_RAZAO_CM, TEXTO_TRAVA_CM, construirCommercialQueue } from '../../core/radar/commercialMachine';
import {
  TEXTO_ESPERA_PANORAMA, TEXTO_ESPERA_SEM_MOTIVO_PANORAMA, TEXTO_NATUREZA_PANORAMA,
  excecaoPrincipalUX, motivoDaContaUX, textoDaExcecaoUX, zonasDoPanoramaUX,
} from './ComercialPanorama';
import {
  ORCAMENTO_PANORAMA_COMERCIAL, contasDoHorizonteUX, contasEmRiscoUX, resumoComercialUX, resumoEsperaUX, visaoComercialUX,
  type ContaComercialUX, type EntradaContaComercialUX,
} from './comercialVisao';

// ---------------------------------------------------------------------------------------------------------------------
// Apoio: a cadeia real dos motores, como a tela monta
// ---------------------------------------------------------------------------------------------------------------------
const TODAS: EntradaContaComercialUX[] = CASOS.flatMap((caso) => {
  const fila = construirCommercialQueue(caso.ds, HOJE);
  const planos = planosDaFilaCM(caso.ds, fila);
  const cadencias = cadenciasDaFilaCM(caso.ds, fila, planos, HOJE);
  const sugestoes = sugestoesTarefaDaFilaCM(caso.ds, fila, planos, cadencias, HOJE);
  return fila.itens.map((item, i) => ({ item, plano: planos[i], cadencia: cadencias[i], sugestao: sugestoes[i] }));
});
const CONTAS: ContaComercialUX[] = visaoComercialUX(TODAS);

const leia = (rel: string) => fs.readFileSync(path.join(process.cwd(), 'src/screens/radar', rel), 'utf8');
const semComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const FONTE_PANORAMA = leia('ComercialPanorama.tsx');
const CODIGO_PANORAMA = semComentarios(FONTE_PANORAMA);
const FONTE_HOJE = leia('Hoje.tsx');
const CODIGO_HOJE = semComentarios(FONTE_HOJE);
const CODIGO_FOCO = semComentarios(leia('ComercialFoco.tsx'));

// ---------------------------------------------------------------------------------------------------------------------
// Zonas: composicao do contrato do UX-0, sem classificacao nova
// ---------------------------------------------------------------------------------------------------------------------
describe('UX-1 · zonas do Panorama', () => {
  const z = zonasDoPanoramaUX(CONTAS);
  it('cada zona vem do recorte do UX-0 e respeita o teto de 3', () => {
    expect(z.agora.visiveis.length).toBeLessThanOrEqual(ORCAMENTO_PANORAMA_COMERCIAL.agora);
    expect(z.programado.visiveis.length).toBeLessThanOrEqual(ORCAMENTO_PANORAMA_COMERCIAL.programado);
    expect(z.risco.visiveis.length).toBeLessThanOrEqual(ORCAMENTO_PANORAMA_COMERCIAL.risco);
    expect(z.agora.visiveis).toEqual(contasDoHorizonteUX(CONTAS, 'AGORA').slice(0, 3));
    expect(z.programado.visiveis).toEqual(contasDoHorizonteUX(CONTAS, 'PROGRAMADO').slice(0, 3));
    expect(z.risco.visiveis).toEqual(contasEmRiscoUX(CONTAS).slice(0, 3));
  });
  it('o excedente de cada zona e contado para o "Ver todos"', () => {
    expect(z.agora.ocultos).toBe(Math.max(0, contasDoHorizonteUX(CONTAS, 'AGORA').length - 3));
    expect(z.programado.ocultos).toBe(Math.max(0, contasDoHorizonteUX(CONTAS, 'PROGRAMADO').length - 3));
    expect(z.risco.ocultos).toBe(Math.max(0, contasEmRiscoUX(CONTAS).length - 3));
  });
  it('AGORA so tem horizonte AGORA e PROGRAMADO so tem PROGRAMADO', () => {
    for (const c of z.agora.visiveis) expect(c.horizonte).toBe('AGORA');
    for (const c of z.programado.visiveis) expect(c.horizonte).toBe('PROGRAMADO');
  });
  it('a ordem do CM1-A e preservada dentro de cada zona', () => {
    for (const zona of [z.agora.visiveis, z.programado.visiveis, z.risco.visiveis]) {
      const indices = zona.map((c) => CONTAS.indexOf(c));
      expect(indices).toEqual([...indices].sort((a, b) => a - b));
    }
  });
  it('os contadores do topo sao os do UX-0, sem indice sintetico', () => {
    expect(z.resumo).toEqual(resumoComercialUX(CONTAS));
    expect(z.resumo.agora + z.resumo.aguardando + z.resumo.programado + z.resumo.semDestaque).toBe(CONTAS.length);
  });
  it('AGUARDANDO e resumo por motivo, nunca lista', () => {
    expect(z.espera).toEqual(resumoEsperaUX(CONTAS));
    expect(z.espera.reduce((s, e) => s + e.contas, 0)).toBe(z.resumo.aguardando);
    expect(z).not.toHaveProperty('aguardandoLista');
  });
  it('carteira vazia nao quebra nenhuma zona', () => {
    const vazio = zonasDoPanoramaUX([]);
    expect(vazio.resumo.total).toBe(0);
    expect(vazio.agora).toEqual({ visiveis: [], ocultos: 0 });
    expect(vazio.espera).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Risco e eixo sobreposto
// ---------------------------------------------------------------------------------------------------------------------
describe('UX-1 · risco sobreposto', () => {
  it('a mesma conta pode aparecer em AGORA e em RISCO', () => {
    const emAmbas = CONTAS.filter((c) => c.horizonte === 'AGORA' && c.excecoes.some((e) => e.severidade !== 'ATENCAO'));
    expect(emAmbas.length, 'as fixtures trazem conta devida com excecao').toBeGreaterThan(0);
    const z = zonasDoPanoramaUX(emAmbas);
    expect(z.agora.visiveis[0]).toBe(emAmbas[0]);
    expect(z.risco.visiveis[0]).toBe(emAmbas[0]);
    expect(z.resumo.agora).toBe(emAmbas.length);
    expect(z.resumo.emRisco).toBe(emAmbas.length);
  });
  it('risco nao remove a conta da zona temporal', () => {
    const z = zonasDoPanoramaUX(CONTAS);
    for (const c of z.risco.visiveis) expect(['AGORA', 'AGUARDANDO', 'PROGRAMADO', 'SEM_DESTAQUE']).toContain(c.horizonte);
    expect(contasEmRiscoUX(CONTAS).every((c) => CONTAS.includes(c))).toBe(true);
  });
  it('com varias excecoes, a mostrada e a mais severa — venha ela primeiro ou por ultimo', () => {
    const base = CONTAS.find((c) => c.excecoes.length)!;
    const bloqueio = { tipo: 'TRAVA', codigo: 'DUPLICATA_PENDENTE', severidade: 'BLOQUEIO', bloqueante: true } as const;
    const atencao = { tipo: 'OPORTUNIDADE_PARADA', codigo: 'OPORTUNIDADE_PARADA', severidade: 'ATENCAO', bloqueante: false } as const;
    expect(excecaoPrincipalUX({ ...base, excecoes: [bloqueio, atencao] })).toEqual(bloqueio);
    expect(excecaoPrincipalUX({ ...base, excecoes: [atencao, bloqueio] })).toEqual(bloqueio);
    // empate mantem a ordem de origem (a projecao nao reordena a lista de excecoes)
    const outraAtencao = { ...atencao, codigo: 'OPORTUNIDADE_PARADA_CRITICA' } as const;
    expect(excecaoPrincipalUX({ ...base, excecoes: [atencao, outraAtencao] })).toEqual(atencao);
  });
  it('UX-1.1 · a selecao da excecao nao reordena a colecao, nao mexe no contador e nao cria metrica', () => {
    const base = CONTAS.find((c) => c.excecoes.length > 1) ?? CONTAS.find((c) => c.excecoes.length)!;
    const antes = JSON.parse(JSON.stringify(base.excecoes));
    const resumoAntes = resumoComercialUX(CONTAS);
    excecaoPrincipalUX(base);
    expect(base.excecoes).toEqual(antes);
    expect(resumoComercialUX(CONTAS)).toEqual(resumoAntes);
    expect(contasEmRiscoUX(CONTAS).map((c) => c.itemId)).toEqual(CONTAS.filter((c) => c.excecoes.some((e) => e.severidade !== 'ATENCAO')).map((c) => c.itemId));
    expect(CODIGO_PANORAMA.toLowerCase()).not.toContain('score');
    expect(CODIGO_PANORAMA).not.toMatch(/\+=|\breduce\(/);
  });
  it('a excecao mostrada e a mais severa, e o texto vem da tabela da autoridade de origem', () => {
    for (const c of CONTAS) {
      const e = excecaoPrincipalUX(c);
      if (!c.excecoes.length) { expect(e).toBeUndefined(); continue; }
      const severidades = c.excecoes.map((x) => x.severidade);
      if (severidades.includes('BLOQUEIO')) expect(e!.severidade).toBe('BLOQUEIO');
      else if (severidades.includes('RISCO')) expect(e!.severidade).toBe('RISCO');
      else expect(e!.severidade).toBe('ATENCAO');
      const esperado = e!.tipo === 'TRAVA' ? TEXTO_TRAVA_CM[e!.codigo as keyof typeof TEXTO_TRAVA_CM]
        : e!.tipo === 'BLOQUEIO_PLANO' ? TEXTO_BLOQUEIO_PLANO_CM[e!.codigo as keyof typeof TEXTO_BLOQUEIO_PLANO_CM]
          : TEXTO_RAZAO_CM[e!.codigo as keyof typeof TEXTO_RAZAO_CM];
      expect(textoDaExcecaoUX(e!)).toBe(esperado);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Primeira camada: o que o cartao diz
// ---------------------------------------------------------------------------------------------------------------------
describe('UX-1 · primeira camada', () => {
  it('o motivo e o texto do CM1-A com o fato temporal que o item ja trazia', () => {
    for (const c of CONTAS) {
      const frase = motivoDaContaUX(c);
      expect(frase.startsWith(c.motivo.texto)).toBe(true);
      if (c.motivo.dias != null && c.motivo.dias > 0) expect(frase).toContain(`há ${c.motivo.dias} dia`);
      else if (c.motivo.venceEm) expect(frase).toContain('prazo');
      else expect(frase).toBe(c.motivo.texto);
    }
    expect(motivoDaContaUX({ ...CONTAS[0], motivo: { ...CONTAS[0].motivo, dias: 1, venceEm: undefined } })).toContain('há 1 dia');
  });
  it('a natureza da data continua explicita e RECOMENDADA nunca parece compromisso', () => {
    expect(TEXTO_NATUREZA_PANORAMA.RECOMENDADA).toContain('ainda não é compromisso');
    expect(TEXTO_NATUREZA_PANORAMA.FIRME).not.toBe(TEXTO_NATUREZA_PANORAMA.RECOMENDADA);
    expect(TEXTO_NATUREZA_PANORAMA.BASE_CM1).not.toBe(TEXTO_NATUREZA_PANORAMA.RECOMENDADA);
    const recomendadas = contasDoHorizonteUX(CONTAS, 'PROGRAMADO').filter((c) => c.proximoToque?.natureza === 'RECOMENDADA');
    expect(recomendadas.length, 'ha data recomendada real nas fixtures').toBeGreaterThan(0);
  });
  it('os rotulos de espera cobrem os quatro motivos e o "sem motivo informado"', () => {
    expect(Object.keys(TEXTO_ESPERA_PANORAMA).sort()).toEqual(['DADO', 'DATA', 'DECISAO_HUMANA', 'FATO_NOVO']);
    expect(TEXTO_ESPERA_SEM_MOTIVO_PANORAMA).toBe('sem motivo informado');
  });
  it('o Panorama nao expoe score, decision fit, tier, degrau, versoes, playbook, canais descartados, tentativas nem secundarias', () => {
    for (const proibido of ['priorityScore', 'priorityClass', 'decision', 'fit', 'tier', 'degrau', 'versao', 'playbook', 'canaisDescartados', 'tentativa', 'secundarias', '.ordem', 'ChaveOrdem']) {
      expect(CODIGO_PANORAMA.toLowerCase(), `nao pode citar ${proibido}`).not.toContain(proibido.toLowerCase());
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Guardas: autoridade, pureza e preservacao da fila completa
// ---------------------------------------------------------------------------------------------------------------------
describe('UX-1 · guardas', () => {
  it('o Panorama nao chama motor, store nem reclassifica', () => {
    for (const proibido of ['construirCommercialQueue', 'planosDaFilaCM', 'cadenciasDaFilaCM', 'sugestoesTarefaDaFilaCM', 'filaHoje', 'recomendarAcao', 'useStore', 'actions.', '../../data/store']) {
      expect(CODIGO_PANORAMA, `nao pode usar ${proibido}`).not.toContain(proibido);
    }
    // a regra do horizonte vive no UX-0, que e quem le a cadencia: o Panorama nem toca nela
    for (const reclassifica of ['cadencia.', 'retomaCom ===', "horizonte = '", 'horizonteDaCadenciaUX']) {
      expect(CODIGO_PANORAMA, `nao pode reclassificar (${reclassifica})`).not.toContain(reclassifica);
    }
    expect(CODIGO_PANORAMA).not.toMatch(/estado\s*===/);
    expect(CODIGO_PANORAMA).not.toMatch(/\.sort\(|localeCompare|\.reverse\(/);
    expect(CODIGO_PANORAMA).not.toContain('switch (plano.modo');
  });
  it('o Panorama consome exatamente os helpers do UX-0', () => {
    for (const usado of ['resumoComercialUX', 'contasDoHorizonteUX', 'contasEmRiscoUX', 'resumoEsperaUX', 'recorteUX', 'ORCAMENTO_PANORAMA_COMERCIAL']) {
      expect(CODIGO_PANORAMA, `deve usar ${usado}`).toContain(usado);
    }
  });
  it('o switch do modo do plano existe uma unica vez, e na Hoje', () => {
    expect(CODIGO_HOJE.match(/switch \(plano\.modo\)/g)).toHaveLength(1);
    expect(CODIGO_PANORAMA).not.toContain('plano.modo');
  });
  it('o Panorama recebe a acao pronta da Hoje (nenhum CTA novo e nenhuma escrita)', () => {
    expect(CODIGO_PANORAMA).toContain('acaoPrincipal');
    expect(CODIGO_PANORAMA).toContain('ctaCadencia');
    for (const proibido of ['salvarTarefaRadar', 'novaTarefaRadar', 'criarTarefaDaCadenciaCM', 'registrarAtividadeRadar', 'gerarComunicacaoRadar']) {
      expect(CODIGO_PANORAMA).not.toContain(proibido);
    }
  });
  it('o agendamento governado continua passando por ctaCadenciaCM -> abrirAgendamentoCM -> TarefaCadenciaForm', () => {
    expect(CODIGO_HOJE).toContain('ctaCadenciaCM(l.sugestao, podeAgir)');
    expect(CODIGO_HOJE).toContain('abrirAgendamento(l.cadencia, l.sugestao)');
    expect(CODIGO_HOJE).toContain('abrirAgendamentoCM(cadencia, sugestao)');
    expect(CODIGO_HOJE).toContain('<TarefaCadenciaForm');
    expect(CODIGO_HOJE).toContain('ctaCadenciaCM(l.sugestao, podeAgir)');
  });
  it('o Panorama e a visao padrao e a fila completa continua acessivel', () => {
    expect(CODIGO_HOJE).toContain("useState<VisaoComercial>('panorama')");
    expect(CODIGO_HOJE).toMatch(/label: 'Panorama'/);
    expect(CODIGO_HOJE).toMatch(/Fila completa \(/);
  });
  it('a fila completa preserva a experiencia atual inteira', () => {
    for (const parte of [
      '<KpiStrip', "label: 'Agir agora'", "label: 'Agendado'", 'TEXTO_FORA_DA_FILA', '<Tabs value={categoria}',
      '<ComercialFoco linha={foco}', 'modo="OPERACIONAL"', 'acoes={acoes(foco)}', 'ctaCadencia={ctaCadenciaDe(foco)}',
      '<Tabela<Linha>', "titulo: 'Próximo toque'", "titulo: 'Trava'", '<ScoreModal', '<AtividadeForm', '<ConcluirTarefaForm', '<TarefaForm', '<Abordagem',
    ]) {
      expect(CODIGO_HOJE, `a fila completa perdeu: ${parte}`).toContain(parte);
    }
    // o conteudo do foco mora no bloco compartilhado (renderizado pela fila em modo OPERACIONAL)
    for (const parte of ['Travas e pendências', 'Plano de contato', 'Histórico', 'Por que agora', 'Decision fit', 'Canais válidos', 'Objetivo', 'Playbook', 'Tentativas']) {
      expect(CODIGO_FOCO, `o bloco compartilhado perdeu: ${parte}`).toContain(parte);
    }
  });
  it('as acoes da fila completa mantem rotulos, ordem e destino de antes', () => {
    for (const rotulo of [
      "'Preparar abordagem'", "'Abrir abordagem aprovada'", "'Registrar atividade'", "'Concluir esta tarefa'", "'Agendar tarefa'",
      "'Criar tarefa manual'", "'Abrir oportunidade'", "'Abrir empresa'", "'Revisar abordagem'", "'Resolver duplicata'",
      "'Ver lista de não contatar'", "'Definir responsável da oportunidade'", "'Revisar tarefas e abordagens'", "'Revisar tarefa'",
      "'Revisar contatos da empresa'", "'Verificar sinal'", "'Completar canal do contato'", "'Validar ou trocar contato'",
      "'Buscar decisor nos contatos'", "'Agendar pesquisa'",
    ]) {
      expect(CODIGO_HOJE, `rotulo perdido: ${rotulo}`).toContain(rotulo);
    }
    // botao continua exigindo permissao; link continua livre
    expect(CODIGO_HOJE).toContain('.filter((a) => !!a.to || podeAgir)');
  });
  it('UX-2 · o Panorama abre a gaveta "Por quê" e nao monta explicacao propria', () => {
    expect(CODIGO_PANORAMA).toContain('onPorQue');
    expect(CODIGO_PANORAMA.match(/Por quê ›/g)).toHaveLength(3); // AGORA, RISCO e PROGRAMADO
    expect(CODIGO_PANORAMA).not.toContain('Ver detalhes ›');
    // a gaveta e da Hoje: o Panorama so avisa qual conta
    expect(CODIGO_PANORAMA).not.toContain('<Modal');
    expect(CODIGO_PANORAMA).not.toContain('blocoFoco');
  });
  // -------------------------------------------------------------------------------------------------------------------
  // UX-2 — gaveta "Por quê": 100% da explicabilidade, por construcao (o MESMO blocoFoco da fila completa)
  // -------------------------------------------------------------------------------------------------------------------
  it('UX-2/UX-2.1 · a gaveta usa a MESMA apresentacao da fila, em modo de explicacao', () => {
    // a prova de composicao (nenhum no de acao passa em EXPLICACAO) vive em ComercialFoco.test.ts
    expect(CODIGO_HOJE.match(/<ComercialFoco/g)).toHaveLength(2);
    expect(CODIGO_HOJE).toContain('modo="EXPLICACAO"');
    expect(CODIGO_HOJE).not.toContain('function blocoFoco');
  });
  it('UX-2 · a gaveta mostra as versões CM e leva à fila completa sem perder o foco', () => {
    expect(CODIGO_HOJE).toMatch(/Regras em vigor: fila \{VERSAO_REGRAS_CM\} · plano \{VERSAO_REGRAS_PLANO_CM\} · cadência \{VERSAO_REGRAS_CADENCIA_CM\}/);
    expect(CODIGO_HOJE).toContain('Abrir na fila completa');
    expect(CODIGO_HOJE).toContain('setFocoId(itemId)');
    expect(CODIGO_HOJE).toContain("setVisao('fila')");
  });
  it('UX-2 · a gaveta usa o Modal do sistema (foco preso, Esc, tema) e nao inventa overlay', () => {
    expect(CODIGO_HOJE).toMatch(/<Modal key=\{`porque:\$\{linhaDaGaveta\.id\}`\}/);
    expect(CODIGO_HOJE).toContain('onClose={() => setPorQue(null)}');
    for (const proibido of ['position: \'fixed\'', 'zIndex', 'document.addEventListener']) expect(CODIGO_HOJE).not.toContain(proibido);
  });
  it('UX-2 · a gaveta nao cria conteudo novo nem toca no motor', () => {
    const i = CODIGO_HOJE.indexOf('{linhaDaGaveta && (');
    const gaveta = CODIGO_HOJE.slice(i, CODIGO_HOJE.indexOf('{el}', i));
    for (const proibido of ['construirCommercialQueue', 'planosDaFilaCM', 'cadenciasDaFilaCM', 'actions.', 'filaHoje']) {
      expect(gaveta, `a gaveta nao pode usar ${proibido}`).not.toContain(proibido);
    }
  });
  it('UX-5 nao foi antecipado: sem ENTRADA e sem lead', () => {
    for (const proibido of ['ENTRADA', 'Entrada', 'lead', 'Lead']) {
      expect(CODIGO_PANORAMA, `nao pode antecipar ${proibido}`).not.toContain(proibido);
    }
  });
  it('UX-4: o Panorama recebe o pipeline pronto e nao le dataset nem escolhe oportunidade', () => {
    expect(CODIGO_PANORAMA).toContain('pipelineAtivo: readonly OportunidadePipelineUX[]');
    expect(CODIGO_PANORAMA).toContain('recorteUX(pipelineAtivo, ORCAMENTO_PANORAMA_COMERCIAL.pipeline)');
    for (const proibido of ['oportunidades.find', 'estagioAtivo', 'ds.radar', 'historicoEstagios', '.sort(']) {
      expect(CODIGO_PANORAMA, `o Panorama nao pode conter ${proibido}`).not.toContain(proibido);
    }
  });
});
