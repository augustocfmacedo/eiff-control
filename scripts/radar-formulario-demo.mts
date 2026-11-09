/**
 * Demonstração: um lead fictício do formulário até a tarefa no CRM.
 *
 *     npx vite-node scripts/radar-formulario-demo.mts
 *
 * Tudo em memória. Não toca banco, não envia nada, não chama o motor
 * estrutural. Cada passo usa a função REAL do Radar — se algum dia ela mudar,
 * esta demonstração muda junto, que é o ponto.
 */
import {
  adapterFormularioSite, envelopeDaSubmissao, oportunidadeDoFormulario, pedidoDeIntake,
  type SubmissaoFormulario,
} from '../src/core/radar/formularioSite'
import {
  classificarIntake, discoveryRecords, registroDeIntake, validarIntake,
} from '../src/core/radar/leadEngineIntake'
import { aplicarDecisao } from '../src/core/radar/leadEngineReview'
import { construirCommercialQueue } from '../src/core/radar/commercialMachine'
import { planoDeAcaoCM } from '../src/core/radar/commercialActionPlan'
import { cadenciaDaContaCM, TEXTO_ESTADO_CADENCIA_CM, TEXTO_NATUREZA_TOQUE_CM } from '../src/core/radar/commercialCadence'
import { upsertContato } from '../src/core/radar/ingestao'
import { radarVazio } from '../src/core/radar/types'
import type { Fonte, RadarDataset } from '../src/core/radar/types'

const HOJE = '2026-11-09'
const AGORA = `${HOJE}T13:40:00.000Z`
const USUARIO = 'u-comercial'

const passo = (n: number, t: string) => console.log(`\n${n} — ${t}`)
const ok = (t: string) => console.log(`   ✓ ${t}`)

/* Gerador de ids determinístico: a demonstração tem de ser reproduzível. */
let seq = 0
const ids = { novo: (p: string) => `${p}-${String(++seq).padStart(3, '0')}` }

/* ---------------------------------------------------------------
   O lead fictício
--------------------------------------------------------------- */

const SUBMISSAO: SubmissaoFormulario = {
  id: 'netlify-demo-0001',
  formulario: 'simular-galpao',
  recebidoEm: AGORA,
  campos: {
    uso: 'logistico',
    vao: '25', comprimento: '60', peDireito: '8',
    cidade: 'Aparecida de Goiânia, GO',
    observacao: 'Doca para dois caminhões e expansão futura.',
    nome: 'Maria Souza (FICTÍCIO)',
    empresa: 'Souza Logística (FICTÍCIO)',
    email: 'maria@exemplo-souzalog.com.br',
    telefone: '62 90000-0000',
    area: '1.500 m²',
    resumo: 'Logística · 1.500 m² · vão 25 m · pé-direito 8 m · Aparecida de Goiânia, GO',
    especificacao: 'Cobertura: telha sanduíche · Piso: industrial · Escopo: estrutura e fechamento',
    origem: 'google/cpc/galpao-goiania',
    prazo: '3 a 6 meses',
  },
}

console.log('DEMONSTRAÇÃO — do formulário do site à tarefa no CRM')
console.log('Lead FICTÍCIO. Nada é enviado, nada é gravado, nenhum cálculo estrutural roda.')

/* ---------------------------------------------------------------
   1 · A fonte
--------------------------------------------------------------- */

passo(1, 'A fonte WEBSITE no Radar')
const fonte: Fonte = {
  id: ids.novo('FNT'),
  tipo: 'WEBSITE',
  nome: 'Formulário do site',
  ativo: true,
  criadoEm: AGORA,
}
let r: RadarDataset = { ...radarVazio(), fontes: [fonte] }
ok(`fonte ${fonte.id} · tipo ${fonte.tipo} · ${fonte.nome}`)
ok(`o tipo já existia no catálogo do Radar: nenhuma fonte nova foi inventada`)

/* ---------------------------------------------------------------
   2 · A submissão vira evidência
--------------------------------------------------------------- */

