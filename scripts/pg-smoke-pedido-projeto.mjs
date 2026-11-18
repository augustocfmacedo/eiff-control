// Smoke do pedido de projeto (E11.2C) contra um PostgreSQL DE VERDADE (PGlite, em memória). NADA TOCA PRODUÇÃO.
// Fila inteira de migrations + carga inicial + docs/propostas/comercial-acesso.proposta.sql (partes 1 e 2)
// + docs/propostas/pedido-projeto.proposta.sql. Prova, pelas FUNÇÕES do banco (a mesma API do adaptador Supabase): quem
// abre, quem vê (fila técnica, sem ler o Inbox Comercial), payload da Engenharia sem dado comercial, escrita só por
// função, lados e responsável, versão, motivos, idempotência, ciclo completo, histórico imutável, vínculos por id,
// documentos em bucket próprio e isolamento entre organizações. O teste de integração do adaptador
// (src/data/pedidosProjeto.supabase.integracao.test.ts) cobre o mesmo pelo código do app.
//
// Como rodar:  node scripts/pg-smoke-pedido-projeto.mjs   (imprime JSON; sai com 1 se qualquer prova falhar)
import fs from 'node:fs';
import path from 'node:path';
import { bancoComFila } from './lib/pgliteFila.mjs';

const AQUI = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');
const RAIZ = path.join(AQUI, '..');
const res = { migrations: {}, provas: {}, diagnostico: {} };
let falhas = 0;
const prova = (k, ok, detalhe = '') => { res.provas[k] = `${ok ? 'PASS' : 'FALHOU'}${detalhe ? ' — ' + detalhe : ''}`; if (!ok) falhas++; };
const so = (e) => String(e?.message ?? e).split('\n')[0];
let db;
async function como(uid, fn) {
  await db.exec('begin;');
  try {
    await db.exec(`set local role authenticated; select set_config('test.uid', '${uid}', true);`);
    const valor = await fn();
    await db.exec('commit;');
    return { valor, erro: null };
  } catch (e) { try { await db.exec('rollback;'); } catch { /* */ } return { valor: undefined, erro: so(e) }; }
}
const um = async (sql, p = []) => { const r = (await db.query(sql, p)).rows; return r[0] ? r[0][Object.keys(r[0])[0]] : undefined; };
let n = 0;
const int = () => `i-${++n}`;
const criar = (uid, p, intencao = int()) => como(uid, async () => um(`select pp_criar($1::jsonb, $2) as r`, [JSON.stringify(p), intencao]));
const agir = (uid, id, acao, dados, versao, intencao = int()) => como(uid, async () => um(`select pp_transicionar($1::uuid, $2, $3::jsonb, $4, $5) as r`, [id, acao, JSON.stringify(dados ?? {}), versao, intencao]));
const versao = (id) => um(`select version from project_request where id = $1`, [id]);
const listar = (uid) => como(uid, async () => um(`select pp_listar() as r`));

const P = {
  Administrador: 'dddddddd-0000-4000-8000-000000000001', Diretoria: 'dddddddd-0000-4000-8000-000000000002', Comercial: 'dddddddd-0000-4000-8000-000000000003',
  Engenharia: 'dddddddd-0000-4000-8000-000000000004', Engenharia2: 'dddddddd-0000-4000-8000-000000000005', Financeiro: 'dddddddd-0000-4000-8000-000000000006',
  Contabilidade: 'dddddddd-0000-4000-8000-000000000007', Compras: 'dddddddd-0000-4000-8000-000000000008', 'Gestor de obra': 'dddddddd-0000-4000-8000-000000000009',
  Auditoria: 'dddddddd-0000-4000-8000-00000000000a', Solicitante: 'dddddddd-0000-4000-8000-00000000000b',
};
const papelDe = (k) => (k === 'Engenharia2' ? 'Engenharia' : k);

