export function apenasDigitos(valor: string | null | undefined): string {
  return (valor ?? "").replace(/\D+/g, "");
}

/**
 * Chave canônica de comparação: remove o 9º dígito dos celulares brasileiros.
 * O WhatsApp devolve o mesmo contato ora com ele, ora sem — comparar pelo bruto
 * duplica o lead.
 */
export function normalizarTelefoneBr(telefone: string | null | undefined): string {
  const d = apenasDigitos(telefone);
  if (!d) return "";
  if (d.length === 13 && d.startsWith("55") && d[4] === "9") {
    return d.slice(0, 4) + d.slice(5);
  }
  return d;
}

/**
 * Aceita um candidato a telefone vindo do payload e devolve o número completo
 * com DDI, ou vazio se não for um telefone brasileiro plausível. Serve para
 * filtrar identificadores internos do WhatsApp (LID), que são bem mais longos.
 */
export function normalizarCandidato(valor: string | null | undefined): string {
  const d = apenasDigitos(valor);
  if (!d) return "";
  if (d.length === 10 || d.length === 11) return `55${d}`;
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) return d;
  return "";
}