passo(2, 'A submissão entra como evidência (radar_source_record)')
const pedido = pedidoDeIntake(SUBMISSAO, fonte.id)
const valido = validarIntake(pedido)
if (!valido.ok) { console.error('intake inválido:', valido.motivos); process.exit(1) }
ok(`identidade: ${valido.identidade.fonteId} + ${valido.identidade.externoId}`)
ok(`impressão do payload: ${valido.payloadFingerprint.slice(0, 16)}…`)

const classificacao = classificarIntake(valido, discoveryRecords(r.registrosFonte))
ok(`classificação: ${classificacao.resultado}`)
const registro = registroDeIntake(valido, pedido, ids.novo('RF'))
r = { ...r, registrosFonte: [registro] }
ok(`registro ${registro.id} em ${registro.statusIntake} — sem empresa, sem contato, sem nada`)

/* ---------------------------------------------------------------
   3 · Idempotência
--------------------------------------------------------------- */

passo(3, 'A MESMA submissão, reprocessada')
const reenvio = validarIntake(pedidoDeIntake(SUBMISSAO, fonte.id))
if (!reenvio.ok) { console.error('reenvio inválido'); process.exit(1) }
const c2 = classificarIntake(reenvio, discoveryRecords(r.registrosFonte))
ok(`classificação: ${c2.resultado} — não duplica`)

const alterada = validarIntake(pedidoDeIntake(
  { ...SUBMISSAO, campos: { ...SUBMISSAO.campos, peDireito: '10' } }, fonte.id,
))
if (!alterada.ok) { console.error('alterada inválida'); process.exit(1) }
ok(`com o pé-direito corrigido: ${classificarIntake(alterada, discoveryRecords(r.registrosFonte)).resultado} — nasce ao lado, não por cima`)

/* ---------------------------------------------------------------
   4 · A decisão humana
--------------------------------------------------------------- */

passo(4, 'A promoção — decisão HUMANA, na aba Candidatos')

/* 4a — o formulário COMO ESTÁ PUBLICADO hoje: sem campo de CNPJ. */
const semCnpj = aplicarDecisao(
  r,
  { registroFonteId: registro.id, payloadFingerprintEsperado: registro.payloadFingerprint!, decisao: 'CREATE_COMPANY' },
  { ...ids, usuarioId: USUARIO },
)
if ('ok' in semCnpj && semCnpj.ok) {
  console.error('ERRO: criar conta sem identidade forte deveria ser recusado')
  process.exit(1)
}
ok(`com o formulário de hoje: RECUSADO — ${semCnpj.motivos.join(', ')}`)
ok('e está certo: o Lead Engine só cria conta nova com CNPJ válido ou business_id')
ok('o candidato fica PENDING e quem revisa decide — associar a uma conta existente,')
ok('informar o CNPJ, ou criar a conta pelo caminho manual de sempre')

/* 4b — o mesmo formulário COM um campo opcional de CNPJ. */
console.log('\n   ── e agora o mesmo lead, com um campo opcional de CNPJ no formulário ──')
const comCnpj: SubmissaoFormulario = {
  ...SUBMISSAO,
  id: 'netlify-demo-0002',
  campos: { ...SUBMISSAO.campos, cnpj: '63.989.526/0001-66' },
}
const p2 = pedidoDeIntake(comCnpj, fonte.id)
const v2 = validarIntake(p2)
if (!v2.ok) { console.error('intake inválido'); process.exit(1) }
const registro2 = registroDeIntake(v2, p2, ids.novo('RF'))
r = { ...r, registrosFonte: [...r.registrosFonte, registro2] }
ok(`registro ${registro2.id} em ${registro2.statusIntake}`)

const decisao = aplicarDecisao(
  r,
  { registroFonteId: registro2.id, payloadFingerprintEsperado: registro2.payloadFingerprint!, decisao: 'CREATE_COMPANY' },
  { ...ids, usuarioId: USUARIO },
)
if (!('ok' in decisao) || !decisao.ok) { console.error('decisão recusada:', decisao); process.exit(1) }
r = decisao.resultado.radar
const empresa = r.empresas[0]!
ok(`empresa ${empresa.id} · ${empresa.razaoSocial}`)
ok(`contatos: ${r.contatos.length} · projetos: ${r.projetos.length} · sinais: ${r.sinais.length}`)
if (r.contatos[0]) ok(`contato ${r.contatos[0].nome} · ${r.contatos[0].email ?? 'sem e-mail'}`)
if (r.sinais[0]) ok(`sinal ${r.sinais[0].tipo} · ${r.sinais[0].titulo}`)
ok(`registro de origem: ${r.registrosFonte[0]!.statusIntake} — a evidência fica`)

