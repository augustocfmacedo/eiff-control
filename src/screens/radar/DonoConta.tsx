// CD-D5.1 — campo compacto "Dono da conta" na ficha da empresa (docs/commercial-director-1.0.md §19.3).
//
// Só projeta o estado (`estadoDonoConta`) e devolve a intenção humana por `onDefinir`: quem grava é a tela, sempre por
// `actions.definirDonoContaRadar` (permissão `radar`, usuário ativo da organização, auditoria, falha fechada). Nenhuma
// regra de dono vive aqui. O dono da conta não é o responsável da oportunidade, da tarefa nem o derivado pela fila.
import React, { useState } from 'react';
import { estadoDonoConta, type Empresa } from '../../core/radar';
import { Badge, Link, Select } from '../../ui/components';

export interface UsuarioOpcaoDono {
  id: string;
  nome: string;
  ativo: boolean;
}

export const AJUDA_DONO_CONTA = 'Responsável comercial pela conta. Não muda o responsável das tarefas nem das oportunidades.';

export function DonoConta({ empresa, usuarios, podeEditar, onDefinir }: {
  empresa: Pick<Empresa, 'id' | 'commercialOwnerId' | 'mescladaEm'>;
  usuarios: readonly UsuarioOpcaoDono[];
  podeEditar: boolean;
  /** usuário escolhido, ou `null` para remover */
  onDefinir: (usuarioId: string | null) => void;
}) {
  const [escolha, setEscolha] = useState('');
  const estado = estadoDonoConta(empresa, usuarios);
  const atual = empresa.commercialOwnerId?.trim() || undefined;
  const nome = (id?: string) => usuarios.find((u) => u.id === id)?.nome ?? 'usuário fora da organização';
  const opcoes = usuarios
    .filter((u) => u.ativo && u.id !== atual)
    .map((u) => ({ value: u.id, label: u.nome }))
    .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
  return (
    // layout próprio (o app não tem regra global para `.row`): uma linha compacta que quebra só em tela estreita
    <div className="small dono-conta" data-estado={estado} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <span className="muted" title={AJUDA_DONO_CONTA}>Dono da conta</span>
      {estado === 'COM_DONO' && <b>{nome(atual)}</b>}
      {estado === 'SEM_DONO' && <Badge tone="warn">sem dono</Badge>}
      {estado === 'DONO_INATIVO' && <><b>{nome(atual)}</b><Badge tone="warn" title="O usuário está inativo: a conta fica sem dono válido até alguém ser definido.">inativo</Badge></>}
      {empresa.mescladaEm
        ? <span className="muted">· conta mesclada: o dono é definido na <Link to={`/radar/empresas/${empresa.mescladaEm}`}>conta canônica</Link></span>
        : podeEditar && (
          <>
            <Select value={escolha} onChange={setEscolha} options={opcoes} allowEmpty={atual ? 'Trocar por…' : 'Definir dono…'} aria-label="Escolher o dono da conta" style={{ width: 'auto', minWidth: 200 }} />
            {escolha && <button className="btn sm primary" onClick={() => { onDefinir(escolha); setEscolha(''); }}>{atual ? 'Trocar' : 'Definir'}</button>}
            {atual && <button className="btn sm" onClick={() => onDefinir(null)}>Remover</button>}
          </>
        )}
    </div>
  );
}
