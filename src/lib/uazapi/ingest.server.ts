import { parseWebhookUazapi } from "./parse.ts";
import { classificarMensagem } from "./mensagem.ts";
import { resolverTelefoneReal } from "./identidade.ts";
import { extrairAtribuicaoAnuncio } from "./anuncio.ts";
import { normalizarTelefoneBr } from "../telefone.ts";

export type ResultadoIngest = {
  status: "ok" | "duplicate" | "ignored" | "error";
  leadId?: string;
  error?: string;
};

async function acharOuCriarLead(
  admin: any,
  item: any,
): Promise<{ leadId: string; conversaId: string } | null> {
  const { telefone, jid } = resolverTelefoneReal(item, item?.key ?? {});
  const normalizado = normalizarTelefoneBr(telefone);
  const atribuicao = extrairAtribuicaoAnuncio(item?.content);

  // Sem telefone real (contato com @lid), o lead ainda é criado — ancorado no
  // JID — em vez de descartado. O telefone entra depois, se aparecer.
  const externalId = !normalizado && jid ? `wa-jid:${jid}` : null;
  if (!normalizado && !externalId) return null;

  let leadId: string | null = null;

  if (normalizado) {
    const { data } = await admin
      .from("leads").select("id").eq("telefone_normalizado", normalizado).limit(1);
    leadId = data?.[0]?.id ?? null;
  }
  if (!leadId && externalId) {
    const { data } = await admin
      .from("leads").select("id").eq("external_id", externalId).limit(1);
    leadId = data?.[0]?.id ?? null;
  }

  if (!leadId) {
    const { data, error } = await admin.from("leads").insert({
      telefone: telefone || null,
      external_id: externalId,
      nome: item?.pushName ?? item?.chat?.name ?? null,
      origem: atribuicao ? "anuncio" : "inbound",
      ad_source_id: atribuicao?.adSourceId ?? null,
      ad_source_url: atribuicao?.adSourceUrl ?? null,
      ad_title: atribuicao?.adTitle ?? null,
      ad_source_app: atribuicao?.adSourceApp ?? null,
      ad_conversion_source: atribuicao?.adConversionSource ?? null,
      ctwa_clid: atribuicao?.ctwaClid ?? null,
      ad_referral_raw: atribuicao?.referralRaw ?? null,
    }).select("id").single();
    if (error) throw new Error(error.message);
    leadId = data.id;
  } else if (atribuicao) {
    // Lead conhecido clicou num anúncio: registra a atribuição mais recente sem
    // sobrescrever com null caso ela venha incompleta.
    await admin.from("leads").update({
      ad_source_id: atribuicao.adSourceId,
      ad_source_url: atribuicao.adSourceUrl,
      ad_title: atribuicao.adTitle,
      ad_source_app: atribuicao.adSourceApp,
      ad_conversion_source: atribuicao.adConversionSource,
      ctwa_clid: atribuicao.ctwaClid,
      ad_referral_raw: atribuicao.referralRaw,
    }).eq("id", leadId).is("ad_source_id", null);
  }

  const { data: conversaExistente } = await admin
    .from("conversas").select("id").eq("lead_id", leadId).maybeSingle();
  if (conversaExistente?.id) return { leadId: leadId!, conversaId: conversaExistente.id };

  const { data: novaConversa, error: erroConversa } = await admin
    .from("conversas").insert({ lead_id: leadId }).select("id").single();
  if (erroConversa) throw new Error(erroConversa.message);
  return { leadId: leadId!, conversaId: novaConversa.id };
}

async function ingerirMensagem(admin: any, item: any): Promise<ResultadoIngest> {
  const msg = classificarMensagem(item);

  // Idempotência camada 1: pré-check antes de qualquer trabalho.
  if (msg.providerMessageId) {
    const { data } = await admin
      .from("mensagens").select("id").eq("provider_message_id", msg.providerMessageId).maybeSingle();
    if (data) return { status: "duplicate" };
  }

  const alvo = await acharOuCriarLead(admin, item);
  if (!alvo) return { status: "ignored" };

  const { error } = await admin.from("mensagens").insert({
    conversa_id: alvo.conversaId,
    lead_id: alvo.leadId,
    provider_message_id: msg.providerMessageId,
    remetente: msg.direcao === "in" ? "lead" : "humano",
    direcao: msg.direcao,
    tipo: msg.tipo,
    conteudo: msg.conteudo,
    media_mime: msg.mediaMime,
    media_filename: msg.mediaFilename,
    timestamp_ms: msg.timestampMs ?? Date.now(),
    raw: item,
  });

  if (error) {
    // Idempotência camada 2: corrida entre duas entregas do mesmo webhook.
    if ((error as any).code === "23505") return { status: "duplicate" };
    return { status: "error", error: error.message };
  }

  return { status: "ok", leadId: alvo.leadId };
}

export async function ingerirEvento(admin: any, body: unknown): Promise<ResultadoIngest[]> {
  const evento = parseWebhookUazapi(body);
  if (evento.evento !== "messages") return [];

  const resultados: ResultadoIngest[] = [];
  for (const item of evento.itens) {
    try {
      resultados.push(await ingerirMensagem(admin, item));
    } catch (err: any) {
      resultados.push({ status: "error", error: err?.message ?? "erro desconhecido" });
    }
  }
  return resultados;
}