try {
  ({ db } = await bancoComFila(RAIZ));
  const [ca1, ca2] = fs.readFileSync(path.join(RAIZ, 'docs/propostas/comercial-acesso.proposta.sql'), 'utf8').split('-- @@PARTE2@@');
  const pp = fs.readFileSync(path.join(RAIZ, 'docs/propostas/pedido-projeto.proposta.sql'), 'utf8');
  for (const [k, sql] of [['comercial_acesso_1', ca1], ['comercial_acesso_2', ca2], ['pedido_projeto', pp], ['pedido_projeto_reaplicacao', pp]]) { await db.exec('begin;'); await db.exec(sql); await db.exec('commit;'); res.migrations[k] = 'APLICADA'; }

  const org = await um(`select id from organization where code = 'EIFF'`);
  const org2 = await um(`insert into organization (code, name) values ('OUTRA', 'Outra (fictícia)') returning id`);
  for (const [k, id] of Object.entries(P)) await db.query(`insert into profile (id, organization_id, name, email, role) values ($1, $2, $3, $4, $5)`, [id, org, `Perfil ${k}`, `${id.slice(-2)}@exemplo`, papelDe(k)]);
  const ADM2 = 'dddddddd-0000-4000-8000-0000000000b1';
  await db.query(`insert into profile (id, organization_id, name, email, role) values ($1, $2, 'Adm da outra', 'b1@exemplo', 'Administrador')`, [ADM2, org2]);
  const emp = await um(`insert into radar_company (organization_id, legal_name, trade_name, active) values ($1, 'Grãos do Vale Armazéns Ltda (fictícia)', 'Grãos do Vale', true) returning id`, [org]);
  await db.query(`insert into radar_contact (organization_id, company_id, full_name, email, phone, active, status) values ($1, $2, 'Marina Fictícia', 'marina@exemplo', '+5562900000000', true, 'ATIVO')`, [org, emp]);
  const op = await um(`insert into radar_opportunity (organization_id, company_id, title, stage, estimated_value, probability, owner_id, next_action_at, notes) values ($1, $2, 'Galpão 25 × 80', 'NEED_CONFIRMED', 1400000, 0.3, $3, now() + interval '3 days', 'cliente pediu desconto de 5%') returning id`, [org, emp, P.Comercial]);
  const emp2 = await um(`insert into radar_company (organization_id, legal_name, active) values ($1, 'Outra empresa (fictícia)', true) returning id`, [org]);
  const op2 = await um(`insert into radar_opportunity (organization_id, company_id, title, stage, probability, owner_id, next_action_at) values ($1, $2, 'Outra', 'QUALIFIED', 0.1, $3, now() + interval '3 days') returning id`, [org, emp2, P.Comercial]);
  const orc = await um(`insert into estimate (organization_id, code, title) values ($1, 'ORC-T1', 'Orçamento técnico fictício') returning id`, [org]);
  const estagioAntes = await um(`select stage from radar_opportunity where id = $1`, [op]);
  const pedido = { empresaId: emp, oportunidadeId: op, origemLead: 'SIMULADOR', tipo: 'Estudo preliminar', prioridade: 'Alta', prazoSolicitado: '2026-11-30', responsavelComercialId: P.Comercial,
    dados: { cidade: 'Rio Verde', uf: 'GO', comprimentoM: 80, larguraM: 25, alturaM: 10 }, documentos: { arquitetura: 'pendente' } };

  // A. quem abre (cada tentativa numa transação desfeita)
  const abre = [];
  for (const k of Object.keys(P)) {
    await db.exec('begin;'); await db.exec(`set local role authenticated; select set_config('test.uid', '${P[k]}', true);`);
    try { await db.query(`select pp_criar($1::jsonb, $2)`, [JSON.stringify(pedido), int()]); abre.push(k); } catch { /* negado */ }
    await db.exec('rollback;');
  }
  prova('A só a gestão comercial abre (Administrador, Diretoria, Comercial)', JSON.stringify(abre.sort()) === JSON.stringify(['Administrador', 'Comercial', 'Diretoria']), abre.join(', '));

  // B. idempotência na criação
  const c1 = await criar(P.Comercial, pedido, 'abrir-1');
  const c2 = await criar(P.Comercial, pedido, 'abrir-1');
  const id = c1.valor?.id;
  prova('B nasce SOLICITADO (SP-0001); a mesma intenção devolve a mesma solicitação', c1.valor?.situacao === 'SOLICITADO' && c1.valor?.codigo === 'SP-0001' && c2.valor?.id === id && (await um(`select count(*)::int from project_request`)) === 1, c1.erro ?? `${c1.valor?.codigo}`);

  // C. duplicidade e outro tipo
  const dup = await criar(P.Comercial, pedido);
  const outroTipo = await criar(P.Comercial, { ...pedido, tipo: 'Análise técnica' });
  prova('C uma aberta por oportunidade e tipo; outro tipo convive', /DUPLICADA/.test(dup.erro ?? '') && !outroTipo.erro, `${dup.erro} | ${outroTipo.valor?.codigo}`);

  // D. escrita direta recusada para todos
  const diretas = [];
  for (const k of Object.keys(P)) {
    for (const sql of [`update project_request set status = 'ENTREGUE' where id = '${id}'`, `delete from project_request where id = '${id}'`, `insert into project_request_event (organization_id, request_id, action, to_status, actor_id, actor_role, intent) values ('${org}', '${id}', 'x', 'ENTREGUE', '${P[k]}', 'x', 'forjada-${k}')`, `update project_request_field set status = 'validado' where request_id = '${id}'`]) {
      const r = await como(P[k], async () => db.query(sql));
      if (!r.erro) diretas.push(`${k}:${sql.slice(0, 20)}`);
    }
  }
  prova('D nenhum perfil escreve direto (solicitação, histórico, dados)', diretas.length === 0, diretas.join(', ') || `${Object.keys(P).length} perfis × 4 = negado`);

  // E. visibilidade: tabela só para a gestão; Engenharia só pela função; demais nada
  const vis = {};
  for (const k of Object.keys(P)) {
    const t = await como(P[k], async () => um(`select count(*)::int from project_request`));
    const l = await listar(P[k]);
    vis[k] = `${t.valor ?? 'x'}/${l.valor?.length ?? 'x'}`;
  }
  const esp = { Administrador: '2/2', Diretoria: '2/2', Comercial: '2/2', Engenharia: '0/2', Engenharia2: '0/2', Financeiro: '0/0', Contabilidade: '0/0', Compras: '0/0', 'Gestor de obra': '0/0', Auditoria: '0/0', Solicitante: '0/0' };
  prova('E tabela só para a gestão; Engenharia só pela função; demais nada (tabela/função)', JSON.stringify(vis) === JSON.stringify(esp), JSON.stringify(vis));

  // F. payload da Engenharia sem oportunidade, vínculos ou dado comercial
  const vistoEng = (await como(P.Engenharia, async () => um(`select pp_obter($1::uuid) as r`, [id]))).valor;
  const texto = JSON.stringify((await listar(P.Engenharia)).valor);
  const vaza = ['oportunidadeId', 'vinculos', 'Galpão 25 × 80', '1400000', 'desconto de 5%', 'Marina Fictícia', 'marina@exemplo', op].filter((s) => texto.includes(s) || JSON.stringify(vistoEng).includes(s));
  prova('F payload da Engenharia sem oportunidade, vínculos nem dado comercial; empresa pelo nome', vaza.length === 0 && vistoEng?.empresaNome === 'Grãos do Vale', vaza.join(', ') || 'limpo');

  // G. lados, responsável, versão e motivo
  let v = await versao(id);
  const engEdita = await agir(P.Engenharia, id, 'editar_dados', { dados: { larguraM: 30 } }, v);
  const finTriagem = await agir(P.Financeiro, id, 'iniciar_triagem', {}, v);
  const tri = await agir(P.Engenharia, id, 'iniciar_triagem', { equipeTecnica: 'Engenharia estrutural' }, v);
  v = await versao(id);
  const outro = await agir(P.Engenharia2, id, 'assumir_desenvolvimento', { prazoEntrega: '2026-11-30' }, v);
  const velha = await agir(P.Engenharia, id, 'assumir_desenvolvimento', { prazoEntrega: '2026-11-30' }, v - 1);
  const semMotivo = await agir(P.Engenharia, id, 'pedir_dados', { pendencias: ['sondagem'] }, v);
  prova('G Engenharia não faz ação do Comercial; Financeiro não age; só o responsável; versão e motivo',
    /SEM_PERMISSAO/.test(engEdita.erro ?? '') && /SEM_PERMISSAO/.test(finTriagem.erro ?? '') && !tri.erro && tri.valor.responsavelTecnicoId === P.Engenharia
      && /SEM_PERMISSAO/.test(outro.erro ?? '') && /VERSAO_DESATUALIZADA/.test(velha.erro ?? '') && /MOTIVO_OBRIGATORIO/.test(semMotivo.erro ?? ''),
    [engEdita.erro, finTriagem.erro, outro.erro, velha.erro, semMotivo.erro].join(' | '));

  // H. idempotência na ação
  v = await versao(id);
  const t1 = await agir(P.Engenharia, id, 'registrar_triagem', { validar: ['cidade', 'larguraM'], nota: 'conferido' }, v, 'triagem-1');
  const t2 = await agir(P.Engenharia, id, 'registrar_triagem', { validar: ['cidade', 'larguraM'], nota: 'conferido' }, v, 'triagem-1');
  const nEv = await um(`select count(*)::int from project_request_event where request_id = $1 and intent = 'triagem-1'`, [id]);
  prova('H a mesma intenção não aplica a ação duas vezes; dado validado com autor', !t1.erro && t2.valor?.versao === t1.valor?.versao && nEv === 1 && t1.valor.dados.larguraM.situacao === 'validado' && t1.valor.dados.alturaM.situacao === 'declarado', t1.erro ?? `versão ${t1.valor?.versao}`);

  // I. ciclo completo
  const passos = [
    [P.Engenharia, 'pedir_dados', { motivo: 'Falta a arquitetura', pendencias: ['Planta de arquitetura'] }],
    [P.Engenharia, 'assumir_desenvolvimento', { prazoEntrega: '2026-11-30' }],
    [P.Comercial, 'atualizar_documento', { documento: { tipo: 'arquitetura', situacao: 'recebido', referencia: 'arq-r01.pdf' } }],
    [P.Comercial, 'responder_pendencias', { resposta: 'Arquitetura recebida' }],
    [P.Engenharia, 'atualizar_documento', { documento: { tipo: 'arquitetura', situacao: 'validado' } }],
    [P.Engenharia, 'assumir_desenvolvimento', { prazoEntrega: '2026-11-30' }],
    [P.Engenharia, 'registrar_andamento', { nota: 'Pórticos pré-dimensionados' }],
    [P.Engenharia, 'entregar', { entrega: { resumo: 'Estudo preliminar entregue', resultados: 'Pórticos a cada 6 m', referencias: ['estudo.pdf'] } }],
    [P.Comercial, 'encerrar', { resultado: { tipo: 'ORCAMENTO_VINCULADO', orcamentoId: orc } }],
  ];
  const trilha = [];
  for (const [uid, acao, dados] of passos) { const r = await agir(uid, id, acao, dados, await versao(id)); trilha.push(`${acao}:${r.erro ? 'recusado' : r.valor.situacao}`); }
  prova('I ciclo completo até ENCERRADO, com devolução e a recusa no meio', trilha.join(' ') === 'pedir_dados:DADOS_PENDENTES assumir_desenvolvimento:recusado atualizar_documento:DADOS_PENDENTES responder_pendencias:TRIAGEM_TECNICA atualizar_documento:TRIAGEM_TECNICA assumir_desenvolvimento:EM_DESENVOLVIMENTO registrar_andamento:EM_DESENVOLVIMENTO entregar:ENTREGUE encerrar:ENCERRADO', trilha.join(' '));
  const final = await agir(P.Administrador, id, 'cancelar', { motivo: 'tentativa depois de encerrada' }, await versao(id));
  prova('J estado final não admite alteração', /ESTADO_FINAL/.test(final.erro ?? ''), final.erro ?? 'alterou');
  const eventos = (await db.query(`select action, from_status, reason, intent from project_request_event where request_id = $1 order by occurred_at, id`, [id])).rows;
  let imutavel = false; try { await db.query(`update project_request_event set reason = 'x' where request_id = $1`, [id]); } catch { imutavel = true; }
  prova('K histórico: um evento por ação aceita, com intenção; imutável até para o dono do banco', eventos.length === 11 && eventos.every((e) => e.intent) && eventos.some((e) => e.action === 'pedir_dados' && e.reason === 'Falta a arquitetura' && e.from_status === 'TRIAGEM_TECNICA') && imutavel, `${eventos.length} eventos · imutável=${imutavel}`);
  prova('L o estágio da oportunidade no Radar não mudou', (await um(`select stage from radar_opportunity where id = $1`, [op])) === estagioAntes, estagioAntes);

  // M. vínculos por id
  const alheia = await criar(P.Comercial, { ...pedido, oportunidadeId: op2 });
  const threadFalsa = await criar(P.Comercial, { ...pedido, tipo: 'Projeto executivo', vinculos: { inboxThreadId: '00000000-0000-4000-8000-000000000000' } });
  const ensaio = await criar(P.Comercial, { ...pedido, tipo: 'Projeto executivo', vinculos: { submissaoId: '6af379040c7080bc34020601' } });
  prova('M vínculos conferidos por id (outra empresa, conversa inexistente, ensaio recusados)', /VINCULO_INVALIDO/.test(alheia.erro ?? '') && /VINCULO_INVALIDO/.test(threadFalsa.erro ?? '') && /ENSAIO/.test(ensaio.erro ?? ''), [alheia.erro, threadFalsa.erro, ensaio.erro].join(' | '));

  // N. outra organização
  const outra = await listar(ADM2);
  const outraAge = await agir(ADM2, outroTipo.valor.id, 'cancelar', { motivo: 'tentativa de outra organização' }, 1);
  prova('N outra organização não vê nem altera nada', outra.valor?.length === 0 && /SEM_PERMISSAO/.test(outraAge.erro ?? ''), `${outra.valor?.length} · ${outraAge.erro}`);

  // O. fila técnica
  const fila = (await criar(P.Comercial, { ...pedido, tipo: 'Anteprojeto estrutural' })).valor;
  await agir(P.Diretoria, fila.id, 'atribuir', { responsavelTecnicoId: P.Engenharia2 }, fila.versao);
  const veEng = (await como(P.Engenharia, async () => um(`select pp_obter($1::uuid) as r`, [fila.id]))).valor;
  const engTenta = await agir(P.Engenharia, fila.id, 'iniciar_triagem', {}, await versao(fila.id));
  const eng2Tri = await agir(P.Engenharia2, fila.id, 'iniciar_triagem', {}, await versao(fila.id));
  const veEngDepois = (await como(P.Engenharia, async () => um(`select pp_obter($1::uuid) as r`, [fila.id]))).valor;
  const evEng = (await como(P.Engenharia, async () => um(`select pp_eventos($1::uuid) as r`, [fila.id]))).valor;
  prova('O fila técnica: na triagem a equipe vê e só o responsável age; depois, só o responsável vê (detalhe e histórico)',
    !!veEng && /SEM_PERMISSAO/.test(engTenta.erro ?? '') && !eng2Tri.erro && veEngDepois === null && Array.isArray(evEng) && evEng.length === 0, `${engTenta.erro}`);

  // P. documentos: bucket próprio, versões, permissões
  const caminho = (await como(P.Comercial, async () => um(`select pp_doc_preparar($1::uuid, 'arquitetura', 'pdf') as r`, [fila.id]))).valor;
  const sobe = await como(P.Comercial, async () => db.query(`insert into storage.objects (bucket_id, name) values ('projetos-tecnicos', $1)`, [caminho]));
  const reg = await como(P.Comercial, async () => um(`select pp_doc_registrar($1::uuid, 'arquitetura', $2, 'arq.pdf', 'application/pdf', 1000, $3) as r`, [fila.id, caminho, int()]));
  const finLe = await como(P.Financeiro, async () => um(`select count(*)::int from storage.objects where bucket_id = 'projetos-tecnicos'`));
  const finSobe = await como(P.Financeiro, async () => db.query(`insert into storage.objects (bucket_id, name) values ('projetos-tecnicos', $1)`, [`${org}/${fila.id}/x.pdf`]));
  prova('P documentos: bucket próprio, caminho da organização, versão registrada; Financeiro não lê nem envia',
    String(caminho).startsWith(`${org}/${fila.id}/`) && !sobe.erro && reg.valor?.versao === 1 && finLe.valor === 0 && !!finSobe.erro, `${reg.erro ?? 'v' + reg.valor?.versao} · Fin lê ${finLe.valor}`);

  // Q. entregável só do responsável técnico, também pelo caminho direto (upload + pp_doc_registrar, sem pp_doc_preparar)
  const semDono = (await criar(P.Comercial, { ...pedido, tipo: 'Projeto executivo' })).valor;
  const direto = `${org}/${semDono.id}/${'0'.repeat(8)}-0000-4000-8000-${'0'.repeat(12)}.pdf`;
  const sobeEng = await como(P.Engenharia, async () => db.query(`insert into storage.objects (bucket_id, name) values ('projetos-tecnicos', $1)`, [direto]));
  const regEng = await como(P.Engenharia, async () => um(`select pp_doc_registrar($1::uuid, 'entregavel', $2, 'e.pdf', 'application/pdf', 10, $3) as r`, [semDono.id, direto, int()]));
  const prepEng = await como(P.Engenharia, async () => um(`select pp_doc_preparar($1::uuid, 'entregavel', 'pdf') as r`, [semDono.id]));
  prova('Q entregável: quem não é o responsável técnico não registra, nem pelo caminho direto ao bucket',
    /SEM_PERMISSAO/.test(regEng.erro ?? '') && /SEM_PERMISSAO/.test(prepEng.erro ?? ''), `upload ${sobeEng.erro ?? 'aceito'} · registrar ${regEng.erro ?? 'ACEITO'} · preparar ${prepEng.erro ?? 'ACEITO'}`);

  // R. responsável comercial desativado não trava a solicitação
  const travada = (await criar(P.Comercial, { ...pedido, tipo: 'Apoio ao orçamento técnico' })).valor;
  await db.query(`update profile set active = false where id = $1`, [P.Comercial]);
  const cancela = await agir(P.Diretoria, travada.id, 'cancelar', { motivo: 'cliente desistiu do galpão' }, await versao(travada.id));
  await db.query(`update profile set active = true where id = $1`, [P.Comercial]);
  prova('R responsável comercial desativado não trava a solicitação (a gestão ainda cancela)', !cancela.erro, cancela.erro ?? 'cancelada');

  // S. pasta com formato de uuid inválido não quebra a política do storage
  const pasta = await um(`select pp_pedido_do_caminho($1) is null as r`, [`${org}/------------------------------------/x.pdf`]);
  prova('S caminho com pasta que não é uuid devolve nulo (sem erro de conversão)', pasta === true, String(pasta));

  res.diagnostico.engenhariaLeRadar_D2 = { oportunidades: (await como(P.Engenharia, async () => um(`select count(*)::int from radar_opportunity`))).valor };
} catch (e) {
  prova('execução', false, so(e));
}

console.log(JSON.stringify(res, null, 2));
process.exit(falhas ? 1 : 0);
