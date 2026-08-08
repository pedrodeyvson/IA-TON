// Hashing e montagem de payload para a Meta Conversions API — lógica pura,
// sem rede. Replicado de CPI (src/lib/meta-capi.server.ts). Usa a Web Crypto
// API (crypto.subtle), disponível globalmente em Node 20+.

import type { EventoCapi } from "./capi.constants.ts";

/** SHA-256 hex de uma string. */
export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Normaliza nome para hashing no padrão exigido pela Meta: minúsculo, sem
 *  acento, só letras/espaço. */
export function normalizarNome(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/[^\x00-\x7f]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .trim();
}

export type DadosUsuarioCapi = {
  /** Texto puro — NUNCA hasheado. Único identificador de clique do CTWA. */
  ctwa_clid?: string | null;
  telefone?: string | null;
  nome?: string | null;
  /** id do lead no nosso banco — vira `external_id` hasheado. */
  externalId?: string | null;
};

/**
 * Monta o bloco `user_data` do evento CAPI. `ctwa_clid` vai em texto puro
 * (é assim que a Meta espera — não é PII, é um identificador de clique);
 * telefone, nome e external_id são hasheados em SHA-256 (padrão de todo
 * identificador pessoal na Conversions API).
 */
export async function construirUserDataHasheado(
  dados: DadosUsuarioCapi,
): Promise<Record<string, string>> {
  const ud: Record<string, string> = {};
  if (dados.ctwa_clid) ud.ctwa_clid = dados.ctwa_clid;
  if (dados.telefone) {
    const digitos = dados.telefone.replace(/\D/g, "");
    if (digitos) ud.ph = await sha256Hex(digitos);
  }
  if (dados.nome) {
    const partes = normalizarNome(dados.nome).split(/\s+/).filter(Boolean);
    if (partes.length > 0) ud.fn = await sha256Hex(partes[0]);
    if (partes.length > 1) ud.ln = await sha256Hex(partes.slice(1).join(""));
  }
  if (dados.externalId) {
    ud.external_id = await sha256Hex(String(dados.externalId));
  }
  return ud;
}

export type DadosCustomCapi = {
  value?: number;
  currency?: string;
  /** ad_source_id — informativo para rastreabilidade de campanha; a Meta
   *  atribui a conversão pelo ctwa_clid, não por este campo. */
  source_id?: string | null;
};

export type EventoCapiPayload = {
  data: Array<{
    event_name: EventoCapi;
    event_time: number;
    event_id: string;
    action_source: "business_messaging";
    messaging_channel: "whatsapp";
    user_data: Record<string, string>;
    custom_data?: Record<string, unknown>;
  }>;
  test_event_code?: string;
};

/** Monta o payload completo enviado ao endpoint `/events` do pixel. Pura —
 *  recebe o user_data já hasheado (ver construirUserDataHasheado) em vez de
 *  fazer I/O aqui, para ficar 100% testável sem mockar crypto. */
export function montarPayloadEvento(params: {
  eventName: EventoCapi;
  eventId: string;
  eventTime: number;
  userData: Record<string, string>;
  customData?: DadosCustomCapi;
  testEventCode?: string | null;
}): EventoCapiPayload {
  const evento: EventoCapiPayload["data"][number] = {
    event_name: params.eventName,
    event_time: params.eventTime,
    event_id: params.eventId,
    action_source: "business_messaging",
    messaging_channel: "whatsapp",
    user_data: params.userData,
  };

  if (params.customData) {
    const cd: Record<string, unknown> = {};
    if (params.customData.value != null) {
      cd.value = params.customData.value;
      cd.currency = params.customData.currency || "BRL";
    }
    if (params.customData.source_id) cd.source_id = params.customData.source_id;
    if (Object.keys(cd).length > 0) evento.custom_data = cd;
  }

  const payload: EventoCapiPayload = { data: [evento] };
  if (params.testEventCode) payload.test_event_code = params.testEventCode;
  return payload;
}
