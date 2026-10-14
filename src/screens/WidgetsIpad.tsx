// Caixa › Widgets do iPad: gera o token de cada aparelho (mostrado UMA vez), entrega o script do Scriptable e revoga.
// A regra mora no banco (RPCs da 0069) e no servidor (/api/widget-caixa); aqui só a intenção do Administrador.
import { useEffect, useState } from 'react';
import { scriptWidgetCaixa } from '../core/widgetScriptable';
import { WidgetsIndisponiveis, criarAparelho, listarAparelhos, revogarAparelho, situacaoAparelho, type AparelhoWidget, type TokenNovo } from '../data/widgets';
import { remotoAtivo } from '../data/supabase';
import { Badge, Field, Modal, Select } from '../ui/components';
import { Tabela, type Coluna } from '../ui/Tabela';

const VALIDADES = [{ value: '365', label: '1 ano' }, { value: '180', label: '6 meses' }, { value: '90', label: '3 meses' }, { value: '30', label: '30 dias' }];
const dh = (iso: string | null) => (iso ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : '—');
const TOM = { ativo: 'ok', revogado: 'muted', vencido: 'warn' } as const;
const COLUNAS: Coluna<AparelhoWidget>[] = [
  { titulo: 'Aparelho', ordenar: (a) => a.nome }, { titulo: 'Situação', ordenar: (a) => situacaoAparelho(a) }, { titulo: 'Criado', ordenar: (a) => a.criadoEm },
  { titulo: 'Vence', ordenar: (a) => a.expiraEm }, { titulo: 'Último uso', ordenar: (a) => a.usadoEm ?? '' }, { titulo: '' },
];

