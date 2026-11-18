// CD-D3/E5 — bloqueador de release: uma meta que o banco já aceitou nunca é reenviada na retomada da sincronização.
//
// Banco simulado com a regra da RPC radar_definir_meta_comercial (E2): mesmo valor da vigente não cria versão; valor
// diferente cria a próxima versão. Reproduz o defeito (sem a base avançada, a retomada recria o valor antigo sobre o
// mais novo de outra sessão) e prova a correção (a versão aceita entra na base na hora, por `aoGravarMeta`).
import { describe, expect, it } from 'vitest';
import { carregarRadar, persistirRadar, type HelpersRadar } from './radar.supabase';
import { comMetaGravada } from './metaConfirmada';
import { radarVazio, type RadarDataset, type VersaoMetaComercial } from '../core/radar';

interface VersaoBanco { versao: number; valor: number | null; motivo: string; por: string }
/** Banco simulado: versões da meta por mês, com a regra da RPC da E2. */
function bancoDeMetas() {
  const porMes = new Map<string, VersaoBanco[]>();
  const vigente = (mes: string) => (porMes.get(mes) ?? []).at(-1);
  const definir = (mes: string, valor: number | null, motivo: string, por: string) => {
    const lista = porMes.get(mes) ?? [];
    const v = vigente(mes);
    if (v && v.valor === valor) return { alterado: false }; // E2: mesmo valor da vigente não cria versão
    lista.push({ versao: lista.length + 1, valor, motivo, por });
    porMes.set(mes, lista);
    return { alterado: true };
  };
  return { porMes, vigente, definir };
}

function helpers(banco: ReturnType<typeof bancoDeMetas>, o: { falharNaChamada?: number } = {}): HelpersRadar & { rpcs: string[]; gravacoes: string[] } {
  const rpcs: string[] = []; const gravacoes: string[] = [];
  let n = 0;
  return {
    rpcs, gravacoes,
    sel: async () => [] as never,
    gravar: async (tabela, filtro) => { gravacoes.push(tabela); return { id: String(filtro.id ?? 'novo') }; },
    gravarComposta: async (tabela) => { gravacoes.push(tabela); },
    inserir: async (tabela, rows) => { gravacoes.push(tabela); return rows.map((_, i) => ({ id: `ins-${i}` })); },
    apagar: async () => undefined,
    orgId: 'org-1', atorId: 'perfil-ator', uuid: () => null, perfil: () => null,
    rpc: async (nome, args) => {
      n++;
      if (o.falharNaChamada === n) throw new Error('rpc radar_definir_meta_comercial: falha');
      rpcs.push(`${String(args.p_mes).slice(0, 7)}=${args.p_valor === null ? 'retirada' : args.p_valor}`);
      return banco.definir(String(args.p_mes).slice(0, 7), args.p_valor as number | null, String(args.p_motivo), 'esta sessão');
    },
    motivoDono: () => undefined,
  };
}
const versao = (id: string, mes: string, versao: number, valor: VersaoMetaComercial['valor'], motivo = 'meta aprovada'): VersaoMetaComercial =>
  ({ id, mes, metrica: 'RECEITA_GANHA', moeda: 'BRL', escopo: 'ORGANIZACAO', valor, versao, motivo, definidaPor: 'u-adm', definidaEm: '2026-10-14T12:00:00.000Z' });
const com = (metas: VersaoMetaComercial[], extra: Partial<RadarDataset> = {}): RadarDataset => ({ ...radarVazio(), metasComerciais: metas, ...extra });
const ds = (radar: RadarDataset) => ({ radar });

describe('E5 · aoGravarMeta: aviso a cada meta aceita, na hora', () => {
  it('cada RPC aceita é avisada em ordem; a que falha não é avisada (e as seguintes não são enviadas)', async () => {
    const banco = bancoDeMetas();
    const h = helpers(banco, { falharNaChamada: 2 });
    const avisadas: string[] = [];
    await carregarRadar(h);
    const depois = com([versao('L1', '2026-10', 1, 100000), versao('L2', '2026-11', 1, 200000), versao('L3', '2026-12', 1, 300000)]);
    await expect(persistirRadar({ ...h, aoGravarMeta: (m) => avisadas.push(m.id) }, com([]), depois)).rejects.toThrow(/falha/);
    expect(avisadas).toEqual(['L1']);
    expect(h.rpcs).toEqual(['2026-10=100000']);
  });

  it('comMetaGravada: só a lista de metas muda; o resto da base é o mesmo objeto; idempotente', () => {
    const base = ds(com([], { empresas: [] }));
    const m = versao('L1', '2026-10', 1, 100000);
    const nova = comMetaGravada(base, m);
    expect(nova.radar.metasComerciais).toEqual([m]);
    expect(nova.radar.empresas).toBe(base.radar.empresas);
    expect(comMetaGravada(nova, m)).toBe(nova);
    expect(base.radar.metasComerciais).toEqual([]); // não muta a base original
  });
});

