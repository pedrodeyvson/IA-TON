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
 * `content` chega ora como objeto, ora como string JSON serializada
 * (Baileys) — mesma causa raiz de `mensagem.ts`/`parseConteudo`. Sem isto,
 * `conteudo?.contextInfo` numa string sempre devolvia `undefined`.
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
 * Extrai a atribuição de anúncio do `contextInfo` que a UAZAPI repassa cru do
 * protocolo do WhatsApp. Esse repasse NÃO está na spec oficial da UAZAPI — é
 * comportamento observado. Por isso todo campo é opcional e o objeto original
 * é preservado em `referralRaw`.
 *
 * `contextInfo` aparece em posições diferentes dependendo do tipo de
 * mensagem: direto na raiz de `content` (formato antigo/flat), ou aninhado em
 * `message.extendedTextMessage` / `message.imageMessage` / `message.videoMessage`
 * dentro do envelope Baileys (confirmado com fixture real do CPI —
 * `fixtures/reais/webhook-messages-ctwa.json`).
 *
 * ATENÇÃO à grafia: `sourceId`/`sourceUrl` (Baileys) e `sourceID`/`sourceURL`
 * (proto whatsmeow) — as DUAS grafias ocorrem em produção. Evidência real do
 * CPI: `webhook-messages-ctwa.json` traz `sourceId`/`sourceUrl` minúsculos.
 * Aceitar só uma grafia devolve `null` silenciosamente na outra.
 */
export function extrairAtribuicaoAnuncio(conteudo: any): AtribuicaoAnuncio | null {
  const raw = parseConteudo(conteudo);
  if (!raw) return null;

  const contextInfo =
    raw.contextInfo ??
    raw.message?.extendedTextMessage?.contextInfo ??
    raw.message?.imageMessage?.contextInfo ??
    raw.message?.videoMessage?.contextInfo ??
    raw.extendedTextMessage?.contextInfo ??
    null;

  const anuncio = contextInfo?.externalAdReply;
  if (!anuncio) return null;

  return {
    adSourceId: texto(anuncio.sourceId) ?? texto(anuncio.sourceID),
    adSourceUrl: texto(anuncio.sourceUrl) ?? texto(anuncio.sourceURL),
    adTitle: texto(anuncio.title),
    adSourceApp: texto(anuncio.sourceApp) ?? texto(contextInfo.entryPointConversionApp),
    adConversionSource: texto(contextInfo.conversionSource) ?? texto(contextInfo.entryPointConversionSource),
    ctwaClid: texto(anuncio.ctwaClid),
    referralRaw: contextInfo,
  };
}
