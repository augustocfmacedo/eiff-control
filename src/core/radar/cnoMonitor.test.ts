// LE3-E — o monitor decide com metadados; a janela nao apaga historico; nenhum scheduler escreve sozinho.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { JANELA_DESCOBERTA_DIAS, decidirMonitor, planoExecucaoAgendada, registrosARemoverAoSairDaJanela } from './cnoMonitor';
import { CONFIRMACAO_PILOTO } from './leadEngineBatchIntake';

const A = { etag: '"76bb7f934f457be4234c5733ee92b40b"', lastModified: 'Sat, 12 Sep 2026 04:59:45 GMT', contentLength: 330628581 };
const B = { etag: '"outra"', lastModified: 'Mon, 05 Oct 2026 04:00:00 GMT', contentLength: 331000000 };

describe('LE3-E · monitor de snapshot', () => {
  it('12 · mesmo snapshot encerra sem download e sem pipeline pesado', () => {
    const d = decidirMonitor(A, { ...A });
    expect(d.acao).toBe('ENCERRAR_SEM_DOWNLOAD');
    expect(d.comparacao).toBe('MESMO_SNAPSHOT');
    const plano = planoExecucaoAgendada(d, { executar: false });
    expect(plano).toMatchObject({ monitorar: true, baixarEProcessar: false, planejarIntake: false, escrever: false });
  });

  it('13 · snapshot novo permite planejamento; indeterminado também processa; primeira execução processa', () => {
    expect(decidirMonitor(A, B)).toMatchObject({ acao: 'PROCESSAR', comparacao: 'SNAPSHOT_NOVO' });
    expect(decidirMonitor({}, {})).toMatchObject({ acao: 'PROCESSAR', comparacao: 'INDETERMINADO' });
    expect(decidirMonitor(undefined, A)).toMatchObject({ acao: 'PROCESSAR', comparacao: 'SEM_ESTADO_ANTERIOR' });
    const plano = planoExecucaoAgendada(decidirMonitor(A, B), { executar: false });
    expect(plano).toMatchObject({ baixarEProcessar: true, planejarIntake: true, escrever: false, modo: 'SIMULACAO' });
    // o descritor a gravar como "visto" e sempre o ATUAL, para ser persistido so depois do processamento
    expect(decidirMonitor(A, B).descritorAtual).toEqual(B);
  });

  it('15 · nenhum scheduler escreve sem o hard gate próprio do runner', () => {
    const novo = decidirMonitor(A, B);
    expect(planoExecucaoAgendada(novo, { executar: true }).escrever).toBe(false);                         // RECUSADO
    expect(planoExecucaoAgendada(novo, { executar: false, confirmar: CONFIRMACAO_PILOTO }).escrever).toBe(false); // SIMULACAO
    expect(planoExecucaoAgendada(novo, { executar: true, confirmar: CONFIRMACAO_PILOTO }).escrever).toBe(true);   // so as duas juntas
    // e mesmo com as duas flags, snapshot igual nunca escreve: nao ha o que planejar
    expect(planoExecucaoAgendada(decidirMonitor(A, { ...A }), { executar: true, confirmar: CONFIRMACAO_PILOTO }).escrever).toBe(false);
    // o prototipo do monitor no script nao chama o runner de escrita nem persiste Radar
    const script = readFileSync('scripts/cno.mts', 'utf8');
    const bloco = script.slice(script.indexOf('async function monitor('), script.indexOf('// ------------------------------------------------------------------------------------------------ cli'));
    // pode MENCIONAR o runner na mensagem de proximo passo; nao pode invoca-lo nem escrever
    for (const p of ['aplicarEmProducao', 'spawnSync', 'spawn(', 'exec(', "import('", 'supabase', 'Supabase', 'INSERT', 'persistir', "'--executar'", 'linhasCompletas', 'juntarOrdenadoCno']) expect(bloco).not.toContain(p);
    expect(bloco).toContain("'HEAD'");
    expect(bloco).toContain('ENCERRAR_SEM_DOWNLOAD');
  });

  it('11 · a janela de 90 dias controla descoberta, não histórico: o conjunto a remover é sempre vazio', () => {
    expect(JANELA_DESCOBERTA_DIAS).toBe(90);
    expect(registrosARemoverAoSairDaJanela([{ id: 'antiga', eventoEm: '2020-01-01' }, { id: 'x' }])).toEqual([]);
    const core = readFileSync('src/core/radar/cnoMonitor.ts', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const p of ['delete', 'DELETE', 'apagar', 'remover(', 'splice', 'filter((r)']) expect(core).not.toContain(p);
  });

  it('14 · a idempotência continua sendo a do LE-1: o monitor não tem fingerprint próprio', () => {
    const core = readFileSync('src/core/radar/cnoMonitor.ts', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const p of ['sha256', 'createHash', 'hashCanonico', 'payloadFingerprint', 'fetch(', 'node:fs', 'process.env', 'supabase']) expect(core).not.toContain(p);
    expect(core).toContain("from './cnoSnapshot'");
    expect(core).toContain("from './leadEngineBatchIntake'");
  });
});
