import { normalizarCandidato } from "../telefone.ts";

const PROFUNDIDADE_MAXIMA = 5;

const CHAVES_DE_IDENTIDADE = new Set([
  "senderpn", "participantpn", "sender", "participant",
  "remotejid", "remotejidalt", "participantalt", "previousremotejid",
  // Grafia snake_case observada em payload real da UAZAPI (ver
  // fixtures/reais/webhook-real-messages.json e webhook-live-message.json) —
  // o parser antigo só reconhecia camelCase (senderPn) aninhado sob `key`.
  "sender_pn", "chatid", "participant_pn",
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
    // Campos snake_case do formato "flat" real da UAZAPI (sender_pn, chatid)
    // vêm no nível raiz do item, não aninhados sob `key` (Baileys) — checados
    // explicitamente em vez de depender só da varredura recursiva abaixo.
    dados?.senderPn, dados?.participantPn, dados?.sender_pn, dados?.chatid,
    dados?.sender, dados?.participant,
    ...coletarCandidatos(dados),
  ];

  let primeiroLid: string | null = null;
  // sender_lid é o candidato de LID mais confiável quando não há telefone
  // real — preferido sobre qualquer outro @lid encontrado na varredura.
  if (ehLid(dados?.sender_lid)) primeiroLid = dados.sender_lid;

  for (const candidato of candidatos) {
    if (!candidato || typeof candidato !== "string") continue;
    if (ehLid(candidato)) {
      // Guarda o primeiro @lid encontrado: se nenhum telefone real aparecer,
      // é nele que o lead será ancorado — em vez de descartado.
      if (!primeiroLid) primeiroLid = candidato;
      continue;
    }
    const telefone = candidato.includes("@")
      ? extrairTelefoneDeJid(candidato)
      : normalizarCandidato(candidato);
    if (telefone) {
      return { telefone, jid: candidato.includes("@") ? candidato : `${telefone}@s.whatsapp.net` };
    }
  }
  return { telefone: "", jid: primeiroLid };
}
