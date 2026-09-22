// Commercial UX 1.0 — UX-6: acabamento operacional (responsividade, acessibilidade, tour e telemetria local).
//
// Nada aqui muda regra comercial. A suite prova o acabamento e, no fim, repete as invariantes de UX-3/4/5 para
// garantir que o polimento nao mexeu em quem trabalhar, o que fazer nem quando agir.
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ComercialModoFoco, { type AcaoFocoUX, type ComercialModoFocoProps } from './ComercialModoFoco';
import ComercialPanorama from './ComercialPanorama';
import { entradaComercialUX } from './comercialEntrada';
import { EVENTOS_COMERCIAIS_UX } from './comercialTelemetria';
import type { ContaComercialUX } from './comercialVisao';
import { POR_ROTA } from '../../ui/Tour';

// ---------------------------------------------------------------------------------------------------------------------
// Apoio
// ---------------------------------------------------------------------------------------------------------------------
const raiz = (rel: string) => path.join(process.cwd(), rel);
const semComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const CSS = fs.readFileSync(raiz('src/styles.css'), 'utf8');
const CODIGO_FOCO = semComentarios(fs.readFileSync(raiz('src/screens/radar/ComercialModoFoco.tsx'), 'utf8'));
const CODIGO_PANORAMA = semComentarios(fs.readFileSync(raiz('src/screens/radar/ComercialPanorama.tsx'), 'utf8'));
const CODIGO_HOJE = semComentarios(fs.readFileSync(raiz('src/screens/radar/Hoje.tsx'), 'utf8'));
const CODIGO_TELEMETRIA_UX = semComentarios(fs.readFileSync(raiz('src/screens/radar/comercialTelemetria.ts'), 'utf8'));
const CODIGO_TOUR = semComentarios(fs.readFileSync(raiz('src/ui/Tour.tsx'), 'utf8'));
const PASSOS_HOJE = POR_ROTA['/radar/hoje'];

