import { normalizarCandidato } from "../telefone.ts";

const PROFUNDIDADE_MAXIMA = 5;

// Identidade da CONVERSA: quem é o outro lado do chat. Vale nos dois sentidos
// — enviada por nós ou recebida — porque remoteJid/chatid nunca mudam de
// significado conforme quem mandou a mensagem específica.
const CHAVES_DE_CONVERSA = new Set([
  "remotejid", "remotejidalt", "previousremotejid",
  // Grafia snake_case observada em payload real da UAZAPI (ver
  // fixtures/reais/webhook-real-messages.json e webhook-live-message.json) —
  // o parser antigo só reconhecia camelCase (senderPn) aninhado sob `key`.
  "chatid",
]);

// Identidade de QUEM ENVIOU a mensagem específica. Só é uma pista válida do
// CLIENTE quando quem enviou foi ele (mensagem recebida, fromMe: false).
// Numa mensagem nossa (fromMe: true — inclusive respondida direto pelo app,
// fora da API), sender/senderPn/participant apontam para o número da própria
// empresa. Bug real (08/08/2026): resposta manual pelo WhatsApp criou um lead
// novo ANCORADO NO NÚMERO DA TON, porque sender_pn (o número de quem enviou,
// que nesse caso éramos nós) era checado antes de chatid (o número do
// cliente, que estava certo o tempo todo).
const CHAVES_DE_REMETENTE = new Set([
  "senderpn", "participantpn", "sender", "participant", "participantalt",
  "sender_pn", "participant_pn",
]);

const CHAVES_DE_IDENTIDADE = new Set([...CHAVES_DE_CONVERSA, ...CHAVES_DE_REMETENTE]);

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
 * `ignorarRemetente` (mensagem fromMe) pula qualquer campo cuja CHAVE seja
 * explicitamente de remetente — o casamento por conteúdo (`@s.whatsapp.net`
 * solto, sem chave reconhecida) continua valendo, é best-effort de qualquer jeito.
 */
export function coletarCandidatos(
  entrada: any,
  saida: string[] = [],
  profundidade = 0,
  ignorarRemetente = false,
): string[] {
  if (!entrada || typeof entrada !== "object" || profundidade > PROFUNDIDADE_MAXIMA) return saida;
  for (const [chave, valor] of Object.entries(entrada)) {
    const chaveLower = chave.toLowerCase();
    if (ignorarRemetente && CHAVES_DE_REMETENTE.has(chaveLower)) continue;
    if (typeof valor === "string") {
      if ((valor.includes("@s.whatsapp.net") || ehChaveDeIdentidade(chaveLower)) && !ehLid(valor)) {
        saida.push(valor);
      }
    } else if (valor && typeof valor === "object") {
      coletarCandidatos(valor, saida, profundidade + 1, ignorarRemetente);
    }
  }
  return saida;
}

export function resolverTelefoneReal(
  dados: any,
  key: any,
): { telefone: string; jid: string | null } {
  // Mesmo sinal que classificarMensagem (mensagem.ts) já usa para direcao.
  const souEu = Boolean(key?.fromMe ?? dados?.fromMe);

  const candidatosConversa = [
    key?.remoteJid, key?.remoteJidAlt, key?.previousRemoteJid, dados?.chatid,
  ];
  // Campos de remetente só valem como pista do cliente quando o cliente foi
  // quem enviou. Numa mensagem nossa eles apontam para nós mesmos — usá-los
  // aqui é exatamente o bug que criava lead duplicado com o número da Ton.
  const candidatosRemetente = souEu ? [] : [
    key?.participantAlt, key?.senderPn, key?.participantPn,
    dados?.senderPn, dados?.participantPn, dados?.sender_pn,
    dados?.sender, dados?.participant,
  ];

  const candidatos = [
    ...candidatosConversa,
    ...candidatosRemetente,
    ...coletarCandidatos(dados, [], 0, souEu),
  ];

  let primeiroLid: string | null = null;
  // chatlid é a identidade da CONVERSA em formato LID — vale nos dois
  // sentidos, igual chatid/remoteJid.
  if (ehLid(dados?.chatlid)) primeiroLid = dados.chatlid;
  // sender_lid só é uma pista útil do cliente quando ele foi quem enviou —
  // mesma ressalva de candidatosRemetente acima.
  if (!primeiroLid && !souEu && ehLid(dados?.sender_lid)) primeiroLid = dados.sender_lid;

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
