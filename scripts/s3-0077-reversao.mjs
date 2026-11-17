// Gera a reversão da 0077 a partir do retrato tirado ANTES da aplicação (docs/seguranca/s3-0077-retrato.sql).
// Uso:  node scripts/s3-0077-reversao.mjs --retrato retrato-antes-0077.json > reversao-0077.sql
// Aceita o JSON puro do retrato ou a saída `-o json` da Supabase CLI (lista de linhas com a coluna `retrato`).
// Só gera texto: não conecta em banco nenhum. Revisar o SQL antes de executar (e só com autorização).
import fs from 'node:fs';
import { gerarReversao } from './lib/s3Reversao.mjs';

const i = process.argv.indexOf('--retrato');
if (i < 0 || !process.argv[i + 1]) { console.error('uso: node scripts/s3-0077-reversao.mjs --retrato <arquivo.json>'); process.exit(2); }
let dado = JSON.parse(fs.readFileSync(process.argv[i + 1], 'utf8').replace(/^﻿/, ''));
if (Array.isArray(dado)) dado = dado[0]?.retrato ?? dado[0];
if (dado?.rows) dado = dado.rows[0]?.retrato;
if (typeof dado === 'string') dado = JSON.parse(dado);
process.stdout.write(gerarReversao(dado));
