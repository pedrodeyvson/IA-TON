// Puro: sem React, sem alias, testável sob node --test.

/** Base sentinela para resolver o candidato. Nunca sai daqui — só serve para
 *  perguntar ao parser se a string mudaria de origem. */
const BASE_SENTINELA = "https://base.invalid";

/**
 * Só aceita caminho interno como destino pós-login.
 *
 * A decisão é delegada ao MESMO parser de URL que o navegador usa, em vez de
 * comparar prefixos: a spec WHATWG remove tab, CR e LF antes de parsear, de
 * modo que "/\t/evil.com" vira https://evil.com/ e engana qualquer checagem
 * de `startsWith`. Perguntar ao parser se a origem mudou fecha a classe
 * inteira de bypass por normalização, em vez de caçar caractere por
 * caractere.
 */
export function destinoSeguro(bruto: unknown): string {
  if (typeof bruto !== "string") return "/inbox";
  if (!bruto.startsWith("/")) return "/inbox";

  let url: URL;
  try {
    url = new URL(bruto, BASE_SENTINELA);
  } catch {
    return "/inbox";
  }

  // Mudou de origem ao ser resolvido: era URL disfarçada de caminho.
  if (url.origin !== BASE_SENTINELA) return "/inbox";

  // Devolve a forma já normalizada pelo parser, não a string crua.
  return `${url.pathname}${url.search}${url.hash}`;
}
