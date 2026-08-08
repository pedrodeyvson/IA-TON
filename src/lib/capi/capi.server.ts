// Server-only: envia eventos de conversão para a Meta Conversions API (CAPI)
// em modo business_messaging (WhatsApp). Replicado de CPI
// (src/lib/meta-capi.server.ts), adaptado ao nosso modelo mais simples: uso
// individual, sem organizações, config por variável de ambiente em vez de
// tabela.
//
// Endpoint: POST https://graph.facebook.com/v21.0/{pixel_id}/events
// Confirmado lendo CPI — mesma versão da API (v21.0) usada lá em produção.
//
// A Meta NÃO deduplica eventos de business messaging — a deduplicação é
// nossa, via a tabela `eventos_capi` (lead_id + nome_evento + status_resposta
// = "ok"). Best-effort: nunca lança exceção — falha do CAPI não pode custar
// o processamento da mensagem/lead que originou o evento.
import { jaFoiEnviado, eventosParaDisparar, type EventoCapi } from "./capi.constants.ts";
import { construirUserDataHasheado, montarPayloadEvento, type DadosCustomCapi } from "./hash.ts";

const META_API_VERSION = "v21.0";
const META_CAPI_URL = `https://graph.facebook.com/${META_API_VERSION}`;

export type CapiResult = {
  ok: boolean;
  /** true quando não há META_PIXEL_ID/META_CAPI_TOKEN configurado — não é
   *  erro, é o sistema funcionando sem CAPI habilitado. */
  skipped?: boolean;
  /** true quando o evento já tinha sido enviado com sucesso antes — não
   *  reenviou por dedup, não é erro. */
  duplicate?: boolean;
  eventId?: string;
  error?: string;
};

/**
 * Extrai da resposta de erro da Meta o texto que realmente identifica o
 * problema. `error.message` é genérico ("Invalid parameter") e sozinho não
 * permite diagnosticar nada; `error_subcode` e `error_user_msg` é que dizem o
 * quê. Cai para o corpo cru se a resposta não for o JSON de erro esperado.
 */
export function detalharErroMeta(parsed: any, corpoCru: string): string {
  const erro = parsed?.error;
  if (!erro) return corpoCru;
  const partes = [
    erro.error_subcode != null ? `subcode ${erro.error_subcode}` : null,
    erro.error_user_msg || erro.error_user_title || null,
    erro.message || null,
  ].filter(Boolean);
  return partes.length > 0 ? partes.join(" | ") : corpoCru;
}

export type DadosUsuarioEnvio = {
  /** texto puro, nunca hasheado. */
  ctwaClid?: string | null;
  telefone?: string | null;
  nome?: string | null;
};

/**
 * Envia um evento de conversão (business_messaging/WhatsApp) para o Pixel da
 * Meta. Faz a deduplicação contra `eventos_capi` antes de enviar, e grava o
 * resultado (sucesso ou falha) depois. Nunca lança — retorna sempre um
 * `CapiResult`, mesmo em erro de rede ou configuração ausente.
 */
