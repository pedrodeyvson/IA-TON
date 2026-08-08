// Módulo puro (sem I/O) — sem sufixo .server para poder ser testado sem mocks.

/**
 * Sanitiza um valor vindo de fora (ex.: providerMessageId do payload do
 * WhatsApp) para uso seguro como segmento de path no Storage.
 *
 * Mantém só [A-Za-z0-9_-]; qualquer outro caractere — incluindo `/`, `.`,
 * espaços e afins — vira `_`. Isso elimina travessia de diretório (`../`)
 * sem precisar reconhecer o padrão explicitamente: `.` e `/` nunca sobrevivem
 * à sanitização, então não há como formar `..` nem cruzar um separador.
 *
 * Whitelist de caracteres em vez de hash porque:
 * - é determinístico (mesma entrada → mesma saída), o que `upsert: true`
 *   exige para não duplicar o mesmo arquivo em paths diferentes;
 * - preserva o valor original o quanto der, então o path continua legível
 *   e útil pra depuração (dá pra reconhecer o id da mensagem no nome do
 *   arquivo no Storage);
 * - providerMessageId da UAZAPI já costuma ser alfanumérico simples, então
 *   o caso comum passa praticamente inalterado — só o raro caractere hostil
 *   é que é substituído.
 *
 * Entrada vazia, nula, ou que sanitiza para algo sem nenhum caractere
 * alfanumérico (ex.: `"///..."` vira só underscores) cai no `fallback` — uma
 * string de puros separadores não carrega identidade nenhuma da mensagem
 * original, então não vale a pena preservar.
 */
export function sanitizarSegmentoPath(
  valor: string | null | undefined,
  fallback = "sem-id",
): string {
  const limpo = (valor ?? "").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 128);
  return /[A-Za-z0-9]/.test(limpo) ? limpo : fallback;
}
