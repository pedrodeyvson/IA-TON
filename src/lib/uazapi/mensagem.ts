export type TipoMensagem =
  | "texto" | "audio" | "imagem" | "video" | "documento" | "sticker" | "outro";

export type MensagemNormalizada = {
  providerMessageId: string | null;
  direcao: "in" | "out";
  tipo: TipoMensagem;
  conteudo: string | null;
  mediaMime: string | null;
  mediaFilename: string | null;
  timestampMs: number | null;
};

const MAPA_MIDIA: Array<[string, TipoMensagem]> = [
  ["audioMessage", "audio"],
  ["imageMessage", "imagem"],
  ["videoMessage", "video"],
  ["documentMessage", "documento"],
  ["stickerMessage", "sticker"],
];

/**
 * `item.content` chega em formas diferentes na UAZAPI real (confirmado com
 * fixtures de produção do CPI — ver `fixtures/reais/`):
 *   1) string com o texto puro, ex.: "Obrigadaaa" — não é JSON, JSON.parse falha.
 *   2) string JSON serializada (Baileys), ex.: "{\"key\":...,\"message\":{...}}".
 *   3) já objeto — única forma que os fixtures antigos (escritos à mão)
 *      assumiam, mas nunca observada em payload real.
 * Sem isto, `content` ficava string, `string.conversation` era `undefined`, e
 * a mensagem inteira caía silenciosamente em tipo "outro"/conteudo null —
 * confirmado no diagnóstico: 6/6 fixtures reais falhavam dessa forma.
 */
function parseConteudo(content: unknown): any {
  if (!content) return null;
  if (typeof content === "object") return content;
  if (typeof content !== "string") return null;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * A UAZAPI manda `messageTimestamp` ora em segundos (Unix), ora já em
 * milissegundos (13 dígitos) — observado em payload real de histórico
 * (`fixtures/reais/webhook-real-messages.json`, `webhook-live-message.json`).
 * Multiplicar sempre por 1000 gerava timestamps no ano ~58000.
 */
function calcularTimestampMs(bruto: unknown): number | null {
  const n = Number(bruto);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n > 1_000_000_000_000 ? n : n * 1000;
}

export function classificarMensagem(item: any): MensagemNormalizada {
  const conteudoBruto = parseConteudo(item?.content);
  // Envelope Baileys aninha o conteúdo real em `.message`; o formato antigo
  // (fixtures escritas à mão) expõe conversation/audioMessage/etc direto na
  // raiz de `content` — aceita as duas formas.
  const nucleo = conteudoBruto?.message ?? conteudoBruto ?? {};

  const base = {
    providerMessageId: item?.messageid ?? item?.id ?? item?.key?.id ?? conteudoBruto?.key?.id ?? null,
    direcao: (item?.fromMe ? "out" : "in") as "in" | "out",
    timestampMs: calcularTimestampMs(item?.messageTimestamp),
  };

  // Texto: a UAZAPI real já entrega o texto pronto em `item.text` (campo
  // flat no nível raiz) — funciona mesmo quando content é a string plana
  // "Obrigadaaa" (não é JSON, não há nada pra extrair dela). Cai para o
  // conteúdo aninhado (conversation / extendedTextMessage.text) quando
  // `item.text` não vem.
  const textoFlat = typeof item?.text === "string" && item.text.length > 0 ? item.text : null;
  const textoAninhado = nucleo?.conversation ?? nucleo?.extendedTextMessage?.text ?? null;
  const texto = textoFlat ?? (typeof textoAninhado === "string" ? textoAninhado : null);

  if (typeof texto === "string") {
    return { ...base, tipo: "texto", conteudo: texto, mediaMime: null, mediaFilename: null };
  }

  for (const [chave, tipo] of MAPA_MIDIA) {
    const midia = nucleo?.[chave];
    if (midia) {
      return {
        ...base,
        tipo,
        conteudo: typeof midia.caption === "string" ? midia.caption : null,
        mediaMime: typeof midia.mimetype === "string" ? midia.mimetype : null,
        mediaFilename: typeof midia.fileName === "string" ? midia.fileName : null,
      };
    }
  }

  return { ...base, tipo: "outro", conteudo: null, mediaMime: null, mediaFilename: null };
}