export async function enviarEventoCapi(
  admin: any,
  leadId: string,
  eventName: EventoCapi,
  dadosUsuario: DadosUsuarioEnvio,
  dadosCustom?: DadosCustomCapi,
): Promise<CapiResult> {
  const pixelId = process.env.META_PIXEL_ID;
  const token = process.env.META_CAPI_TOKEN;
  const pageId = process.env.META_PAGE_ID;

  // Degrada em silêncio: o sistema tem que funcionar sem CAPI configurado.
  if (!pixelId || !token) {
    return { ok: false, skipped: true };
  }

  // Pixel e token configurados MAS sem page_id não é "CAPI desligado", é
  // configuração pela metade: a Meta recusa 100% dos eventos de
  // business_messaging sem `user_data.page_id` (subcode 2804116). Enviar
  // assim só enche `eventos_capi` de erro e esconde o problema real — pula
  // e reclama alto, para o dono ver que a atribuição está morta.
  if (!pageId) {
    console.warn(
      `[capi] META_PAGE_ID ausente — ${eventName} do lead ${leadId} não foi enviado. ` +
        "A Meta recusa business_messaging sem page_id (subcode 2804116) e a atribuição de anúncio fica sem nenhum evento.",
    );
    return { ok: false, skipped: true, error: "META_PAGE_ID ausente" };
  }

  try {
    const { data: existentes, error: erroConsulta } = await admin
      .from("eventos_capi")
      .select("nome_evento, status_resposta")
      .eq("lead_id", leadId)
      .eq("nome_evento", eventName);

    if (erroConsulta) {
      console.warn(`[capi] falha ao consultar dedup de ${eventName} para lead ${leadId}:`, erroConsulta.message);
    } else if (jaFoiEnviado(existentes ?? [], eventName)) {
      return { ok: true, skipped: true, duplicate: true };
    }
  } catch (err: any) {
    // Falha na checagem de dedup não pode impedir a tentativa de envio —
    // registra e segue (pior caso: um evento duplicado, não a perda dele).
    console.warn(`[capi] exceção ao consultar dedup de ${eventName} para lead ${leadId}:`, err?.message ?? err);
  }

  const eventId = crypto.randomUUID();
  let payloadParaGravar: any = null;

  try {
    const userData = await construirUserDataHasheado({
      ctwa_clid: dadosUsuario.ctwaClid,
      page_id: pageId,
      telefone: dadosUsuario.telefone,
      nome: dadosUsuario.nome,
      externalId: leadId,
    });

    const payload = montarPayloadEvento({
      eventName,
      eventId,
      eventTime: Math.floor(Date.now() / 1000),
      userData,
      customData: dadosCustom,
      testEventCode: process.env.META_CAPI_TEST_CODE,
    });
    payloadParaGravar = payload;

    const url = `${META_CAPI_URL}/${pixelId}/events?access_token=${encodeURIComponent(token)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });

    const texto = await res.text();
    let parsed: any = null;
    try { parsed = JSON.parse(texto); } catch { /* ignore */ }

    const ok = res.ok;
    // `error.message` da Meta é sempre genérico ("Invalid parameter"). O que
    // diz QUAL parâmetro está errado é `error_user_msg` + `error_subcode`;
    // gravar só a mensagem genérica deixa a linha de erro inútil para
    // diagnóstico. Ordem: detalhe primeiro, porque o campo é truncado.
    const statusResposta = ok
      ? "ok"
      : `erro:${res.status}:${detalharErroMeta(parsed, texto).slice(0, 200)}`;

    try {
      await admin.from("eventos_capi").insert({
        lead_id: leadId,
        nome_evento: eventName,
        event_id: eventId,
        enviado_em: new Date().toISOString(),
        status_resposta: statusResposta,
        payload,
        resposta: parsed ?? { texto_cru: texto.slice(0, 500) },
      });
    } catch (err: any) {
      console.warn(`[capi] falha ao gravar registro de ${eventName} para lead ${leadId}:`, err?.message ?? err);
    }

    if (!ok) {
      const errorMsg = detalharErroMeta(parsed, texto).slice(0, 300);
      console.error("[capi] erro ao enviar evento:", { status: res.status, event: eventName, error: errorMsg });
      return { ok: false, eventId, error: errorMsg };
    }

    console.log("[capi] evento enviado:", { event: eventName, events_received: parsed?.events_received, fbtrace_id: parsed?.fbtrace_id });
    return { ok: true, eventId };
  } catch (err: any) {
    console.error("[capi] exceção ao enviar evento:", err?.message ?? err);
    try {
      await admin.from("eventos_capi").insert({
        lead_id: leadId,
        nome_evento: eventName,
        event_id: eventId,
        enviado_em: new Date().toISOString(),
        status_resposta: `erro:exceção:${String(err?.message ?? err).slice(0, 200)}`,
        payload: payloadParaGravar ?? null,
      });
    } catch { /* best-effort — não pode quebrar o fluxo principal */ }
    return { ok: false, eventId, error: err?.message ?? "Erro desconhecido" };
  }
}

export type DadosParaSincronizar = {
  /** O ctwaClid é o que decide se dá para enviar. A Meta exige `ctwa_clid` em
   *  `business_messaging`: sem ele o evento volta 400/subcode 2804071, mesmo
   *  com adSourceId presente. Um lead pode chegar de anúncio com sourceId e
   *  sem clid — é atribuição válida para o nosso CRM, mas não para a CAPI. */
  ctwaClid?: string | null;
  /** Só informativo, em `custom_data.source_id`. Nunca habilita o envio
   *  sozinho — ver acima. */
  adSourceId?: string | null;
  telefone?: string | null;
  nome?: string | null;
  /** BRL. Ausente cai no padrão de COMISSAO_PADRAO_BRL, se configurado. */
  comissaoEstimada?: number | null;
};

/**
 * Dispara, em ordem de cascata, os eventos que faltam para o estágio atual
 * do lead. Chamada em dois lugares: (1) por moverEstagio, na hora da
 * transição; (2) pelo ingest.server.ts a cada mensagem nova do lead — é o
 * self-healing, porque um evento que falhou numa tentativa anterior é
 * retentado sem precisar de uma nova transição de estágio.
 *
 * Para na cascata assim que um evento falhar: não teria sentido tentar
 * Purchase se InitiateCheckout ainda não saiu, e a próxima chamada (próxima
 * mensagem do lead, ou próxima transição) retoma dali. É a correção
 * deliberada do bug do CPI, onde o agendamento é limpo mesmo com falha e um
 * Purchase que não saiu nunca mais é tentado.
 *
 * Nunca lança — best-effort, como toda a integração de CAPI.
 */
export async function sincronizarEventosCapi(
  admin: any,
  leadId: string,
  estagioAtual: string,
  dados: DadosParaSincronizar,
): Promise<void> {
  if (!dados.ctwaClid) return;

  try {
    const { data: existentes } = await admin
      .from("eventos_capi")
      .select("nome_evento, status_resposta")
      .eq("lead_id", leadId);

    const jaEnviados = (existentes ?? [])
      .filter((r: any) => r.status_resposta === "ok")
      .map((r: any) => r.nome_evento);

    const pendentes = eventosParaDisparar(estagioAtual, jaEnviados);
    const valorPadrao = Number(process.env.COMISSAO_PADRAO_BRL ?? "");
    const valorPurchase =
      dados.comissaoEstimada ?? (Number.isFinite(valorPadrao) && valorPadrao > 0 ? valorPadrao : undefined);

    for (const { evento } of pendentes) {
      const customData =
        evento === "Purchase"
          ? { value: valorPurchase, currency: "BRL", source_id: dados.adSourceId ?? undefined }
          : dados.adSourceId
            ? { source_id: dados.adSourceId }
            : undefined;

      const resultado = await enviarEventoCapi(
        admin,
        leadId,
        evento,
        { ctwaClid: dados.ctwaClid, telefone: dados.telefone, nome: dados.nome },
        customData,
      );

      if (!resultado.ok) break;
    }
  } catch (err: any) {
    console.warn(`[capi] falha ao sincronizar eventos do lead ${leadId}:`, err?.message ?? err);
  }
}

/**
 * Disparos CAPI de um lead, mais recente primeiro — para o painel mostrar o
 * que foi mandado e o que a Meta respondeu. Só para o dono (a chamada em
 * crm.functions.ts já está atrás de exigirSessao): o payload carrega
 * ph/external_id hasheados e o ctwa_clid em texto puro.
 */
export async function listarDisparosCapi(admin: any, leadId: string): Promise<any[]> {
  const { data } = await admin
    .from("eventos_capi")
    .select("id, nome_evento, event_id, enviado_em, status_resposta, payload, resposta")
    .eq("lead_id", leadId)
    .order("enviado_em", { ascending: false, nullsFirst: false });
  return data ?? [];
}