const temMedia = (largura: string, seletor: string) => {
  const re = new RegExp(`@media \\(max-width: ${largura}\\)[^@]*?${seletor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 's');
  return re.test(CSS);
};

function conta(n: number, extra: Partial<ContaComercialUX> = {}): ContaComercialUX {
  return {
    itemId: `item-${n}`, empresaId: `empresa-${n}`, posicao: n, horizonte: 'AGORA',
    motivo: { codigo: 'SINAL_ACIONAVEL_NOVO', texto: `motivo ${n}` }, modo: 'CONTATO',
    sugestao: { estado: 'NAO_APLICAVEL' }, excecoes: [], contato: { id: `c-${n}`, canal: 'EMAIL' }, ...extra,
  };
}
const FILA = [1, 2, 3].map((n) => conta(n));
const DESCRITORES: AcaoFocoUX[] = [
  { id: 'Preparar abordagem', rotulo: 'Preparar abordagem', primario: true, onClick: () => {} },
  { id: 'Registrar atividade', rotulo: 'Registrar atividade', onClick: () => {} },
];
function propsFoco(focoId: string | null, extra: Partial<ComercialModoFocoProps> = {}): ComercialModoFocoProps {
  return {
    contas: FILA, foco: { id: focoId, perdido: null },
    nomeEmpresa: (id) => `Empresa ${id}`, nomeContato: (id) => `Contato ${id}`, nomeCanal: () => 'E-mail',
    classeDaConta: () => 'A', objetivoDaConta: () => 'Iniciar descoberta', acoes: () => DESCRITORES,
    ctaCadencia: () => null, onFoco: () => {}, onPorQue: () => {}, onPanorama: () => {}, onPrimeiraDisponivel: () => {},
    ...extra,
  };
}
const htmlFoco = (focoId: string | null, extra: Partial<ComercialModoFocoProps> = {}) =>
  renderToStaticMarkup(React.createElement(ComercialModoFoco, propsFoco(focoId, extra)));

const entradaCheia = entradaComercialUX({
  linhas: [{ itemId: 'i1', item: { empresaId: 'e1', porQueAgora: { codigo: 'SEM_DECISOR' }, secundarias: [] } as never }],
  empresas: [{ id: 'e1', razaoSocial: 'E1', pais: 'BR', observacoes: '', ativo: true, criadoEm: '2026-09-14', atualizadoEm: '2026-09-14' } as never],
  sinais: [{ id: 's1', empresaId: 'e1', tipo: 'NEW_FACTORY', titulo: 'Nova fábrica', detectadoEm: '2026-09-15', eventoEm: '2026-06-01', verificado: false } as never],
  hoje: '2026-09-15',
});
const htmlPanorama = () => renderToStaticMarkup(React.createElement(ComercialPanorama, {
  contas: FILA, nomeEmpresa: (id: string) => `Empresa ${id}`, nomeContato: () => '—', nomeCanal: () => '',
  acaoPrincipal: () => null, ctaCadencia: () => null, onPorQue: () => {}, onVerTodos: () => {},
  pipelineAtivo: [{ itemId: 'item-1', empresaId: 'empresa-1', oportunidadeId: 'o1', titulo: 'Galpão', estagio: 'ENGAGED', valorEstimado: 100, ultimoMovimentoEm: '2026-09-10', diasSemMovimento: 5, estado: 'PARADA' }],
  entrada: entradaCheia,
}));

// ---------------------------------------------------------------------------------------------------------------------
// A. Responsividade
// ---------------------------------------------------------------------------------------------------------------------
describe('UX-6 — responsividade', () => {
  it('o Modo Foco usa classe (que media query alcança), não grid inline de largura fixa', () => {
    expect(CODIGO_FOCO).toContain('className="foco-trabalho"');
    expect(CODIGO_FOCO).not.toContain("gridTemplateColumns: 'minmax(0, 2fr)");
    expect(CSS).toContain('.foco-trabalho { display: grid; grid-template-columns: minmax(0, 2fr) minmax(240px, 1fr);');
    expect(temMedia('900px', '.foco-trabalho { grid-template-columns: 1fr; }')).toBe(true);
  });

  it('em 480px as ações e a navegação do foco viram alvos de toque confortáveis', () => {
    expect(temMedia('480px', '.foco-trabalho .foco-acoes .btn { width: 100%')).toBe(true);
    expect(CSS).toContain('min-height: 44px;');
    expect(temMedia('480px', '.foco-trabalho .foco-nav .btn { flex: 1 1 0;')).toBe(true);
  });

  it('a Entrada vira uma coluna no celular (e o card não estoura a largura)', () => {
    expect(CODIGO_PANORAMA).toContain('className="grid cols-3 entrada-cards"');
    expect(temMedia('640px', '.entrada-cards { grid-template-columns: 1fr; }')).toBe(true);
    expect(CSS).toContain('.entrada-cards .card { min-width: 0; overflow-wrap: anywhere; }');
    // a regra global de grid ja colapsa em 800px; a da zona e explicita para nao depender so dela
    expect(temMedia('800px', '.grid.cols-2, .grid.cols-3, .grid.cols-4 { grid-template-columns: 1fr; }')).toBe(true);
  });

  it('o Pipeline empilha em tela estreita em vez de rolar de lado', () => {
    expect(CODIGO_PANORAMA).toContain('className="pipeline-item"');
    expect(CSS).toContain('.pipeline-item { display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; min-width: 0; }');
    expect(temMedia('640px', '.pipeline-item { display: grid;')).toBe(true);
    expect(CSS).not.toContain('white-space: nowrap; }\n.pipeline-item');
    expect(CSS.slice(CSS.indexOf('.pipeline-item'))).not.toContain('overflow-x: auto');
  });

  it('"Depois desta" é lista vertical, nunca carousel', () => {
    expect(CODIGO_FOCO).toContain('className="foco-depois"');
    expect(CSS).toContain('.foco-depois { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }');
    for (const proibido of ['carousel', 'carrossel', 'scroll-snap', 'overflow-x']) {
      expect(CSS.slice(CSS.indexOf('.foco-depois')), `sem ${proibido}`).not.toContain(proibido);
      expect(CODIGO_FOCO, `sem ${proibido}`).not.toContain(proibido);
    }
  });

  it('`row` e `spacer` passam a existir de verdade — escopados às superfícies comerciais', () => {
    expect(CSS).toContain('.panorama .row, .foco-trabalho .row { display: flex;');
    expect(CSS).toContain('.panorama .spacer, .foco-trabalho .spacer { flex: 1 1 auto; }');
  });

  it('o mobile ESCONDE espaçador, nunca conteúdo ou ação', () => {
    const bloco = CSS.slice(CSS.indexOf('Maquina Comercial — acabamento operacional'));
    const escondidos = [...bloco.matchAll(/([^{}\n]+)\{[^{}]*display: none/g)].map((m) => m[1].trim());
    expect(escondidos).toEqual(['.pipeline-item .spacer']);
    for (const alvo of ['Por quê', 'aria-label', '.btn', '.foco-acoes', '.foco-nav', '.foco-depois', '.entrada-cards .card']) {
      expect(escondidos.join(' '), `nada pode esconder ${alvo}`).not.toContain(alvo);
    }
  });

  it('a gaveta não exige largura de desktop: o modal compartilhado já é fluido', () => {
    expect(CSS).toContain('.modal { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; width: min(920px, 100%); max-height: 92vh; overflow: auto;');
    expect(CSS).toContain('.modal-bg { position: fixed; inset: 0;');
  });

  it('nenhuma largura fixa em px foi introduzida nas superfícies comerciais', () => {
    for (const codigo of [CODIGO_FOCO, CODIGO_PANORAMA]) {
      expect(codigo).not.toMatch(/width: '\d{3,}px'/);
      expect(codigo).not.toMatch(/minWidth: '\d{3,}px'/);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// B. Acessibilidade
// ---------------------------------------------------------------------------------------------------------------------
describe('UX-6 — acessibilidade', () => {
  it('as abas continuam com semântica de tablist (componente compartilhado, sem duplicação)', () => {
    const componentes = fs.readFileSync(raiz('src/ui/components.tsx'), 'utf8');
    expect(componentes).toContain('role="tablist"');
    expect(componentes).toContain('role="tab"');
    expect(componentes).toContain('aria-selected={i.id === value}');
    expect(CODIGO_HOJE).not.toContain('role="tablist"'); // a tela usa o componente, nao reimplementa
  });

  it('Anterior e Próxima são semanticamente disabled nos extremos', () => {
    const primeiro = htmlFoco('item-1');
    expect(primeiro).toMatch(/<button[^>]*disabled[^>]*aria-label="Conta anterior da fila"|<button[^>]*aria-label="Conta anterior da fila"[^>]*disabled/);
    const ultimo = htmlFoco('item-3');
    expect(ultimo).toMatch(/<button[^>]*disabled[^>]*aria-label="Próxima conta da fila"|<button[^>]*aria-label="Próxima conta da fila"[^>]*disabled/);
    expect(htmlFoco('item-2')).not.toContain('disabled');
  });

  it('os botões cujo rótulo não basta têm nome acessível', () => {
    const html = htmlFoco('item-2');
    expect(html).toContain('aria-label="Por quê esta conta está na fila"');
    expect(html).toContain('aria-label="Conta anterior da fila"');
    expect(html).toContain('aria-label="Próxima conta da fila"');
    expect(html).toContain('aria-label="Trazer Empresa empresa-3 para o foco"');
    expect(html).toContain('<nav class="foco-nav" aria-label="Navegar na fila">');
  });

  it('o "Por quê" do Panorama também nomeia a conta', () => {
    expect(htmlPanorama()).toContain('aria-label="Por quê Empresa empresa-1 está na fila"');
  });

  it('os links das zonas apontam para destinos reais', () => {
    const html = htmlPanorama();
    expect(html).toContain('href="#/radar"');
    expect(html).toContain('?aba=oportunidades');
    expect(html).toContain('href="#/radar/empresas/');
  });

  it('a gaveta reutiliza o modal acessível (dialog, Esc, foco preso, fechar)', () => {
    const componentes = fs.readFileSync(raiz('src/ui/components.tsx'), 'utf8');
    expect(componentes).toContain('role="dialog" aria-modal="true" aria-label={title}');
    expect(componentes).toContain("e.key === 'Escape' && onClose()");
    expect(CODIGO_HOJE).toContain('<button className="btn primary" onClick={() => setPorQue(null)}>Fechar</button>');
  });

  it('o foco visível global continua de pé', () => {
    expect(CSS).toContain(':focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }');
  });

  it('nada novo ignora prefers-reduced-motion e nenhuma ação depende de hover', () => {
    expect(CSS).toContain('@media (prefers-reduced-motion: reduce)');
    const novo = CSS.slice(CSS.indexOf('Maquina Comercial — acabamento operacional'));
    for (const proibido of ['animation:', 'transition:', ':hover']) expect(novo, `o bloco novo nao usa ${proibido}`).not.toContain(proibido);
    for (const codigo of [CODIGO_FOCO, CODIGO_PANORAMA]) expect(codigo).not.toContain('onMouseEnter');
  });

  it('os dois temas continuam usando tokens, sem cor nova', () => {
    const novo = CSS.slice(CSS.indexOf('Maquina Comercial — acabamento operacional'));
    expect(novo).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(novo).not.toMatch(/rgb\(|rgba\(/);
    expect(CSS).toContain(':root[data-theme="light"]');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// C. Tour
// ---------------------------------------------------------------------------------------------------------------------
describe('UX-6 — tour da Máquina Comercial', () => {
  it('a rota tem tour próprio, com um passo por assunto', () => {
    expect(PASSOS_HOJE).toBeDefined();
    expect(PASSOS_HOJE.length).toBeGreaterThanOrEqual(7);
    expect(PASSOS_HOJE.map((p) => p.titulo)).toEqual(['Comercial', 'As três visões', 'Panorama', 'Pipeline ativo', 'Entrada', 'Trabalhar a fila', 'Por quê']);
  });

  it('o texto antigo sobre score saiu de vez', () => {
    const texto = PASSOS_HOJE.map((p) => `${p.titulo} ${p.texto}`).join(' ').toLowerCase();
    expect(texto).not.toContain('score');
    expect(texto).not.toContain('vencidas primeiro');
    expect(CODIGO_TOUR).not.toContain('depois o score');
  });

  it('explica as três visões e que os filtros não mudam a prioridade', () => {
    const t = PASSOS_HOJE.map((p) => p.texto).join(' ');
    expect(t).toContain('Panorama');
    expect(t).toContain('Trabalhar a fila');
    expect(t).toContain('Fila completa');
    expect(t).toMatch(/filtros.*nunca mudam a prioridade/s);
  });

  it('explica Panorama, Pipeline e Entrada com os conceitos certos', () => {
    const porTitulo = Object.fromEntries(PASSOS_HOJE.map((p) => [p.titulo, p.texto]));
    expect(porTitulo['Panorama']).toMatch(/Agora.*Aguardando.*Programado.*Risco/s);
    expect(porTitulo['Pipeline ativo']).toMatch(/oportunidade de referência/i);
    expect(porTitulo['Pipeline ativo']).toMatch(/PARADA e EM RISCO vêm da máquina/);
    expect(porTitulo['Entrada']).toMatch(/sinal novo/i);
    expect(porTitulo['Entrada']).toMatch(/conta adicionada ao Radar/i);
    expect(porTitulo['Entrada']).toMatch(/enriquecimento/i);
  });

  it('diz que falta de decisor/canal NÃO é lead novo', () => {
    const entrada = PASSOS_HOJE.find((p) => p.titulo === 'Entrada')!.texto;
    expect(entrada).toContain('nunca um lead novo');
  });

  it('diz que executar ação não avança a conta', () => {
    const foco = PASSOS_HOJE.find((p) => p.titulo === 'Trabalhar a fila')!.texto;
    expect(foco).toContain('não avança a fila');
    expect(foco).toContain('escolha sua');
  });

  it('o "Por quê" é apresentado como leitura, sem alterar nada', () => {
    const t = PASSOS_HOJE.find((p) => p.titulo === 'Por quê')!.texto;
    expect(t).toMatch(/só leitura|nada é alterado/i);
  });

  it('os seletores existem de verdade na tela e não são nth-child frágil', () => {
    const html = htmlPanorama();
    for (const p of PASSOS_HOJE) expect(p.seletor).not.toContain('nth-child');
    for (const alvo of ['comercial-agora', 'comercial-pipeline', 'comercial-entrada', 'comercial-porque']) {
      expect(PASSOS_HOJE.some((p) => p.seletor.includes(alvo)), `passo com ${alvo}`).toBe(true);
      expect(html, `data-tour="${alvo}" na tela`).toContain(`data-tour="${alvo}"`);
    }
    // os dois seletores estruturais vivem no App/tela e continuam existindo
    expect(PASSOS_HOJE.some((p) => p.seletor === '.content .page-head')).toBe(true);
    expect(PASSOS_HOJE.some((p) => p.seletor === '.content .tabs')).toBe(true);
    expect(CODIGO_HOJE).toContain('<PageHead');
    expect(CODIGO_HOJE).toContain('<Tabs value={visao}');
  });

  it('não existe um segundo tour', () => {
    const arquivos = fs.readdirSync(raiz('src/ui')).concat(fs.readdirSync(raiz('src/screens/radar')));
    expect(arquivos.filter((f) => /tour/i.test(f) && f.endsWith('.tsx'))).toEqual(['Tour.tsx']);
    for (const codigo of [CODIGO_FOCO, CODIGO_PANORAMA, CODIGO_HOJE]) {
      expect(codigo).not.toContain('PassoTour');
      expect(codigo).not.toContain('tour-cartao');
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// D. Telemetria local
// ---------------------------------------------------------------------------------------------------------------------
describe('UX-6 — telemetria local', () => {
  it('usa o `registrarAcao` existente e não cria infraestrutura nova', () => {
    expect(CODIGO_TELEMETRIA_UX).toContain("import { registrarAcao } from '../../data/telemetria';");
    for (const proibido of ['localStorage', 'sessionStorage', 'indexedDB', 'fetch(', 'supabase', 'axios', 'navigator.sendBeacon']) {
      expect(CODIGO_TELEMETRIA_UX, `o catalogo nao pode conter ${proibido}`).not.toContain(proibido);
    }
  });

  it('o catálogo é fechado e cobre as interações da Máquina Comercial', () => {
    expect(Object.values(EVENTOS_COMERCIAIS_UX)).toEqual([
      'comercial:visao:panorama', 'comercial:visao:foco', 'comercial:visao:fila', 'comercial:porque:abrir',
      'comercial:foco:proxima', 'comercial:foco:anterior', 'comercial:foco:selecionar-depois',
      'comercial:foco:primeira-disponivel', 'comercial:pipeline:abrir', 'comercial:entrada:abrir-inteligencia',
    ]);
    for (const e of Object.values(EVENTOS_COMERCIAIS_UX)) expect(e).toMatch(/^comercial:[a-z-]+:[a-z-]+$/);
  });

  it('a troca de visão registra os três eventos, cada um no seu caso', () => {
    expect(CODIGO_HOJE).toContain("registrarEventoComercial(v === 'panorama' ? EVENTOS_COMERCIAIS_UX.visaoPanorama : v === 'foco' ? EVENTOS_COMERCIAIS_UX.visaoFoco : EVENTOS_COMERCIAIS_UX.visaoFila);");
  });

  it('a gaveta, a navegação do foco e a primeira disponível registram', () => {
    expect(CODIGO_HOJE).toContain('EVENTOS_COMERCIAIS_UX.porQueAbrir');
    expect(CODIGO_HOJE).toContain('EVENTOS_COMERCIAIS_UX.focoProxima');
    expect(CODIGO_HOJE).toContain('EVENTOS_COMERCIAIS_UX.focoAnterior');
    expect(CODIGO_HOJE).toContain('EVENTOS_COMERCIAIS_UX.focoSelecionarDepois');
    expect(CODIGO_HOJE).toContain('EVENTOS_COMERCIAIS_UX.focoPrimeiraDisponivel');
  });

  it('pipeline e entrada registram pela porta do Panorama', () => {
    expect(CODIGO_PANORAMA).toContain('onEvento?.(EVENTO_PIPELINE_PANORAMA)');
    expect(CODIGO_PANORAMA).toContain('onEvento?.(EVENTO_ENTRADA_PANORAMA)');
    expect(CODIGO_PANORAMA).toContain('EVENTOS_COMERCIAIS_UX.pipelineAbrir');
    expect(CODIGO_PANORAMA).toContain('EVENTOS_COMERCIAIS_UX.entradaInteligencia');
    expect(CODIGO_HOJE).toContain('onEvento={(evento) => registrarEventoComercial(evento as EventoComercialUX)}');
  });

  it('nenhum evento carrega id, nome, contato ou valor', () => {
    for (const e of Object.values(EVENTOS_COMERCIAIS_UX)) {
      for (const proibido of ['empresa', 'contato', 'oportunidade', 'item', 'email', 'telefone', 'valor']) {
        expect(e, `${e} nao pode citar ${proibido}`).not.toContain(proibido);
      }
    }
    // a assinatura so aceita o catalogo: nao existe parametro de dado
    expect(CODIGO_TELEMETRIA_UX).toContain('export function registrarEventoComercial(evento: EventoComercialUX): void {');
    expect(CODIGO_HOJE).not.toMatch(/registrarEventoComercial\([^)]*(empresaId|contatoId|oportunidadeId|itemId)/);
  });

  it('nenhuma rede foi adicionada e a visita de tela não é duplicada', () => {
    for (const codigo of [CODIGO_TELEMETRIA_UX, CODIGO_HOJE, CODIGO_PANORAMA, CODIGO_FOCO]) {
      expect(codigo).not.toContain('registrarVisita');
      expect(codigo).not.toContain('sendBeacon');
    }
    expect(fs.readFileSync(raiz('src/App.tsx'), 'utf8')).toContain('registrarVisita');
  });

  it('a infraestrutura de telemetria não foi alterada', () => {
    const t = fs.readFileSync(raiz('src/data/telemetria.ts'), 'utf8');
    expect(t).toContain('export function registrarAcao(nome: string, agora = new Date())');
    expect(t).not.toContain('fetch(');
    expect(t).not.toContain('supabase');
  });

  it('nenhuma ação comercial é medida como sucesso', () => {
    for (const e of Object.values(EVENTOS_COMERCIAIS_UX)) {
      for (const proibido of ['enviou', 'ganhou', 'converteu', 'sucesso']) expect(e).not.toContain(proibido);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// E. Regressões de UX-3, UX-4 e UX-5
// ---------------------------------------------------------------------------------------------------------------------
describe('UX-6 — o acabamento não mexeu no motor nem nas decisões', () => {
  it('Panorama continua o default e `base` continua a autoridade', () => {
    expect(CODIGO_HOJE).toContain("useState<VisaoComercial>('panorama')");
    expect(CODIGO_HOJE).toContain('visaoComercialUX(base.map(');
    expect(CODIGO_HOJE).toContain('const visiveis = categoria === ');
    const foco = CODIGO_HOJE.slice(CODIGO_HOJE.indexOf('<ComercialModoFoco'), CODIGO_HOJE.indexOf('onPrimeiraDisponivel'));
    expect(foco).not.toContain('visiveis');
  });

  it('UX-3: registrar a interação não executa ação comercial nem avança o foco', () => {
    // o gesto de navegacao e o UNICO lugar que troca o foco, e ele nao chama acao nenhuma
    const trocar = CODIGO_HOJE.slice(CODIGO_HOJE.indexOf('const trocarFoco = (itemId: string) => {'), CODIGO_HOJE.indexOf('const objetivoDaConta'));
    for (const proibido of ['actions.', 'setAbordagem', 'setAtividade', 'setConcluir', 'setAgendar', 'acoesDisponiveis']) {
      expect(trocar, `trocarFoco nao pode conter ${proibido}`).not.toContain(proibido);
    }
    expect(CODIGO_HOJE).toContain('focoInvalidadoUX(contasUX, focoTrabalhoId)');
    expect((CODIGO_HOJE.match(/focoAoEntrarUX\(/g) ?? [])).toHaveLength(1);
  });

  it('UX-2.1: a gaveta continua fail-closed e read-only', () => {
    expect(CODIGO_HOJE).toContain('gavetaFailClosed(porQue, idsAutorizados)');
    const gaveta = CODIGO_HOJE.slice(CODIGO_HOJE.indexOf('{linhaDaGaveta && ('));
    expect(gaveta).not.toContain('acoes={');
    expect(gaveta).not.toContain('ctaCadencia={');
  });

  it('UX-4: pipeline continua vindo de item.oportunidadeId e sem SLA na UI', () => {
    const pipeline = fs.readFileSync(raiz('src/screens/radar/comercialPipeline.ts'), 'utf8');
    expect(pipeline).toContain('x.id === item.oportunidadeId');
    expect(pipeline).not.toContain('slaEstagioDias');
    expect(CODIGO_PANORAMA).toContain('recorteUX(pipelineAtivo, ORCAMENTO_PANORAMA_COMERCIAL.pipeline)');
  });

  it('UX-5: entrada continua em detectadoEm/criadoEm e enriquecimento nas razões do CM1', () => {
    const entrada = semComentarios(fs.readFileSync(raiz('src/screens/radar/comercialEntrada.ts'), 'utf8'));
    expect(entrada).toContain('dentroDaJanelaUX(s.detectadoEm, hoje)');
    expect(entrada).toContain('dentroDaJanelaUX(e.criadoEm, hoje)');
    expect(entrada).not.toContain('atualizadoEm');
    expect(entrada).toContain("RAZOES_SEM_DECISOR_UX: readonly CodigoRazaoCM[] = ['SEM_DECISOR', 'SEM_DECISOR_IDEAL_PARA_SINAL']");
    for (const proibido of [/\blead\b/i]) expect(entrada).not.toMatch(proibido);
  });

  it('SEM DECISOR != NOVO LEAD continua valendo na tela renderizada', () => {
    const html = htmlPanorama();
    expect(html).toContain('ENRIQUECIMENTO');
    expect(html).not.toMatch(/lead/i);
    expect(html).toContain('CONTA ADICIONADA AO RADAR');
  });

  it('a Entrada continua com no máximo três destaques e o Pipeline com três linhas', () => {
    const html = htmlPanorama();
    expect(html.split('SINAL NOVO').length - 1).toBe(1);
    expect(html.split('CONTA ADICIONADA AO RADAR').length - 1).toBe(1);
    expect(html.split('ENRIQUECIMENTO').length - 1).toBe(1);
  });

  it('CM2 segue governado: o CTA de cadência continua vindo do Hoje', () => {
    expect(CODIGO_HOJE).toContain('abrirAgendamentoCM(cadencia, sugestao)');
    expect(CODIGO_FOCO).not.toContain('ctaCadenciaCM');
    expect(CODIGO_FOCO).not.toContain('actions.');
  });

  it('nenhum motor, store ou rota foi tocado por este bloco', () => {
    for (const codigo of [CODIGO_FOCO, CODIGO_PANORAMA, CODIGO_TELEMETRIA_UX]) expect(codigo).not.toContain('../../data/store');
    // o Panorama importa so CATALOGOS de texto do motor; nenhuma das superficies chama funcao de fila
    for (const codigo of [CODIGO_FOCO, CODIGO_PANORAMA, CODIGO_TELEMETRIA_UX]) {
      for (const proibido of ['construirCommercialQueue', 'planosDaFilaCM', 'cadenciasDaFilaCM']) expect(codigo).not.toContain(proibido);
    }
    expect(CODIGO_TOUR).not.toContain('actions.');
  });
});
