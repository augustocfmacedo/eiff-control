// Tipos do gerador do SHA do build (scripts/gerar-build-sha.mjs), para a suite poder exercitar as
// funcoes puras sem `any`. O script em si continua sendo JavaScript de build, sem dependencia nova.
export declare const ARQUIVO: string;
export declare function shaDeAmbiente(env?: Record<string, string | undefined>): { sha: string | null; origem: 'COMMIT_REF' | null };
export declare function conteudoDoModulo(info: { sha: string | null; origem: 'COMMIT_REF' | null }): string;
