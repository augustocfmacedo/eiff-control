// Higiene do catalogo de playbooks: nenhuma regra pode carregar a frase que presume responsabilidade do destinatario.
// A divida vinha do REFERRAL_INTRODUCTION, que citava a abertura antiga como exemplo dentro do proprio catalogo.
import { describe, expect, it } from 'vitest';
import { PLAYBOOKS, PLAYBOOK_VERSION } from './comunicacao';
import { aberturaNeutra } from './comunicacaoGeracao';

const PROIBIDAS = [/cheguei ao seu contato como respons[aá]vel/i, /voc[eê] (?:conduz|lidera) essa frente/i, /seu nome como respons[aá]vel/i];

describe('higiene do catálogo de playbooks', () => {
  const textos = Object.values(PLAYBOOKS).flatMap((p) => [...p.fazer, ...p.naoFazer, ...p.elementosObrigatorios, ...p.elementosProibidos, ...p.objecoes.flatMap((o) => [o.gatilho, o.intencao])].filter((t) => typeof t === 'string'));
  it('nenhuma regra de playbook repete a frase que presume responsabilidade do contato', () => {
    for (const t of textos) for (const re of PROIBIDAS) expect(t, `regra de playbook: "${t}"`).not.toMatch(re);
  });
  it('REFERRAL_INTRODUCTION aponta para a abertura neutra do objetivo, não para um texto fechado', () => {
    const fazer = PLAYBOOKS.REFERRAL_INTRODUCTION.fazer.join(' ');
    expect(fazer).toMatch(/abertura neutra/i);
    expect(fazer).toMatch(/sourceDisclosure ALLOWED/);
    expect(aberturaNeutra('GET_REFERRAL')).not.toMatch(/respons[aá]vel/i);
    expect(aberturaNeutra('START_DISCOVERY')).not.toMatch(/respons[aá]vel/i);
  });
  it('a versão do playbook subiu junto com a mudança de regra', () => {
    const [maior, menor] = PLAYBOOK_VERSION.split('.').map(Number);
    expect(maior * 100 + menor).toBeGreaterThanOrEqual(102); // >= 1.2
  });
});
