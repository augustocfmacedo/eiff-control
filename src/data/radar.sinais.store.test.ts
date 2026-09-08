// Signal Pilot 01: prontidao para receber sinais pesquisados externamente. Dado ficticio, so em memoria (modo local).
import { beforeAll, describe, expect, it } from 'vitest';
import { actions, getState } from './store';
import { filaHoje, recomendarAcao, visaoSignalPilot } from '../core/radar';
import { linhaDb, type ChaveRadar } from './radar.supabase';

const radar = () => getState().ds.radar;

describe('Signal Pilot 01: inclusão manual de sinal', () => {
  beforeAll(() => { actions.trocarUsuario('u-admin'); actions.restaurarPlanilha(); });

  it('persiste os 13 campos, recalcula score/TIMING/INTENT, guarda a explicação no snapshot e atualiza Signal Pilot e Hoje', () => {
    const hoje = getState().ds.params.dataBase;
    actions.importarCsvRadar(`business_name,business_domain,business_region,business_country_name,business_number_of_employees_range,business_id\nZZ Fictícia Sinal Teste,zzficticia.com.br,goiás,brazil,201-500,${'f'.repeat(32)}`, { tipo: 'empresas', fonteId: 'FONTE-VIBE', arquivo: 'teste-ficticio' });
    actions.importarCsvRadar(`prospect_id,prospect_full_name,prospect_job_title,prospect_job_seniority_level,contact_professional_email,contact_professional_email_status,business_id,business_name\n${'e'.repeat(40)},Fulana Fictícia,Chief executive officer,cxo,fulana@zzficticia.com.br,valid,${'f'.repeat(32)},ZZ Fictícia Sinal Teste`, { tipo: 'contatos', fonteId: 'FONTE-VIBE', arquivo: 'teste-ficticio' });
    const e0 = radar().empresas.find((e) => e.razaoSocial === 'ZZ Fictícia Sinal Teste')!;
    expect(e0).toBeTruthy();
    const antes = { timing: e0.timingScore, intent: e0.intentScore, total: e0.priorityScore, snapshots: radar().snapshotsScore.filter((s) => s.empresaId === e0.id).length };
    expect(antes.timing).toBe(0); expect(antes.intent).toBe(0);
    expect(recomendarAcao(e0, radar(), hoje).estado).toBe('RESEARCH_SIGNALS');
    expect(visaoSignalPilot(radar(), hoje, ['ZZ Fictícia Sinal Teste'])[0]).toMatchObject({ encontrada: true, signalCount: 0, recommendedAction: 'RESEARCH_SIGNALS', estadoCrm: 'RESEARCH_SIGNALS', whyNow: 'Sem sinal recente' });
    const fonteNews = radar().fontes.find((f) => f.codigo === 'NEWS')!;

    // inclusao manual com todos os campos que a pesquisa externa vai trazer
    const s = actions.registrarSinalRadar({ empresaId: e0.id, tipo: 'NEW_FACTORY', titulo: 'Anuncia nova fábrica (fictício)', descricao: 'Descrição fictícia do sinal', eventoEm: '2026-09-01', confianca: 0.8, url: 'https://exemplo.invalid/noticia-ficticia', fonteId: fonteNews.id, verificado: true, payload: { trecho: 'texto bruto fictício', origem: 'teste' }, externoId: 'ext-ficticio-1' });
    expect(s).toMatchObject({ empresaId: e0.id, tipo: 'NEW_FACTORY', titulo: 'Anuncia nova fábrica (fictício)', descricao: 'Descrição fictícia do sinal', eventoEm: '2026-09-01', fonteId: fonteNews.id, url: 'https://exemplo.invalid/noticia-ficticia', verificado: true, payload: { trecho: 'texto bruto fictício', origem: 'teste' } });
    expect(s.detectadoEm).toBeTruthy(); expect(s.scoreBase).toBeGreaterThan(0);
    expect(s.confianca).toBeCloseTo(0.8 * fonteNews.confiabilidade, 3); // confianca informada x confiabilidade da fonte
    expect(s.scoreEfetivo).toBeCloseTo(Math.round(s.scoreBase * s.confianca * 10) / 10, 1);
    expect(radar().sinais.find((x) => x.id === s.id)).toBeTruthy();

    // mapeamento de persistencia: as 13 colunas de radar_signal
    const ref = (_c: ChaveRadar, id?: string) => id ?? null;
    const row = linhaDb('sinais', s, ref, { orgId: 'org', atorId: 'ator', uuid: (v?: string) => v ?? null, perfil: (v?: string) => v ?? null } as never);
    for (const col of ['company_id', 'signal_type', 'title', 'description', 'event_at', 'detected_at', 'source_id', 'original_url', 'confidence', 'base_score', 'effective_score', 'verified', 'raw_payload']) expect(row).toHaveProperty(col);
    expect(row).toMatchObject({ company_id: e0.id, signal_type: 'NEW_FACTORY', title: 'Anuncia nova fábrica (fictício)', source_id: fonteNews.id, original_url: 'https://exemplo.invalid/noticia-ficticia', verified: true, raw_payload: { trecho: 'texto bruto fictício', origem: 'teste' } });
    expect(row.base_score).toBe(s.scoreBase); expect(row.effective_score).toBe(s.scoreEfetivo); expect(row.confidence).toBe(s.confianca);

    // recalculo da empresa: TIMING e INTENT sobem, score total sobe, snapshot novo com explicacao
    // NEW_FACTORY alimenta TIMING (regras padrao); INTENT e recalculado (dimensao no snapshot) e reage a tipos como INVESTMENT
    const e1 = radar().empresas.find((e) => e.id === e0.id)!;
    expect(e1.timingScore).toBeGreaterThan(antes.timing); expect(e1.priorityScore).toBeGreaterThan(antes.total);
    const snaps = radar().snapshotsScore.filter((x) => x.empresaId === e0.id);
    expect(snaps.length).toBe(antes.snapshots + 1);
    const ultimo = snaps[snaps.length - 1];
    expect(ultimo).toMatchObject({ timing: e1.timingScore, intent: e1.intentScore, total: e1.priorityScore, classe: e1.priorityClass });
    expect(ultimo.explicacao.dimensoes.map((d) => d.dimensao)).toEqual(expect.arrayContaining(['FIT', 'TIMING', 'INTENT', 'RELATIONSHIP', 'DATA_QUALITY']));
    expect(JSON.stringify(ultimo.explicacao)).toContain('Nova fábrica');

    const s2 = actions.registrarSinalRadar({ empresaId: e0.id, tipo: 'INVESTMENT', titulo: 'Investimento anunciado (fictício)', eventoEm: '2026-09-05', confianca: 1, fonteId: fonteNews.id, verificado: false });
    const e2 = radar().empresas.find((e) => e.id === e0.id)!;
    expect(e2.intentScore).toBeGreaterThan(antes.intent); expect(e2.priorityScore).toBeGreaterThan(e1.priorityScore);
    const ultimo2 = radar().snapshotsScore.filter((x) => x.empresaId === e0.id).at(-1)!;
    expect(ultimo2.intent).toBe(e2.intentScore); expect(JSON.stringify(ultimo2.explicacao)).toContain('Investimento anunciado');
    expect(radar().sinais.find((x) => x.id === s2.id)?.verificado).toBe(false);

    // Signal Pilot e Hoje/proxima acao refletem os sinais sem nada alem do commit do store
    const sp = visaoSignalPilot(radar(), hoje, ['ZZ Fictícia Sinal Teste'])[0];
    expect(sp).toMatchObject({ signalCount: 2, timingScore: e2.timingScore, intentScore: e2.intentScore, estadoCrm: 'CONTACT_NOW' }); expect(['CONTACT_NOW', 'RESEARCH_PROJECT', 'FIND_BETTER_DECISION_MAKER']).toContain(sp.recommendedAction); // matriz operacional (confianca 0,8 x confiabilidade da fonte)
    expect(sp.strongestSignal).toContain('fictício'); expect(sp.signalDate).toMatch(/^2026-09-0[15]$/); expect(sp.confidence).toBeGreaterThan(0);
    const e1b = e2;
    const rec = recomendarAcao(e1b, radar(), hoje);
    expect(rec.estado).toBe('CONTACT_NOW'); expect(rec.contato?.contato.nome).toBe('Fulana Fictícia');
    const fila = filaHoje(radar(), hoje);
    const pos = fila.findIndex((i) => i.empresa.id === e0.id);
    expect(pos).toBeGreaterThanOrEqual(0);
    expect(fila[pos].empresa.priorityScore).toBe(e1b.priorityScore);
    for (const item of fila.slice(0, pos)) expect(item.empresa.priorityScore).toBeGreaterThanOrEqual(e1b.priorityScore);
  });
});
