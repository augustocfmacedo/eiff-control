import { describe, expect, it } from 'vitest';
import { actions } from './store';

describe('criar senha e esqueci minha senha (validações antes de falar com o Supabase)', () => {
  it('senha curta ou diferente da confirmação é recusada', async () => {
    await expect(actions.definirSenha('curta', 'curta')).rejects.toThrow(/8 caracteres/);
    await expect(actions.definirSenha('senha-boa-123', 'senha-boa-124')).rejects.toThrow(/não conferem/);
  });
  it('e-mail inválido é recusado; e-mail válido segue para o Supabase (aqui, não configurado)', async () => {
    await expect(actions.pedirNovaSenha('sem-arroba')).rejects.toThrow(/Informe o seu e-mail/);
    await expect(actions.pedirNovaSenha('a@b')).rejects.toThrow(/Informe o seu e-mail/);
    await expect(actions.pedirNovaSenha(' Fulano@EIFF.com.br ')).rejects.toThrow(/Supabase não configurado/);
  });
});
