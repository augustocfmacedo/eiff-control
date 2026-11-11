// Envio MANUAL de e-mail a partir de uma conversa do Inbox (docs/email-comercial.md §12).
// A tela só pede: destinatário e remetente são decididos no servidor, que também diz se o envio está disponível.
// Dois gestos obrigatórios: «Enviar e-mail» e, na confirmação que mostra De / Para / Assunto / texto, «Enviar agora».
// O endereço mostrado na confirmação volta ao servidor junto do pedido: se o banco já disser outro, nada é enviado.
// Resultado desconhecido NUNCA oferece reenvio: oferece conferir a pasta Enviados e declarar o que encontrou — e
// declarar «não foi enviado» pede uma segunda confirmação, porque uma declaração errada vira e-mail em dobro.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { assinatura, mascararEmail, validarConteudo } from '../core/inbox/emailMensagem';
import { NOME_SITUACAO_EMAIL, chaveDoConteudo, entregaSemDesfecho, lerDisponibilidade, lerRespostaDoEnvio, pedidoDeReconciliacao, pedeNovaConferenciaDoDestino, type AvisoDoEnvio, type DisponibilidadeDoEnvio } from '../core/inbox/emailTela';
import type { InboxMessage } from '../core/inbox';
import { chamarEmailComercial, type PedidoEmailComercial, type RespostaEmailComercial } from '../data/emailComercial';
import { Modal } from './components';

const novaIntencao = (): string => crypto.randomUUID();

