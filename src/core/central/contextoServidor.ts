// EIFF Central — Wave 03 F2-WEBHOOK: leitura PURA das variaveis do servidor para o contexto do Alpha.
//
// A funcao Netlify le o ambiente e entrega um `VariaveisCentralServidor` como DADOS; aqui nao existe acesso ao
// ambiente (nenhum arquivo de src/ le o ambiente: guarda em seguranca.test.ts). Tudo e fail-closed: qualquer
// variavel ausente ou invalida devolve `pronto: false` com o motivo, e o webhook se comporta exatamente como antes
// (conta e descarta). Contrato congelado em servidorContratos.ts.
import { normalizarTelefone } from '../radar/canais';
import { FLOW_VERSION, type ContextoCentralServidor, type MotivoContextoFechado, type VariaveisCentralServidor } from './servidorContratos';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA = /^[0-9a-f]{7,64}$/i;

const limpo = (v: string | undefined): string | undefined => {
  const t = (v ?? '').trim();
  return t || undefined;
};

/**
 * Allowlist do Alpha (D4): lista separada por virgula, ponto e virgula ou quebra de linha (espaco NAO separa: um numero
 * pode vir formatado, "+55 (62) 97777-6666"); cada item passa por `normalizarTelefone`; invalido e descartado em silencio.
 */
export function lerAllowlist(bruto: string | undefined): ReadonlySet<string> {
  const numeros = (bruto ?? '')
    .split(/[,;\r\n]+/)
    .map((x) => normalizarTelefone(x))
    .filter((x): x is string => !!x);
  return new Set(numeros);
}

/** SHA do deploy (COMMIT_REF do Netlify) so quando parece um SHA; qualquer outra coisa vira ausente, nunca texto livre no banco. */
export const lerEngineSha = (bruto: string | undefined): string | undefined => {
  const t = limpo(bruto);
  return t && SHA.test(t) ? t.toLowerCase() : undefined;
};

/**
 * Resolve o contexto do servidor. Ordem das verificacoes (a primeira que falha decide o motivo):
 * modo != 'on' -> modo_off; organizacao ausente -> organizacao_ausente; organizacao nao uuid -> organizacao_invalida;
 * numero INTERNAL ausente -> numeros_ausentes; allowlist sem numero valido -> allowlist_vazia.
 * `numeros` e `numerosPermitidos` sao devolvidos mesmo quando fechado (o log da funcao pode explicar o que faltou), mas
 * NADA de negocio deve rodar com `pronto: false`.
 */
export function resolverContextoCentral(v: VariaveisCentralServidor): ContextoCentralServidor {
  const modo = limpo(v.CENTRAL_ALPHA_MODE) === 'on' ? 'on' : 'off';
  const numeros = { interno: limpo(v.EIFF_CENTRAL_PHONE_NUMBER_ID), externo: limpo(v.EIFF_COMMERCIAL_PHONE_NUMBER_ID) };
  const numerosPermitidos = lerAllowlist(v.CENTRAL_ALPHA_NUMBERS);
  const organizacao = limpo(v.EIFF_CENTRAL_ORGANIZATION_ID);
  const base = { modo, numeros, numerosPermitidos, engineSha: lerEngineSha(v.COMMIT_REF), flowVersion: FLOW_VERSION } as const;
  const fechado = (motivo: MotivoContextoFechado): ContextoCentralServidor => ({ ...base, pronto: false, motivo });

  if (modo !== 'on') return fechado('modo_off');
  if (!organizacao) return fechado('organizacao_ausente');
  if (!UUID.test(organizacao)) return fechado('organizacao_invalida');
  if (!numeros.interno) return fechado('numeros_ausentes');
  if (numerosPermitidos.size === 0) return fechado('allowlist_vazia');
  return { ...base, pronto: true, organizationId: organizacao.toLowerCase() };
}
