// Puro: sem React, sem alias, testável sob node --test.

/** Base sentinela para resolver o candidato. `.invalid` é TLD reservado
 *  (RFC 2606), então não há host real com que colidir. */
const BASE_SENTINELA = "https://base.invalid";
const DESTINO_PADRAO = "/inbox";

/**
 * Resolve contra a base sentinela e devolve o caminho normalizado, ou null se
 * a resolução saiu da origem — isto é, se a string era URL disfarçada.
 */
function resolverInterno(valor: string): string | null {
  let url: URL;
  try {
    url = new URL(valor, BASE_SENTINELA);
  } catch {
    return null;
  }
  if (url.origin !== BASE_SENTINELA) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * Só aceita caminho interno como destino pós-login.
 *
 * A decisão é delegada ao MESMO parser de URL que o navegador usa, em vez de
 * comparar prefixos: a spec WHATWG remove tab, CR e LF antes de parsear, de
 * modo que "/\t/evil.com" vira https://evil.com/ e engana qualquer checagem
 * de `startsWith`.
 *
 * Mas resolver uma vez não basta, e é aqui que a versão anterior falhava:
 * "/.//evil.com" resolve COM a origem certa (a sentinela) e mesmo assim
 * produz o pathname "//evil.com" — protocol-relative de novo, agora fabricado
 * pela própria remoção de dot-segments. Por isso a saída passa pelo mesmo
 * teste da entrada: só é aceita se resolver para si mesma. Exigir esse ponto
 * fixo é o que fecha a classe, em vez de caçar padrão por padrão.
 */
export function destinoSeguro(bruto: unknown): string {
  if (typeof bruto !== "string") return DESTINO_PADRAO;
  if (!bruto.startsWith("/")) return DESTINO_PADRAO;

  const caminho = resolverInterno(bruto);
  if (caminho === null) return DESTINO_PADRAO;

  // Ponto fixo: se resolver o resultado der outra coisa, a normalização
  // fabricou algo que a primeira passagem não viu.
  if (resolverInterno(caminho) !== caminho) return DESTINO_PADRAO;

  return caminho;
}
