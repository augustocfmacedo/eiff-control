import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // PORT permite que o host escolha a porta (preview do Claude); padrao 5173
  server: { port: Number(process.env.PORT) || 5173, strictPort: !!process.env.PORT },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // testes sempre no modo local, mesmo com .env apontando para o Supabase
    env: { VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' },
  },
} as any);
