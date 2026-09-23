// LE-3B — "o snapshot mudou?" e a unica pergunta que evita reler 1,4 GB a toa.
import { describe, expect, it } from 'vitest';
import { compararSnapshot, devePularProcessamento } from './cnoSnapshot';

const A = { etag: '"76bb7f934f457be4234c5733ee92b40b"', lastModified: 'Sat, 12 Sep 2026 04:59:45 GMT', contentLength: 330628581 };

describe('LE-3B · descritor do snapshot', () => {
  it('ETag igual → MESMO_SNAPSHOT, mesmo que Last-Modified varie de forma (a ETag manda)', () => {
    expect(compararSnapshot(A, { ...A })).toBe('MESMO_SNAPSHOT');
    expect(compararSnapshot(A, { ...A, lastModified: 'outra' })).toBe('MESMO_SNAPSHOT');
    // ETag fraca ou sem aspas e a mesma ETag
    expect(compararSnapshot(A, { ...A, etag: 'W/"76bb7f934f457be4234c5733ee92b40b"' })).toBe('MESMO_SNAPSHOT');
    expect(compararSnapshot(A, { ...A, etag: '76bb7f934f457be4234c5733ee92b40b' })).toBe('MESMO_SNAPSHOT');
  });

  it('ETag diferente → SNAPSHOT_NOVO', () => {
    expect(compararSnapshot(A, { ...A, etag: '"outra"' })).toBe('SNAPSHOT_NOVO');
  });

  it('sem ETag: Last-Modified + tamanho iguais → MESMO_SNAPSHOT; qualquer um diferente → SNAPSHOT_NOVO', () => {
    const semEtag = { lastModified: A.lastModified, contentLength: A.contentLength };
    expect(compararSnapshot(semEtag, { ...semEtag })).toBe('MESMO_SNAPSHOT');
    expect(compararSnapshot(semEtag, { ...semEtag, contentLength: 1 })).toBe('SNAPSHOT_NOVO');
    expect(compararSnapshot(semEtag, { ...semEtag, lastModified: 'Sun, 13 Sep 2026 00:00:00 GMT' })).toBe('SNAPSHOT_NOVO');
    // um lado com ETag e o outro sem: cai na regra de Last-Modified + tamanho
    expect(compararSnapshot(A, semEtag)).toBe('MESMO_SNAPSHOT');
  });

  it('metadata insuficiente → INDETERMINADO, nunca "mesmo" por palpite', () => {
    expect(compararSnapshot({}, {})).toBe('INDETERMINADO');
    expect(compararSnapshot({ lastModified: A.lastModified }, { lastModified: A.lastModified })).toBe('INDETERMINADO');
    expect(compararSnapshot({ contentLength: 1 }, { contentLength: 1 })).toBe('INDETERMINADO');
    // mas metadata parcial que ja DIVERGE e evidencia de mudanca
    expect(compararSnapshot({ contentLength: 1 }, { contentLength: 2 })).toBe('SNAPSHOT_NOVO');
    expect(compararSnapshot({ lastModified: 'a' }, { lastModified: 'b' })).toBe('SNAPSHOT_NOVO');
  });

  it('só MESMO_SNAPSHOT autoriza pular o processamento', () => {
    expect(devePularProcessamento('MESMO_SNAPSHOT')).toBe(true);
    expect(devePularProcessamento('SNAPSHOT_NOVO')).toBe(false);
    expect(devePularProcessamento('INDETERMINADO')).toBe(false);
  });
});
