// Envio MANUAL de e-mail a partir de uma conversa do Inbox (docs/email-comercial.md §12).
// A tela só pede: destinatário e remetente são decididos no servidor, que também diz se o envio está disponível.
// Dois gestos obrigatórios: «Enviar e-mail» e, na confirmação que mostra De / Para / Assunto / texto, «Enviar agora».
// Resultado desconhecido NUNCA oferece reenvio: oferece conferir a pasta Enviados e declarar o que encontrou.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { assinatura, validarConteudo } from '../core/inbox/emailMensagem';
import { NOME_SITUACAO_EMAIL, chaveDoConteudo, entregaSemDesfecho, lerDisponibilidade, lerRespostaDoEnvio, type AvisoDoEnvio, type DisponibilidadeDoEnvio } from '../core/inbox/emailTela';
import type { InboxMessage } from '../core/inbox';
import { chamarEmailComercial } from '../data/emailComercial';
import { Modal } from './components';

const novaIntencao = (): string => crypto.randomUUID();

export function EnvioEmail({ threadId, assunto, corpo, mensagens, nomeAtendente, remoto, podeEnviar, desabilitado, aoConcluir }: {
  threadId: string; assunto: string; corpo: string; mensagens: readonly InboxMessage[]; nomeAtendente: string;
  /** O app está ligado ao servidor? No modo local não existe envio. */
  remoto: boolean;
  /** O usuário tem a ação `enviar_email`? (conforto: a recusa de verdade é do servidor) */
  podeEnviar: boolean; desabilitado?: boolean;
  /** Chamado depois de um desfecho que mudou o banco, para a tela recarregar a conversa. */
  aoConcluir: (aviso: AvisoDoEnvio) => void;
}) {
  const [disp, setDisp] = useState<DisponibilidadeDoEnvio | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<AvisoDoEnvio | null>(null);
  // a intenção nasce ANTES do primeiro clique e vale enquanto o conteúdo for o mesmo: duplo clique e repetição do
  // pedido caem na mesma entrega; mudar o texto é outro e-mail, com outra intenção
  const intencao = useRef<{ chave: string; id: string } | null>(null);
  const pendente = useMemo(() => entregaSemDesfecho(mensagens, threadId), [mensagens, threadId]);
  const problemas = useMemo(() => validarConteudo({ assunto, corpo }), [assunto, corpo]);

  useEffect(() => {
    let vivo = true;
    setDisp(null); setAviso(null); intencao.current = null;
    if (!remoto || !podeEnviar) return;
    chamarEmailComercial({ acao: 'preparar', threadId }).then((r) => { if (vivo) setDisp(lerDisponibilidade(r.status, r.corpo)); });
    return () => { vivo = false; };
  }, [threadId, remoto, podeEnviar]);

  const concluir = (a: AvisoDoEnvio) => { setAviso(a); if (a.recarregar) aoConcluir(a); };
  const enviar = async () => {
    if (ocupado) return;
    const chave = chaveDoConteudo(threadId, assunto, corpo);
    if (intencao.current?.chave !== chave) intencao.current = { chave, id: novaIntencao() };
    setOcupado(true);
    const r = await chamarEmailComercial({ acao: 'enviar', threadId, assunto, corpo, intencao: intencao.current.id });
    setOcupado(false); setConfirmando(false);
    // sem resposta do nosso servidor: o pedido pode ter chegado. Repetir com a MESMA intenção é seguro (o servidor
    // devolve a entrega original e não envia de novo), então a intenção é mantida.
    if (r.status === 0) { setAviso({ desfecho: 'em_andamento', recarregar: false, titulo: 'Sem resposta do servidor', texto: 'Não sabemos se o pedido chegou. Confira a conexão e clique em Enviar de novo: o mesmo pedido não gera um segundo e-mail.' }); return; }
    const a = lerRespostaDoEnvio(r.status, r.corpo);
    if (a.desfecho === 'enviado') intencao.current = null;
    concluir(a);
  };
  const reconciliar = async (entregaId: string, desfecho: 'encontrado' | 'nao_enviado') => {
    if (ocupado) return;
    setOcupado(true);
    const r = await chamarEmailComercial({ acao: 'reconciliar', entregaId, desfecho });
    setOcupado(false);
    if (desfecho === 'nao_enviado') intencao.current = null;
    concluir(lerRespostaDoEnvio(r.status, r.corpo));
  };

  if (!remoto) return <div className="small muted" data-envio-email="local">Envio de e-mail indisponível no modo local: aqui o texto só pode ser registrado como rascunho.</div>;
  if (!podeEnviar) return <div className="small muted" data-envio-email="sem-permissao">Seu perfil registra rascunhos; enviar e-mail em nome da EIFF é restrito a Administrador e Diretoria.</div>;

  const entregaParaConferir = pendente ?? (aviso?.desfecho === 'desconhecido' && aviso.entregaId ? { entregaId: aviso.entregaId, situacao: 'sem_confirmacao' as const } : undefined);
  return (
    <div className="envio-email" data-envio-email={disp?.disponivel ? 'disponivel' : 'indisponivel'}>
      {aviso && (
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
            <button className="btn sm" disabled={ocupado} onClick={() => reconciliar(entregaParaConferir.entregaId, 'nao_enviado')}>Não foi enviado</button>
          </div>
        </div>
      ) : disp === null ? (
        <div className="small muted">Verificando se o envio está disponível…</div>
      ) : !disp.disponivel ? (
        <div className="small muted">Envio pelo sistema indisponível: {disp.mensagem ?? 'não configurado'} O texto pode ser registrado como rascunho.</div>
      ) : (
        <div className="actions">
          <button className="btn primary" disabled={desabilitado || ocupado || problemas.length > 0} onClick={() => setConfirmando(true)}>Enviar e-mail</button>
          <span className="small muted">{problemas[0] ?? `De ${disp.remetente} para ${disp.destinatario}. Você confirma antes de sair.`}</span>
        </div>
      )}

      {confirmando && disp?.disponivel && (
        <Modal title="Confirmar o envio do e-mail" onClose={() => { if (!ocupado) setConfirmando(false); }}>
          <p className="small"><b>Este e-mail será enviado agora e não pode ser desfeito.</b> Confira remetente, destinatário e texto.</p>
          <dl className="kv">
            <dt>De</dt><dd>{disp.remetente}</dd>
            <dt>Para</dt><dd>{disp.destinatario} <span className="muted small">(o endereço completo está no contato da conversa)</span></dd>
            <dt>Assunto</dt><dd>{assunto.trim()}</dd>
          </dl>
          <pre className="envio-email-previa">{`${corpo.replace(/\r\n?/g, '\n').trim()}\n\n${assinatura(nomeAtendente)}`}</pre>
          <div className="actions">
            <button className="btn primary" disabled={ocupado} onClick={enviar}>{ocupado ? 'Enviando…' : 'Enviar agora'}</button>
            <button className="btn" disabled={ocupado} onClick={() => setConfirmando(false)}>Voltar</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
