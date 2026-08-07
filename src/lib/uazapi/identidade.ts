import { normalizarCandidato } from "../telefone.ts";

const PROFUNDIDADE_MAXIMA = 5;

const CHAVES_DE_IDENTIDADE = new Set([
  "senderpn", "participantpn", "sender", "participant",
  "remotejid", "remotejidalt", "participantalt", "previousremotejid",
]);

export function ehLid(jid: string | null | undefined): boolean {
  return !!jid && jid.includes("@lid");
}

export function extrairTelefoneDeJid(jid: string | null | undefined): string {
  if (!jid) return "";
  const bruto = jid.split("@")[0] ?? "";
  return normalizarCandidato(bruto);
}

function ehChaveDeIdentidade(chave: string): boolean {
  return CHAVES_DE_IDENTIDADE.has(chave.toLowerCase());
}

/**
 * Varre o payload atrás de strings que pareçam identidade de contato,
 * ignorando LIDs. Limitada em profundidade para não estourar em payload grande.
 */
export function coletarCandidatos(entrada: any, saida: string[] = [], profundidade = 0): string[] {
  if (!entrada || typeof entrada !== "object" || profundidade > PROFUNDIDADE_MAXIMA) return saida;
  for (const [chave, valor] of Object.entries(entrada)) {
    if (typeof valor === "string") {
      if ((valor.includes("@s.whatsapp.net") || ehChaveDeIdentidade(chave)) && !ehLid(valor)) {
        saida.push(valor);
      }
    } else if (valor && typeof valor === "object") {
      coletarCandidatos(valor, saida, profundidade + 1);
    }
  }
  return saida;
}

export function resolverTelefoneReal(
  dados: any,
  key: any,
): { telefone: string; jid: string | null } {
  const candidatos = [
    key?.remoteJid, key?.remoteJidAlt, key?.participantAlt, key?.senderPn,
    key?.participantPn, key?.previousRemoteJid,
    dados?.senderPn, dados?.participantPn, dados?.sender, dados?.participant,
    ...coletarCandidatos(dados),
  ];

  for (const candidato of candidatos) {
    if (!candidato || typeof candidato !== "string" || ehLid(candidato)) continue;
    const telefone = candidato.includes("@")
      ? extrairTelefoneDeJid(candidato)
      : normalizarCandidato(candidato);
    if (telefone) {
      return { telefone, jid: candidato.includes("@") ? candidato : `${telefone}@s.whatsapp.net` };
    }
  }
  return { telefone: "", jid: null };
}