export function WidgetsIpad({ onClose, toast }: { onClose: () => void; toast: (m: string) => void }) {
  const [lista, setLista] = useState<AparelhoWidget[] | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [nome, setNome] = useState('iPad');
  const [dias, setDias] = useState('365');
  const [novo, setNovo] = useState<TokenNovo | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [revogando, setRevogando] = useState<{ id: string; motivo: string } | null>(null);
  const script = scriptWidgetCaixa(typeof window !== 'undefined' && window.location.protocol === 'https:' ? window.location.origin : 'https://eiffcontrol.com.br');

  const recarregar = () => listarAparelhos().then((l) => { setLista(l); setAviso(null); }).catch((e: Error) => { setLista(null); setAviso(e instanceof WidgetsIndisponiveis ? e.message : `Não foi possível listar os aparelhos: ${e.message}`); });
  useEffect(() => { if (remotoAtivo) void recarregar(); else setAviso('Widgets só funcionam no sistema publicado, conectado ao banco.'); }, []);

  const copiar = async (texto: string, ok: string) => { try { await navigator.clipboard.writeText(texto); toast(ok); } catch { toast('Não consegui copiar: selecione o texto e copie.'); } };
  const gerar = async () => {
    setErro(null); setOcupado(true);
    try { setNovo(await criarAparelho(nome, Number(dias))); await recarregar(); }
    catch (e) { setErro((e as Error).message); }
    finally { setOcupado(false); }
  };
  const revogar = async () => {
    if (!revogando) return;
    setErro(null); setOcupado(true);
    try { await revogarAparelho(revogando.id, revogando.motivo); setRevogando(null); if (novo?.id === revogando.id) setNovo(null); toast('Aparelho revogado: o widget dele para na próxima atualização.'); await recarregar(); }
    catch (e) { setErro((e as Error).message); }
    finally { setOcupado(false); }
  };

  return (
    <Modal title="Widgets do iPad" onClose={onClose} wide>
      <p className="small muted" style={{ marginTop: 0 }}>
        O widget mostra o caixa de hoje, o menor saldo, a curva dos próximos 30 dias e o que vence na semana — os mesmos números desta tela.
        Com <b>pedidos</b> no campo Parameter do widget, ele mostra o que a equipe pediu ao Diretor Financeiro, com a orientação para cada pedido, e avisa no iPad quando chega um pedido novo.
        Cada aparelho tem um token próprio, só de leitura, que você pode revogar a qualquer momento. Funciona com o app Scriptable (gratuito).
      </p>
      {aviso && <div className="alert info">{aviso}</div>}
      {erro && <div className="alert warn" role="alert">{erro}</div>}

      {novo ? (
        <div className="card" style={{ marginBottom: 12 }}>
          <h3 style={{ marginTop: 0 }}>Token de “{novo.nome}”</h3>
          <div className="alert warn">Este token aparece só agora. Faça os passos abaixo no próprio iPad; depois de fechar, ele não é mais mostrado.</div>
          <code className="mono" style={{ display: 'block', wordBreak: 'break-all', userSelect: 'all', padding: '8px 0' }}>{novo.token}</code>
          <ol className="small" style={{ paddingLeft: 18, lineHeight: 1.7 }}>
            <li>No iPad, instale o app <b>Scriptable</b> (App Store, gratuito).</li>
            <li>Toque em <b>Copiar script</b>. No Scriptable, toque em +, cole e dê o nome <b>EIFF Caixa</b>.</li>
            <li>Volte aqui, toque em <b>Copiar token</b>, abra o Scriptable e toque no script: ele usa o token copiado, guarda no Keychain do iPad e limpa a área de transferência.</li>
            <li>Na tela de início: toque e segure → Editar → Adicionar widget → Scriptable → escolha o tamanho → toque no widget → Script: <b>EIFF Caixa</b>. Na tela de bloqueio, o mesmo pelo editor da tela de bloqueio.</li>
            <li>Para os pedidos da equipe: adicione outro widget do Scriptable com o mesmo script e escreva <b>pedidos</b> em Parameter. Permita as notificações do Scriptable para receber o aviso de pedido novo.</li>
          </ol>
          <div className="actions">
            <button className="btn primary" onClick={() => copiar(script, 'Script copiado: cole num script novo do Scriptable.')}>Copiar script</button>
            <button className="btn" onClick={() => copiar(novo.token, 'Token copiado: agora toque no script dentro do Scriptable.')}>Copiar token</button>
            <button className="btn" onClick={() => setNovo(null)}>Pronto</button>
          </div>
        </div>
      ) : lista && (
        <div className="form" style={{ marginBottom: 12 }}>
          <Field label="Nome do aparelho" req><input value={nome} maxLength={60} onChange={(e) => setNome(e.target.value)} placeholder="iPad do escritório" /></Field>
          <Field label="Validade"><Select value={dias} onChange={setDias} options={VALIDADES} /></Field>
          <div className="actions full"><button className="btn primary" disabled={ocupado || !nome.trim()} onClick={gerar}>Gerar token para este aparelho</button>
            <button className="btn" onClick={() => copiar(script, 'Script copiado: cole por cima do script EIFF Caixa no Scriptable (o token continua no iPad).')}>Copiar script</button></div>
        </div>
      )}

      {lista && (
        <Tabela<AparelhoWidget> colunas={COLUNAS} linhas={lista} chave={(a) => a.id} vazio="Nenhum aparelho ainda." linha={(a) => {
          const s = situacaoAparelho(a);
          return (<>
            <td>{a.nome} <span className="small muted mono">…{a.final}</span></td>
            <td><Badge tone={TOM[s]} title={a.motivoRevogacao ?? undefined}>{s}</Badge></td>
            <td className="small">{dh(a.criadoEm)}</td>
            <td className="small">{dh(a.expiraEm)}</td>
            <td className="small">{dh(a.usadoEm)}</td>
            <td>{s === 'ativo' && (revogando?.id === a.id
              ? <span className="actions"><input aria-label="Motivo da revogação" value={revogando.motivo} placeholder="motivo (ex.: iPad perdido)" onChange={(e) => setRevogando({ id: a.id, motivo: e.target.value })} />
                  <button className="btn sm danger" disabled={ocupado || revogando.motivo.trim().length < 3} onClick={revogar}>Revogar</button>
                  <button className="btn sm" onClick={() => setRevogando(null)}>Cancelar</button></span>
              : <button className="btn sm" onClick={() => setRevogando({ id: a.id, motivo: '' })}>Revogar</button>)}</td>
          </>);
        }} />
      )}
    </Modal>
  );
}
