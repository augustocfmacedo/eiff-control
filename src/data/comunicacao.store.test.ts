// Store: ciclo completo human-in-the-loop com invariantes: geracao -> READY_FOR_REVIEW; edicao revalidada na aprovacao;
// SENT so com atividade de contato; REPLIED so com atividade com resultado; eventos no historico; idempotencia por hash.
import { beforeAll, describe, expect, it } from 'vitest';
import { RegraDeNegocioError, actions, getState } from './store';

const radar = () => getState().ds.radar;

describe('comunicação no store (human-in-the-loop)', () => {
  let empresaId = ''; let contatoId = '';
  beforeAll(() => {
    actions.trocarUsuario('u-admin'); actions.restaurarPlanilha();
    actions.importarCsvRadar(['Razão Social;CNPJ;Cidade;UF;Setor;Funcionários', 'Indústria Fictícia LTDA;11.222.333/0001-81;Goiânia;GO;Indústria;1500'].join('\n'), { tipo: 'empresas' });
    empresaId = radar().empresas.find((e) => e.cnpj === '11222333000181')!.id;
    actions.importarCsvRadar(['nome,cargo,email,telefone,empresa', 'Executivo Fictício,Chief executive officer,ceo@if.invalid,62999990000,Indústria Fictícia LTDA'].join('\n'), { tipo: 'contatos' });
    contatoId = radar().contatos.find((c) => c.empresaId === empresaId)!.id;
  });
  it('geração termina em READY_FOR_REVIEW; mesmo contexto devolve o mesmo rascunho; SENT direto é bloqueado', () => {
    const c = actions.gerarComunicacaoRadar(empresaId, { canal: 'WHATSAPP' });
    expect(c.estado).toBe('READY_FOR_REVIEW'); expect(c.objetivo).toBe('GET_REFERRAL'); expect(c.contextHash).toMatch(/^[0-9a-f]{64}$/);
    expect(c.versoes).toMatchObject({ playbook: '1.1', contentSpec: '3', prompt: 'deterministico-2', provedor: 'deterministico' }); expect(c.validacao.ok).toBe(true);
    expect(actions.gerarComunicacaoRadar(empresaId, { canal: 'WHATSAPP' }).id).toBe(c.id); // idempotente
    expect(radar().comunicacoes).toHaveLength(1); expect(radar().oportunidades).toHaveLength(0);
    expect(() => actions.transicionarComunicacaoRadar(c.id, 'SENT', { atividadeId: 'x' })).toThrow(RegraDeNegocioError);
    expect(() => actions.transicionarComunicacaoRadar(c.id, 'REJECTED')).toThrow(/Motivo/);
  });
  it('edição humana inválida bloqueia a aprovação; edição válida aprova; SENT exige atividade real; REPLIED exige resultado; eventos registrados', () => {
    const c = radar().comunicacoes[0];
    const ruim = actions.editarComunicacaoRadar(c.id, c.resultado.versaoPrincipal + '\n\nGarantimos economia de 20% e entrego peso estimado e prazo.');
    expect(ruim.editadoPor).toBe('u-admin'); expect(ruim.editadoEm).toBeTruthy(); expect(ruim.resultado.versaoPrincipal).toBe(c.resultado.versaoPrincipal); // original preservado
    expect(() => actions.transicionarComunicacaoRadar(c.id, 'APPROVED')).toThrow(/fact gate/);
    actions.editarComunicacaoRadar(c.id, c.resultado.versaoPrincipal + '\n\nPS: obrigado pela atenção.');
    const ap = actions.transicionarComunicacaoRadar(c.id, 'APPROVED');
    expect(ap.estado).toBe('APPROVED'); expect(ap.aprovadoPor).toBe('u-admin'); expect(ap.aprovadoEm).toBeTruthy();
    expect(() => actions.transicionarComunicacaoRadar(c.id, 'SENT')).toThrow(/exige a atividade/);
    // nota interna nao vale como envio
    const nota = actions.registrarAtividadeRadar(actions.novaAtividadeRadar(empresaId, { contatoId, tipo: 'NOTE', canal: 'OTHER', notas: 'nota' }));
    const notaId = radar().atividades.find((a) => a.empresaId === empresaId && a.tipo === 'NOTE')!.id; void nota;
    expect(() => actions.transicionarComunicacaoRadar(c.id, 'SENT', { atividadeId: notaId })).toThrow(/Nota interna/);
    actions.registrarAtividadeRadar(actions.novaAtividadeRadar(empresaId, { contatoId, tipo: 'MESSAGE', canal: 'WHATSAPP', notas: 'enviado manualmente' }));
    const envio = radar().atividades.find((a) => a.empresaId === empresaId && a.tipo === 'MESSAGE')!;
    const sent = actions.transicionarComunicacaoRadar(c.id, 'SENT', { atividadeId: envio.id });
    expect(sent.estado).toBe('SENT'); expect(sent.atividadeEnvioId).toBe(envio.id); expect(sent.enviadaEm).toBe(envio.ocorreuEm);
    expect(() => actions.transicionarComunicacaoRadar(c.id, 'REPLIED', { atividadeId: envio.id })).toThrow(/resultado/);
    actions.registrarAtividadeRadar(actions.novaAtividadeRadar(empresaId, { contatoId, tipo: 'MESSAGE', canal: 'WHATSAPP', resultado: 'REFERRED_TO_OTHER_PERSON', notas: 'respondeu' }));
    const resposta = radar().atividades.find((a) => a.empresaId === empresaId && a.resultado === 'REFERRED_TO_OTHER_PERSON')!;
    const rep = actions.transicionarComunicacaoRadar(c.id, 'REPLIED', { atividadeId: resposta.id });
    expect(rep.estado).toBe('REPLIED'); expect(rep.atividadeRespostaId).toBe(resposta.id);
    expect(rep.historico.map((h) => h.para)).toEqual(['READY_FOR_REVIEW', 'APPROVED', 'SENT', 'REPLIED']);
    expect(getState().ds.auditoria.filter((a) => a.entidadeId === c.id).length).toBeGreaterThanOrEqual(5);
    // novo contexto (indicacao recebida) gera novo rascunho, sem sobrescrever o historico
    const c2 = actions.gerarComunicacaoRadar(empresaId, { canal: 'WHATSAPP' });
    expect(c2.id).not.toBe(c.id); expect(radar().comunicacoes).toHaveLength(2); expect(radar().comunicacoes.find((x) => x.id === c.id)!.estado).toBe('REPLIED');
    expect(radar().oportunidades).toHaveLength(0);
  });
  it('rejeitar com motivo e voltar à revisão por edição', () => {
    const c = actions.gerarComunicacaoRadar(empresaId, { canal: 'EMAIL' });
    expect(c.resultado.assunto).toBeTruthy();
    const rj = actions.transicionarComunicacaoRadar(c.id, 'REJECTED', { motivo: 'tom errado' });
    expect(rj.estado).toBe('REJECTED'); expect(rj.motivoRejeicao).toBe('tom errado'); expect(rj.rejeitadoPor).toBe('u-admin');
    expect(actions.editarComunicacaoRadar(c.id, c.resultado.versaoPrincipal, c.resultado.assunto).estado).toBe('READY_FOR_REVIEW');
    expect(() => actions.gerarComunicacaoRadar('inexistente')).toThrow(/não encontrada/);
  });
});