/* ---------------------------------------------------------------
   4c · O contato — passo próprio, com o upsert do Radar
--------------------------------------------------------------- */

passo(5, 'O contato — a promoção não cria, porque nas fontes de descoberta não há pessoa')
const env = envelopeDaSubmissao(comCnpj)
const normalizado = adapterFormularioSite.normalizar(env)!
const normalizadoContato = normalizado.contatos?.[0]
if (normalizadoContato !== undefined) {
  const up = upsertContato(r, empresa.id, normalizadoContato, fonte.id, ids)
  r = up.radar
  ok(`contato ${up.contato.id} · ${up.contato.nome} · ${up.resultado}`)
  ok(`e-mail ${up.contato.email ?? '—'} · telefone ${up.contato.telefone ?? '—'}`)
  const denovo = upsertContato(r, empresa.id, normalizadoContato, fonte.id, ids)
  ok(`o mesmo contato de novo: ${denovo.resultado} — a deduplicação é a do Radar`)
  r = denovo.radar
}

/* ---------------------------------------------------------------
   5 · A oportunidade
--------------------------------------------------------------- */

passo(6, 'A oportunidade comercial')
const projetoId = r.projetos[0]?.id
const amanha = '2026-11-10'
const oportunidade = oportunidadeDoFormulario({
  id: ids.novo('OPP'),
  empresaId: empresa.id,
  ...(projetoId !== undefined ? { projetoId } : {}),
  responsavelId: USUARIO,
  canonical: env.canonical,
  agora: AGORA,
  proximaAcaoEm: amanha,
})
r = { ...r, oportunidades: [oportunidade] }
ok(`${oportunidade.id} · ${oportunidade.titulo}`)
ok(`estágio ${oportunidade.estagio} · probabilidade ${oportunidade.probabilidade}`)
ok(`próxima ação: "${oportunidade.proximaAcao}" em ${oportunidade.proximaAcaoEm}`)
ok(`projeto normalizado: ${normalizado.projeto?.areaM2 ?? '—'} m²`)

/* ---------------------------------------------------------------
   6 · A tarefa — pela cadência que já existe
--------------------------------------------------------------- */

passo(7, 'A próxima tarefa, pela cadência CM2-B.1 (nenhum mecanismo novo)')
const fila = construirCommercialQueue(r, HOJE)
const item = fila.itens.find((i) => i.empresaId === empresa.id)
if (item === undefined) {
  console.log('   A conta não entrou na fila hoje. Motivo e critérios são da própria máquina comercial.')
  console.log(`   Itens na fila: ${fila.itens.length}`)
} else {
  const plano = planoDeAcaoCM(r, item)
  const cad = cadenciaDaContaCM(r, item, plano, HOJE)
  ok(`categoria da fila: ${item.categoria}`)
  ok(`razão principal: ${item.razaoPrincipal ?? '—'}`)
  ok(`estado da cadência: ${cad.estado} — ${TEXTO_ESTADO_CADENCIA_CM[cad.estado]}`)
  if (cad.proximoToque) {
    ok(`próximo toque: ${cad.proximoToque.em} · ${TEXTO_NATUREZA_TOQUE_CM[cad.proximoToque.natureza]}`)
  }
  if (cad.avisos.length > 0) ok(`avisos: ${cad.avisos.join(', ')}`)
}

/* ---------------------------------------------------------------
   Fecho
--------------------------------------------------------------- */

console.log('\nRETRATO')
console.log(`  registros de origem: ${r.registrosFonte.length} · empresas: ${r.empresas.length} · contatos: ${r.contatos.length}`)
console.log(`  projetos: ${r.projetos.length} · sinais: ${r.sinais.length} · oportunidades: ${r.oportunidades.length}`)
console.log('  nada enviado · nada gravado em banco · motor estrutural não acionado')