export function EnvioEmail({ threadId, assunto, corpo, mensagens, nomeAtendente, remoto, podeEnviar, desabilitado, aoConcluir, chamar = chamarEmailComercial }: {
  threadId: string; assunto: string; corpo: string; mensagens: readonly InboxMessage[]; nomeAtendente: string;
  /** O app está ligado ao servidor? No modo local não existe envio. */
  remoto: boolean;
  /** O usuário tem a ação `enviar_email`? (conforto: a recusa de verdade é do servidor) */
  podeEnviar: boolean; desabilitado?: boolean;
  /** Chamado depois de um desfecho que mudou o banco, para a tela recarregar a conversa. */
  aoConcluir: (aviso: AvisoDoEnvio) => void;
  /** Quem fala com `/api/email-comercial`. Só é trocado em teste e em demonstração com respostas simuladas. */
  chamar?: (pedido: PedidoEmailComercial) => Promise<RespostaEmailComercial>;
}) {
  const [disp, setDisp] = useState<DisponibilidadeDoEnvio | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [declarando, setDeclarando] = useState<string | null>(null);
  const [conferiu, setConferiu] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<AvisoDoEnvio | null>(null);
  // a intenção nasce ANTES do primeiro clique e vale enquanto o conteúdo for o mesmo: duplo clique e repetição do
  // pedido caem na mesma entrega; mudar o texto é outro e-mail, com outra intenção
  const intencao = useRef<{ chave: string; id: string } | null>(null);
  const pendente = useMemo(() => entregaSemDesfecho(mensagens, threadId), [mensagens, threadId]);
  const problemas = useMemo(() => validarConteudo({ assunto, corpo }), [assunto, corpo]);

  // a função de chamada fica numa ref: trocar a função (teste, demonstração) não refaz a consulta nem apaga o aviso
  const chamarRef = useRef(chamar); chamarRef.current = chamar;
  const preparar = useCallback(async () => { const r = await chamarRef.current({ acao: 'preparar', threadId }); return lerDisponibilidade(r.status, r.corpo); }, [threadId]);
  useEffect(() => {
    let vivo = true;
    setDisp(null); setAviso(null); setConfirmando(false); setDeclarando(null); intencao.current = null;
    if (!remoto || !podeEnviar) return;
    preparar().then((d) => { if (vivo) setDisp(d); });
    return () => { vivo = false; };
  }, [threadId, remoto, podeEnviar, preparar]);

  const concluir = (a: AvisoDoEnvio) => { setAviso(a); if (a.recarregar) aoConcluir(a); };
  const enviar = async () => {
    if (ocupado || !disp?.destinatario) return;
    const chave = chaveDoConteudo(threadId, assunto, corpo);
    if (intencao.current?.chave !== chave) intencao.current = { chave, id: novaIntencao() };
    setOcupado(true);
    // `destinatario` é o endereço que a pessoa acabou de ver na confirmação: o servidor só segue se for o do banco
    const r = await chamarRef.current({ acao: 'enviar', threadId, assunto, corpo, intencao: intencao.current.id, destinatario: disp.destinatario });
    setOcupado(false); setConfirmando(false);
    // sem resposta do nosso servidor: o pedido pode ter chegado. Repetir com a MESMA intenção é seguro (o servidor
    // devolve a entrega original e não envia de novo), então a intenção é mantida.
    if (r.status === 0) { setAviso({ desfecho: 'em_andamento', recarregar: false, titulo: 'Sem resposta do servidor', texto: 'Não sabemos se o pedido chegou. Confira a conexão e clique em Enviar de novo: o mesmo pedido não gera um segundo e-mail.' }); return; }
    const a = lerRespostaDoEnvio(r.status, r.corpo);
    if (a.desfecho === 'enviado') intencao.current = null;
    concluir(a);
    // o endereço mudou (ou ficou ambíguo) entre a confirmação e o envio: nada saiu; a tela busca o endereço atual
    if (pedeNovaConferenciaDoDestino(r.corpo)) setDisp(await preparar());
  };
  const reconciliar = async (entregaId: string, desfecho: 'encontrado' | 'nao_enviado') => {
    const pedido = pedidoDeReconciliacao(entregaId, desfecho, conferiu);
    if (ocupado || !pedido) return;
    setOcupado(true);
    const r = await chamarRef.current(pedido);
    setOcupado(false); setDeclarando(null); setConferiu(false);
    if (desfecho === 'nao_enviado') intencao.current = null;
    concluir(lerRespostaDoEnvio(r.status, r.corpo));
  };

  if (!remoto) return <div className="small muted" data-envio-email="local">Envio de e-mail indisponível no modo local: aqui o texto só pode ser registrado como rascunho.</div>;
  if (!podeEnviar) return <div className="small muted" data-envio-email="sem-permissao">Seu perfil registra rascunhos; enviar e-mail em nome da EIFF é restrito a Administrador e Diretoria.</div>;

  const entregaParaConferir = pendente ?? (aviso?.desfecho === 'desconhecido' && aviso.entregaId ? { entregaId: aviso.entregaId, situacao: 'sem_confirmacao' as const } : undefined);
  const caixaRemetente = disp?.remetente ?? 'a caixa remetente';
  return (
    <div className="envio-email" data-envio-email={disp?.disponivel ? 'disponivel' : 'indisponivel'}>
      {aviso && !(aviso.desfecho === 'desconhecido' && entregaParaConferir) && (
        <div className={`envio-email-aviso ${aviso.desfecho}`} role="status">
          <b>{aviso.titulo}</b> <span>{aviso.texto}</span>
        </div>
      )}
      {entregaParaConferir ? (
        <div className="envio-email-pendente" role="alert">
          <div><b>{NOME_SITUACAO_EMAIL[entregaParaConferir.situacao]}.</b> {entregaParaConferir.situacao === 'sem_confirmacao'
            ? 'Não sabemos se saiu. Não envie de novo: confira a pasta Enviados da caixa remetente.'
            : 'Há um envio desta conversa sem desfecho. Se ele ficou parado há mais de dois minutos, confira a pasta Enviados.'}</div>
          <div className="actions">
            <button className="btn sm" disabled={ocupado} onClick={() => reconciliar(entregaParaConferir.entregaId, 'encontrado')}>Encontrei em Enviados</button>
            <button className="btn sm" disabled={ocupado} onClick={() => { setConferiu(false); setDeclarando(entregaParaConferir.entregaId); }}>Não foi enviado…</button>
          </div>
        </div>
      ) : disp === null ? (
        <div className="small muted">Verificando se o envio está disponível…</div>
      ) : !disp.disponivel ? (
        <div className="small muted">Envio pelo sistema indisponível: {disp.mensagem ?? 'não configurado'} O texto pode ser registrado como rascunho.</div>
      ) : (
        <div className="actions">
          <button className="btn primary" disabled={desabilitado || ocupado || problemas.length > 0} onClick={() => setConfirmando(true)}>Enviar e-mail</button>
          <span className="small muted">{problemas[0] ?? `De ${disp.remetente} para ${mascararEmail(disp.destinatario ?? '')}. Você confere o endereço completo antes de sair.`}</span>
        </div>
      )}

      {confirmando && disp?.disponivel && (
        <Modal title="Confirmar o envio do e-mail" onClose={() => { if (!ocupado) setConfirmando(false); }}>
          <p className="small"><b>Este e-mail será enviado agora e não pode ser desfeito.</b> Confira remetente, destinatário e texto.</p>
          <dl className="kv envio-email-conferencia">
            <dt>De</dt><dd>{disp.remetente}</dd>
            <dt>Para</dt><dd data-envio-email-para>{disp.destinatario}</dd>
            <dt>Assunto</dt><dd>{assunto.trim()}</dd>
          </dl>
          <pre className="envio-email-previa">{`${corpo.replace(/\r\n?/g, '\n').trim()}\n\n${assinatura(nomeAtendente)}`}</pre>
          <div className="actions">
            <button className="btn primary" disabled={ocupado} onClick={enviar}>{ocupado ? 'Enviando…' : 'Enviar agora'}</button>
            <button className="btn" disabled={ocupado} onClick={() => setConfirmando(false)}>Voltar</button>
          </div>
        </Modal>
      )}

      {declarando && (
        <Modal title="Declarar que o e-mail não foi enviado" onClose={() => { if (!ocupado) setDeclarando(null); }}>
          <p className="small"><b>Só confirme depois de conferir a pasta Enviados de {caixaRemetente}.</b></p>
          <p className="small">Ao declarar que não foi enviado, o sistema libera um novo envio nesta conversa. Se o e-mail na verdade saiu, o cliente vai receber a mesma mensagem duas vezes.</p>
          <p className="small muted">Na dúvida, volte e não declare nada: a conversa continua bloqueada para novo envio, e isso é o estado seguro. A declaração fica registrada no histórico do envio, com o seu nome e o horário.</p>
          <label className="envio-email-conferi"><input type="checkbox" checked={conferiu} onChange={(e) => setConferiu(e.target.checked)} /> <span>Conferi a pasta Enviados de {caixaRemetente} e este e-mail não está lá.</span></label>
          <div className="actions">
            <button className="btn danger" disabled={ocupado || !conferiu} onClick={() => reconciliar(declarando, 'nao_enviado')}>{ocupado ? 'Registrando…' : 'Declarar como não enviado'}</button>
            <button className="btn" disabled={ocupado} onClick={() => setDeclarando(null)}>Voltar sem declarar</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
