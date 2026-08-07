export type AtribuicaoAnuncio = {
  adSourceId: string | null;
  adSourceUrl: string | null;
  adTitle: string | null;
  adSourceApp: string | null;
  adConversionSource: string | null;
  ctwaClid: string | null;
  referralRaw: unknown;
};

function texto(valor: unknown): string | null {
  return typeof valor === "string" && valor.length > 0 ? valor : null;
}

/**
 * Extrai a atribuição de anúncio do `contextInfo` que a UAZAPI repassa cru do
 * protocolo do WhatsApp. Esse repasse NÃO está na spec oficial da UAZAPI — é
 * comportamento observado. Por isso todo campo é opcional e o objeto original
 * é preservado em `referralRaw`.
 *
 * ATENÇÃO à grafia: `sourceID` e `sourceURL` são MAIÚSCULAS (naming do proto
 * whatsmeow). Baileys/Evolution usam sourceId/sourceUrl — usar a grafia errada
 * devolve undefined silenciosamente.
 */
export function extrairAtribuicaoAnuncio(conteudo: any): AtribuicaoAnuncio | null {
  const contextInfo = conteudo?.contextInfo;
  const anuncio = contextInfo?.externalAdReply;
  if (!anuncio) return null;

  return {
    adSourceId: texto(anuncio.sourceID),
    adSourceUrl: texto(anuncio.sourceURL),
    adTitle: texto(anuncio.title),
    adSourceApp: texto(anuncio.sourceApp) ?? texto(contextInfo.entryPointConversionApp),
    adConversionSource: texto(contextInfo.conversionSource) ?? texto(contextInfo.entryPointConversionSource),
    ctwaClid: texto(anuncio.ctwaClid),
    referralRaw: contextInfo,
  };
}
