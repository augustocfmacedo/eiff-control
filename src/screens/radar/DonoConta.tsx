// CD-D5.1/CD-D5.2 — campo compacto "Dono da conta" na ficha da empresa (docs/commercial-director-1.0.md §19.3 e §19.5).
//
// Só projeta o estado (`estadoDonoConta`) e devolve a intenção humana por `onDefinir`: quem grava é a tela, sempre por
// `actions.definirDonoContaRadar` (permissão `radar_dono`, motivo, usuário ativo da organização, auditoria, falha
// fechada) e, no banco, só pela RPC governada. Toda mudança (definir, trocar, remover) pede o motivo antes. Nenhuma
// regra de dono vive aqui. O dono da conta não é o responsável da oportunidade, da tarefa nem o derivado pela fila.
import React, { useState } from 'react';
import { MOTIVO_DONO_MAX, estadoDonoConta, recusaMotivoDono, type Empresa } from '../../core/radar';
import { Badge, Input, Link, Select } from '../../ui/components';

export interface UsuarioOpcaoDono {
  id: string;
  nome: string;
  ativo: boolean;
}

export const AJUDA_DONO_CONTA = 'Responsável comercial pela conta. Não muda o responsável das tarefas nem das oportunidades.';

/** Frase da mudança pedida, mostrada junto do motivo (o que vai acontecer, em uma linha). */
export function rotuloMudancaDono(atual: string | undefined, novo: string | null): string {
  if (novo === null) return `Remover ${atual ?? 'o dono'} da conta`;
  return atual ? `Trocar ${atual} por ${novo}` : `Definir ${novo} como dono`;
}

/** Passo do motivo: obrigatório para definir, trocar e remover. Erro da gravação aparece aqui, em linha. */
export function ConfirmarMudancaDono({ rotulo, motivo, erro, onMotivo, onConfirmar, onCancelar }: {
  rotulo: string;
  motivo: string;
  erro?: string;
  onMotivo: (v: string) => void;
  onConfirmar: () => void;
  onCancelar: () => void;
}) {
  const invalido = !!recusaMotivoDono(motivo);
  return (
    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <span>{rotulo}</span>
      <Input value={motivo} onChange={(ev) => onMotivo(ev.target.value)} placeholder="Motivo (obrigatório)" aria-label="Motivo da mudança de dono" required maxLength={MOTIVO_DONO_MAX} aria-invalid={erro ? true : undefined} style={{ width: 260 }}
        onKeyDown={(ev) => { if (ev.key === 'Enter' && !invalido) onConfirmar(); if (ev.key === 'Escape') onCancelar(); }} autoFocus />
      <button className="btn sm primary" disabled={invalido} onClick={onConfirmar}>Confirmar</button>
      <button className="btn sm" onClick={onCancelar}>Cancelar</button>
      {erro && <small className="erro" role="alert" style={{ color: 'var(--bad)' }}>{erro}</small>}
    </span>
  );
}

export function DonoConta({ empresa, usuarios, podeEditar, onDefinir }: {
  empresa: Pick<Empresa, 'id' | 'commercialOwnerId' | 'mescladaEm'>;
  usuarios: readonly UsuarioOpcaoDono[];
  /** permissão `radar_dono` (Administrador e Diretoria); sem ela o campo é só leitura */
  podeEditar: boolean;
  /** usuário escolhido, ou `null` para remover, com o motivo; devolve a mensagem de erro, ou `undefined` se gravou */
  onDefinir: (usuarioId: string | null, motivo: string) => string | undefined;
}) {
  const [escolha, setEscolha] = useState('');
  const [pedido, setPedido] = useState<{ usuarioId: string | null } | null>(null);
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState<string>();
  const estado = estadoDonoConta(empresa, usuarios);
  const atual = empresa.commercialOwnerId?.trim() || undefined;
  const nome = (id?: string) => usuarios.find((u) => u.id === id)?.nome ?? 'usuário fora da organização';
  const opcoes = usuarios
    .filter((u) => u.ativo && u.id !== atual)
    .map((u) => ({ value: u.id, label: u.nome }))
    .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
  const pedir = (usuarioId: string | null) => { setPedido({ usuarioId }); setMotivo(''); setErro(undefined); };
  const cancelar = () => { setPedido(null); setMotivo(''); setErro(undefined); setEscolha(''); };
  const confirmar = () => {
    if (!pedido) return;
    const falha = onDefinir(pedido.usuarioId, motivo.trim());
    if (falha) setErro(falha);
    else cancelar();
  };
  return (
    // layout próprio (o app não tem regra global para `.row`): uma linha compacta que quebra só em tela estreita
    <div className="small dono-conta" data-estado={estado} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <span className="muted" title={AJUDA_DONO_CONTA}>Dono da conta</span>
      {estado === 'COM_DONO' && <b>{nome(atual)}</b>}
      {estado === 'SEM_DONO' && <Badge tone="warn">sem dono</Badge>}
      {estado === 'DONO_INATIVO' && <><b>{nome(atual)}</b><Badge tone="warn" title="O usuário está inativo: a conta fica sem dono válido até alguém ser definido.">inativo</Badge></>}
      {empresa.mescladaEm
        ? <span className="muted">· conta mesclada: o dono é definido na <Link to={`/radar/empresas/${empresa.mescladaEm}`}>conta canônica</Link></span>
        : podeEditar && (pedido
          ? <ConfirmarMudancaDono rotulo={rotuloMudancaDono(atual && nome(atual), pedido.usuarioId === null ? null : nome(pedido.usuarioId))} motivo={motivo} erro={erro} onMotivo={setMotivo} onConfirmar={confirmar} onCancelar={cancelar} />
          : (
            <>
              <Select value={escolha} onChange={setEscolha} options={opcoes} allowEmpty={atual ? 'Trocar por…' : 'Definir dono…'} aria-label="Escolher o dono da conta" style={{ width: 'auto', minWidth: 200 }} />
              {escolha && <button className="btn sm primary" onClick={() => pedir(escolha)}>{atual ? 'Trocar' : 'Definir'}</button>}
              {atual && <button className="btn sm" onClick={() => pedir(null)}>Remover</button>}
            </>
          ))}
    </div>
  );
}
