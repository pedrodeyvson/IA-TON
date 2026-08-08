/**
 * Só aceita caminho interno como destino pós-login.
 *
 * `?destino=` vem da URL, ou seja, de quem mandar o link. Sem esta checagem,
 * `//evil.com` seria resolvido pelo navegador contra a origem atual e viraria
 * `https://evil.com` — a vítima faz login de verdade e depois é levada para
 * fora, com a aparência de que o app a mandou. Barrar `//` e `/\` é o que
 * separa caminho interno de URL protocol-relative.
 */
export function destinoSeguro(bruto: unknown): string {
  if (typeof bruto !== "string") return "/inbox";
  if (!bruto.startsWith("/")) return "/inbox";
  if (bruto.startsWith("//") || bruto.startsWith("/\\")) return "/inbox";
  return bruto;
}
