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

export function classificarMensagem(item: any): MensagemNormalizada {
  const conteudoBruto = item?.content ?? {};
  const timestamp = Number(item?.messageTimestamp);

  const base = {
    providerMessageId: item?.messageid ?? item?.id ?? item?.key?.id ?? null,
    direcao: (item?.fromMe ? "out" : "in") as "in" | "out",
    timestampMs: Number.isFinite(timestamp) && timestamp > 0 ? timestamp * 1000 : null,
  };

  const texto = conteudoBruto.conversation ?? conteudoBruto.extendedTextMessage?.text ?? null;
  if (typeof texto === "string") {
    return { ...base, tipo: "texto", conteudo: texto, mediaMime: null, mediaFilename: null };
  }

  for (const [chave, tipo] of MAPA_MIDIA) {
    const midia = conteudoBruto[chave];
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
