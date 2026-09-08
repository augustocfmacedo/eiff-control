// Store: gerar abordagem termina em READY_FOR_REVIEW; revisao humana; SENT bloqueado; nada persiste fora do dataset local.
import { beforeAll, describe, expect, it } from 'vitest';
import { RegraDeNegocioError, actions, getState } from './store';

const radar = () => getState().ds.radar;

describe('comunicação no store (human-in-the-loop)', () => {
  let empresaId = '';
  beforeAll(() => {
    actions.trocarUsuario('u-admin'); actions.restaurarPlanilha();
    actions.importarCsvRadar(['Razão Social;CNPJ;Cidade;UF;Setor;Funcionários', 'Indústria Fictícia LTDA;11.222.333/0001-81;Goiânia;GO;Indústria;1500'].join('\n'), { tipo: 'empresas' });
    empresaId = radar().empresas.find((e) => e.cnpj === '11222333000181')!.id;
    actions.importarCsvRadar(['Nome;Cargo;Email;Celular;CNPJ', 'Executivo Fictício;Chief executive officer;ceo@if.invalid;62999990000;11.222.333/0001-81'].join('\n'), { tipo: 'contatos' });
  });
  it('sem sinal verificado ainda gera (sem fato de sinal); geração termina em READY_FOR_REVIEW e nunca em SENT', () => {
    const c = actions.gerarComunicacaoRadar(empresaId, { canal: 'WHATSAPP' });
    expect(c.estado).toBe('READY_FOR_REVIEW'); expect(c.objetivo).toBe('GET_REFERRAL'); expect(c.playbook).toBe('ACCESS_VIA_EXECUTIVE');
    expect(c.resultado.versaoPrincipal).toContain('Executivo,'); expect(c.resultado.versaoPrincipal).not.toContain('Acompanhei que');
    expect(radar().comunicacoes).toHaveLength(1); expect(radar().oportunidades).toHaveLength(0);
    expect(() => actions.transicionarComunicacaoRadar(c.id, 'SENT')).toThrow(/Envio não/);
    expect(() => actions.transicionarComunicacaoRadar(c.id, 'REJECTED')).toThrow(/Motivo/);
    const ed = actions.editarComunicacaoRadar(c.id, c.resultado.versaoPrincipal + '\n\nPS: até breve.');
    expect(ed.estado).toBe('READY_FOR_REVIEW'); expect(ed.textoEditado).toContain('PS:');
    const ap = actions.transicionarComunicacaoRadar(c.id, 'APPROVED');
    expect(ap.estado).toBe('APPROVED'); expect(ap.historico.map((h) => h.para)).toEqual(['READY_FOR_REVIEW', 'APPROVED']);
    expect(() => actions.transicionarComunicacaoRadar(c.id, 'SENT')).toThrow(RegraDeNegocioError);
    expect(radar().comunicacoes.every((x) => x.estado !== 'SENT')).toBe(true);
    expect(getState().ds.auditoria.some((a) => a.acao === 'radar_gerar_comunicacao' && a.entidadeId === c.id)).toBe(true);
  });
  it('rejeitar com motivo; contato sem canal não gera', () => {
    const c = actions.gerarComunicacaoRadar(empresaId, { canal: 'EMAIL' });
    expect(c.resultado.assunto).toBeTruthy();
    expect(actions.transicionarComunicacaoRadar(c.id, 'REJECTED', { motivo: 'tom errado' }).estado).toBe('REJECTED');
    expect(() => actions.gerarComunicacaoRadar('inexistente')).toThrow(/não encontrada/);
  });
});
