// Commercial UX 1.0 — UX-6: catalogo de eventos de INTERFACE da Maquina Comercial.
//
// Isto NAO e um segundo modulo de telemetria: nao guarda nada, nao tem armazenamento proprio, nao fala com rede.
// E so um catalogo de nomes + um atalho que chama o `registrarAcao` que ja existe em `src/data/telemetria.ts`
// (local, anonimo, localStorage, sem servidor).
//
// O que pode entrar num evento: o NOME da interacao. Nada mais.
// O que NUNCA entra: empresaId, contatoId, oportunidadeId, itemId, nome, telefone, e-mail, valor, texto de
// comunicacao ou qualquer payload comercial — por isso a funcao aceita apenas um nome do catalogo fechado.
//
// Visita de tela ja e registrada globalmente pelo App (`registrarVisita('/radar/hoje')`): nada aqui duplica isso.
import { registrarAcao } from '../../data/telemetria';

export const EVENTOS_COMERCIAIS_UX = {
  visaoPanorama: 'comercial:visao:panorama',
  visaoFoco: 'comercial:visao:foco',
  visaoFila: 'comercial:visao:fila',
  porQueAbrir: 'comercial:porque:abrir',
  focoProxima: 'comercial:foco:proxima',
  focoAnterior: 'comercial:foco:anterior',
  focoSelecionarDepois: 'comercial:foco:selecionar-depois',
  focoPrimeiraDisponivel: 'comercial:foco:primeira-disponivel',
  pipelineAbrir: 'comercial:pipeline:abrir',
  entradaInteligencia: 'comercial:entrada:abrir-inteligencia',
} as const;

export type EventoComercialUX = (typeof EVENTOS_COMERCIAIS_UX)[keyof typeof EVENTOS_COMERCIAIS_UX];

/** Registra UMA interacao de interface. O tipo fecha o catalogo: nao ha como passar um id aqui. */
export function registrarEventoComercial(evento: EventoComercialUX): void {
  registrarAcao(evento);
}
