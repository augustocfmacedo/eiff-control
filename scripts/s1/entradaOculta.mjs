// S1 — entrada OCULTA de credencial para os scripts da R3 (Windows PowerShell 5.1 e 7, sem Read-Host -MaskInput).
// A chave vem só do teclado de um terminal interativo: nunca de variável de ambiente, arquivo, argumento ou pipe; não é
// ecoada, não vai para o histórico do terminal e só existe na memória do processo que chamou.
export function lerOculto(rotulo) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    return Promise.reject(new Error('sem terminal interativo: rode direto no PowerShell, sem redirecionar a entrada'));
  }
  process.stdout.write(rotulo);
  process.stdin.setRawMode(true);
  process.stdin.setEncoding('utf8');
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let v = '';
    const fim = (ok) => {
      process.stdin.removeListener('data', ao);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
      if (ok) resolve(v); else reject(new Error('cancelado'));
    };
    const ao = (s) => {
      for (const ch of s) {
        if (ch === '\r' || ch === '\n') return fim(true);
        if (ch === '\u0003' || ch === '\u001b') return fim(false); // Ctrl+C ou Esc
        if (ch === '\b' || ch === '\u007f') { v = v.slice(0, -1); continue; }
        if (ch >= ' ') v += ch;
      }
    };
    process.stdin.on('data', ao);
  });
}
