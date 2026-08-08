/**
 * Comparação em tempo constante: evita que a diferença de tempo entre
 * comparações revele o segredo caractere a caractere.
 */
export function comparacaoSegura(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diferenca = 0;
  for (let i = 0; i < a.length; i++) diferenca |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diferenca === 0;
}
