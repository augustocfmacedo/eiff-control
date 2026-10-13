-- Papel Solicitante: pessoa da equipe que SO conversa com o Diretor Financeiro virtual para pedir pagamentos e acompanha os
-- proprios pedidos (decisao do Augusto em 13/10/2026). Esta migration so cria o valor do enum: um valor novo de enum nao pode
-- ser usado na mesma transacao em que nasce, entao o acesso (funcoes e fechamento das politicas) vem na 0067.
alter type role_kind add value if not exists 'Solicitante';