describe('E5 · retomada depois de falha POSTERIOR à meta (Tentar de novo / pendência offline)', () => {
  /** Uma rodada: a meta é aceita (RPC) e algo depois na mesma rodada falha. Devolve a base que a retomada usará. */
  async function rodadaComFalhaPosterior(banco: ReturnType<typeof bancoDeMetas>, antes: RadarDataset, depois: RadarDataset, corrigido: boolean) {
    const h = helpers(banco);
    await carregarRadar(h);
    let base = ds(antes);
    await persistirRadar({ ...h, aoGravarMeta: corrigido ? (m) => { base = comMetaGravada(base, m); } : undefined }, antes, depois);
    // ... e uma operação POSTERIOR da mesma rodada (Inbox, auditoria, complemento) falha: a fila não avança a base inteira
    return { base: base.radar, h };
  }

  it('DEFEITO reproduzido (sem a correção): outra sessão muda a meta e a retomada recria o valor antigo por cima', async () => {
    const banco = bancoDeMetas();
    const depois = com([versao('L1', '2026-10', 1, 250000)]);
    const { base } = await rodadaComFalhaPosterior(banco, com([]), depois, false);
    banco.definir('2026-10', 300000, 'revisão da outra sessão', 'outra sessão');
    const h2 = helpers(banco);
    await persistirRadar(h2, base, depois); // retomada com a base antiga
    expect(h2.rpcs).toEqual(['2026-10=250000']);
    expect(banco.vigente('2026-10')).toMatchObject({ versao: 3, valor: 250000 }); // o antigo voltou por cima do 300.000
  });

  it('CORRIGIDO: a meta aceita entra na base na hora; a retomada não a reenvia e a versão da outra sessão continua valendo', async () => {
    const banco = bancoDeMetas();
    const depois = com([versao('L1', '2026-10', 1, 250000)]);
    const { base } = await rodadaComFalhaPosterior(banco, com([]), depois, true);
    expect(base.metasComerciais!.map((m) => m.id)).toEqual(['L1']);
    banco.definir('2026-10', 300000, 'revisão da outra sessão', 'outra sessão');
    const h2 = helpers(banco);
    await persistirRadar(h2, base, depois);
    expect(h2.rpcs).toEqual([]);
    expect(banco.vigente('2026-10')).toMatchObject({ versao: 2, valor: 300000, por: 'outra sessão' });
    expect(banco.porMes.get('2026-10')!.map((v) => v.valor)).toEqual([250000, 300000]);
  });

  it('as alterações dos outros módulos continuam pendentes: a retomada grava a empresa, não a meta', async () => {
    const banco = bancoDeMetas();
    const empresa = { id: 'EMP-1', razaoSocial: 'Conta Reenvio Fictícia', pais: 'BR', observacoes: '', ativo: true, criadoEm: '2026-10-14', atualizadoEm: '2026-10-14', fitScore: 50, intentScore: 50, timingScore: 50, relationshipScore: 50, dataQualityScore: 50, priorityScore: 50, priorityClass: 'C' } as RadarDataset['empresas'][number];
    const depois = com([versao('L1', '2026-10', 1, 250000)], { empresas: [empresa] });
    // a rodada que falhou depois da meta: a empresa (escrita genérica) é da MESMA rodada, mas a base só avança a meta
    const { base } = await rodadaComFalhaPosterior(banco, com([]), depois, true);
    expect(base.empresas).toEqual([]);
    const h2 = helpers(banco);
    await persistirRadar(h2, base, depois);
    expect(h2.rpcs).toEqual([]);
    expect(h2.gravacoes).toContain('radar_company');
  });

  it('várias metas na rodada e falha no meio: só a que falhou e as seguintes voltam na retomada', async () => {
    const banco = bancoDeMetas();
    const h = helpers(banco, { falharNaChamada: 2 });
    await carregarRadar(h);
    const depois = com([versao('L1', '2026-10', 1, 100000), versao('L2', '2026-11', 1, 200000), versao('L3', '2026-12', 1, 300000)]);
    let base = ds(com([]));
    await expect(persistirRadar({ ...h, aoGravarMeta: (m) => { base = comMetaGravada(base, m); } }, base.radar, depois)).rejects.toThrow();
    const h2 = helpers(banco);
    await persistirRadar(h2, base.radar, depois);
    expect(h2.rpcs).toEqual(['2026-11=200000', '2026-12=300000']);
    expect([...banco.porMes.keys()].sort()).toEqual(['2026-10', '2026-11', '2026-12']);
    expect([...banco.porMes.values()].every((l) => l.length === 1)).toBe(true); // nenhuma versão duplicada
  });
});
