export type EventoUazapi = {
  evento: string;
  instancia: string;
  itens: any[];
};

/**
 * A UAZAPI usa duas formas para mensagens:
 *   1) lote de histórico: { event: "messages", EventType: "history", messages: [...] }
 *   2) mensagem ao vivo:  { EventType: "messages", message: {...} }  ← singular, SEM `event`
 * Esta função reduz as duas a uma forma só.
 */
export function parseWebhookUazapi(body: any): EventoUazapi {
  const categoria: string = body?.event ?? "";
  const tipo: string = body?.EventType ?? categoria;
  const instancia: string = body?.instanceName ?? body?.instance ?? "";

  const bruto = body?.messages ?? body?.message ?? body?.data;
  const itens = Array.isArray(bruto) ? bruto : bruto != null ? [bruto] : [];

  let evento: string;
  if (tipo === "history") evento = "history";
  else if (itens.length > 0 && (tipo === "messages" || categoria === "messages")) evento = "messages";
  else evento = categoria || tipo;

  return { evento, instancia, itens };
}
