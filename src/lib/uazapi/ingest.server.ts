import { parseWebhookUazapi } from "./parse.ts";
import { classificarMensagem } from "./mensagem.ts";
import { resolverTelefoneReal } from "./identidade.ts";
import { extrairAtribuicaoAnuncio } from "./anuncio.ts";
import { normalizarTelefoneBr } from "../telefone.ts";
import { sanitizarSegmentoPath } from "./sanitizar-path.ts";
import { deveIgnorarRemoteJid } from "./filtro-remetente.ts";

export type ResultadoIngest = {
  status: "ok" | "duplicate" | "ignored" | "error";
  leadId?: string;
  error?: string;
};

const BUCKET_MIDIA = "crm-midia";
const TIPOS_COM_MIDIA = new Set(["audio", "imagem", "video", "documento", "sticker"]);

/** A UAZAPI devolve `fileURL` (URL cacheada) em vez de base64 — bem mais leve. */
async function baixarMidia(messageId: string): Promise<{ bytes: Uint8Array; mime: string } | null> {
  const token = process.env.UAZAPI_TOKEN;
  if (!token) return null;
  try {
    const { baixarMensagem } = await import("./client.server.ts");
    const resposta = await baixarMensagem(token, messageId);
    const fileURL = resposta?.fileURL;

    if (!fileURL) {
      const base64 = resposta?.base64Data ?? resposta?.base64;
      if (!base64) return null;
      return {
        bytes: new Uint8Array(Buffer.from(base64, "base64")),
        mime: resposta?.mimetype ?? "application/octet-stream",
      };
    }

    const arquivo = await fetch(fileURL, { signal: AbortSignal.timeout(20_000) });
    if (!arquivo.ok) return null;
    return {
      bytes: new Uint8Array(await arquivo.arrayBuffer()),
      mime: resposta?.mimetype ?? arquivo.headers.get("content-type") ?? "application/octet-stream",
    };
  } catch {
    return null;
  }
}

// Busca o lead por telefone_normalizado (prioridade) e, na falta, por external_id.
// Extraída para ser reaproveitada tanto na busca inicial quanto na recuperação
// de corrida (23505) abaixo — os dois precisam do mesmo critério de busca.
async function buscarLeadExistente(
  admin: any,
  normalizado: string,
  externalId: string | null,
): Promise<string | null> {
  if (normalizado) {
    const { data } = await admin
      .from("leads").select("id").eq("telefone_normalizado", normalizado).limit(1);
    if (data?.[0]?.id) return data[0].id;
  }
  if (externalId) {
    const { data } = await admin
      .from("leads").select("id").eq("external_id", externalId).limit(1);
    if (data?.[0]?.id) return data[0].id;
  }
  return null;
}

async function acharOuCriarLead(
  admin: any,
  item: any,
): Promise<{
  leadId: string;
  conversaId: string;
  leadNovo: boolean;
  atribuicao: ReturnType<typeof extrairAtribuicaoAnuncio>;
} | null> {
  const { telefone, jid } = resolverTelefoneReal(item, item?.key ?? {});
  const normalizado = normalizarTelefoneBr(telefone);
  const atribuicao = extrairAtribuicaoAnuncio(item?.content);

  // Sem telefone real (contato com @lid), o lead ainda é criado — ancorado no
  // JID — em vez de descartado. O telefone entra depois, se aparecer.
  const externalId = !normalizado && jid ? `wa-jid:${jid}` : null;
  if (!normalizado && !externalId) return null;

  let leadId = await buscarLeadExistente(admin, normalizado, externalId);
  const leadNovo = !leadId;

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

    if (error) {
      // Idempotência de lead: select-depois-insert não é atômico. Se
      // `telefone_normalizado` ou `external_id` colidiu, foi porque um webhook
      // concorrente inseriu o mesmo lead entre o select acima e este insert —
      // corrida perdida, não erro real. Re-busca e segue com o lead do vencedor,
      // igual `ingerirMensagem` já faz para `provider_message_id`.
      if ((error as any).code === "23505") {
        leadId = await buscarLeadExistente(admin, normalizado, externalId);
      }
      if (!leadId) throw new Error(error.message);
    } else {
      leadId = data.id;
    }
  } else if (atribuicao) {
    // Lead conhecido clicou num anúncio: registra a atribuição mais recente sem
    // sobrescrever com null caso ela venha incompleta.
    const { error: erroAtribuicao } = await admin.from("leads").update({
      ad_source_id: atribuicao.adSourceId,
      ad_source_url: atribuicao.adSourceUrl,
      ad_title: atribuicao.adTitle,
      ad_source_app: atribuicao.adSourceApp,
      ad_conversion_source: atribuicao.adConversionSource,
      ctwa_clid: atribuicao.ctwaClid,
      ad_referral_raw: atribuicao.referralRaw,
    }).eq("id", leadId).is("ad_source_id", null);

    if (erroAtribuicao) {
      // Não derruba o processamento da mensagem por causa do enriquecimento —
      // mas perder a atribuição de anúncio em silêncio quebra o vínculo entre
      // comissão e anúncio, então precisa ficar visível para diagnóstico.
      console.warn(
        `[ingest] falha ao gravar atribuição de anúncio no lead ${leadId}: ${erroAtribuicao.message}`,
      );
    }
  }

  const { data: conversaExistente } = await admin
    .from("conversas").select("id").eq("lead_id", leadId).maybeSingle();
  if (conversaExistente?.id) {
    return { leadId: leadId!, conversaId: conversaExistente.id, leadNovo, atribuicao };
  }

  const { data: novaConversa, error: erroConversa } = await admin
    .from("conversas").insert({ lead_id: leadId }).select("id").single();

  if (erroConversa) {
    // Mesma corrida, agora em `conversas` (lead_id é único: 1 conversa por
    // lead). Se outro webhook concorrente já criou a conversa deste lead entre
    // o select acima e este insert, re-busca em vez de estourar.
    if ((erroConversa as any).code === "23505") {
      const { data: conversaConcorrente } = await admin
        .from("conversas").select("id").eq("lead_id", leadId).maybeSingle();
      if (conversaConcorrente?.id) {
        return { leadId: leadId!, conversaId: conversaConcorrente.id, leadNovo, atribuicao };
      }
    }
    throw new Error(erroConversa.message);
  }

  return { leadId: leadId!, conversaId: novaConversa.id, leadNovo, atribuicao };
}

async function ingerirMensagem(admin: any, item: any): Promise<ResultadoIngest> {
  // Leads são inbound 1:1 — grupo (@g.us), status (status@broadcast) e canal
  // (@newsletter) nunca viram lead, mesmo que a varredura recursiva de
  // identidade encontre o telefone de um participante lá dentro.
  if (deveIgnorarRemoteJid(item?.key?.remoteJid)) return { status: "ignored" };

  const msg = classificarMensagem(item);

  // Idempotência camada 1: pré-check antes de qualquer trabalho.
  if (msg.providerMessageId) {
    const { data } = await admin
      .from("mensagens").select("id").eq("provider_message_id", msg.providerMessageId).maybeSingle();
    if (data) return { status: "duplicate" };
  }

  const alvo = await acharOuCriarLead(admin, item);
  if (!alvo) return { status: "ignored" };

  // Dispara LeadSubmitted na Meta CAPI para lead novo com atribuição de
  // anúncio (ctwa_clid e/ou ad_source_id — um lead às vezes chega com
  // source_id sem ctwa_clid, e isso ainda é sinal de atribuição válido, não
  // só o ctwa_clid). Sempre aguardado (await): uma chamada fire-and-forget
  // pode ser descartada pelo runtime ao responder o HTTP antes do fetch
  // terminar, e o evento nunca chega na Meta. Best-effort — envolto em
  // try/catch para que uma falha do CAPI nunca custe o processamento da
  // mensagem (mesmo princípio já usado para mídia acima).
  if (alvo.leadNovo && alvo.atribuicao && (alvo.atribuicao.ctwaClid || alvo.atribuicao.adSourceId)) {
    try {
      const { enviarEventoCapi } = await import("../capi/capi.server.ts");
      const { telefone } = resolverTelefoneReal(item, item?.key ?? {});
      await enviarEventoCapi(
        admin,
        alvo.leadId,
        "LeadSubmitted",
        {
          ctwaClid: alvo.atribuicao.ctwaClid,
          telefone: telefone || null,
          nome: item?.pushName ?? item?.chat?.name ?? null,
        },
        alvo.atribuicao.adSourceId ? { source_id: alvo.atribuicao.adSourceId } : undefined,
      );
    } catch (err: any) {
      console.warn(`[ingest] LeadSubmitted CAPI falhou para lead ${alvo.leadId}:`, err?.message ?? err);
    }
  }

  // Self-healing: retenta qualquer evento CAPI que tenha ficado pendente de
  // uma etapa anterior, a cada mensagem nova do lead — não depende de uma
  // transição de estágio acontecer agora. Best-effort, mesmo princípio do
  // LeadSubmitted acima.
  try {
    const { sincronizarEventosCapi } = await import("../capi/capi.server.ts");
    const leadAtual = await admin
      .from("leads")
      .select("estagio, ctwa_clid, ad_source_id, telefone, nome, comissao_estimada")
      .eq("id", alvo.leadId)
      .maybeSingle();
    if (leadAtual.data) {
      await sincronizarEventosCapi(admin, alvo.leadId, leadAtual.data.estagio, {
        ctwaClid: leadAtual.data.ctwa_clid,
        adSourceId: leadAtual.data.ad_source_id,
        telefone: leadAtual.data.telefone,
        nome: leadAtual.data.nome,
        comissaoEstimada: leadAtual.data.comissao_estimada,
      });
    }
  } catch (err: any) {
    console.warn(`[ingest] self-healing de CAPI falhou para lead ${alvo.leadId}:`, err?.message ?? err);
  }

  let mediaPath: string | null = null;
  let transcricao: string | null = null;
  let transcricaoStatus: string | null = null;

  if (TIPOS_COM_MIDIA.has(msg.tipo) && msg.providerMessageId) {
    const midia = await baixarMidia(msg.providerMessageId);
    if (midia) {
      const extensao = (midia.mime.split("/")[1] ?? "bin").split(";")[0];
      // providerMessageId vem do payload do WhatsApp sem garantia nenhuma de
      // forma — sanitiza antes de virar segmento de path (evita travessia de
      // diretório) e mantém determinístico, já que upsert:true depende disso.
      const idSeguro = sanitizarSegmentoPath(msg.providerMessageId);
      const candidatoPath = `${alvo.leadId}/${msg.direcao}_${idSeguro}.${extensao}`;

      // O storage-js converte a maioria das falhas em `{ error }`, mas pode
      // relançar em casos fora do padrão (ex.: corpo malformado) — sem este
      // try/catch, uma falha de upload abortaria o insert da mensagem
      // inteira, o que contraria o objetivo de "mídia nunca custa a mensagem".
      try {
        const { error: erroUpload } = await admin.storage
          .from(BUCKET_MIDIA)
          .upload(candidatoPath, midia.bytes, { contentType: midia.mime, upsert: true });
        if (erroUpload) {
          console.warn(`[ingest] falha ao enviar mídia para o Storage (${candidatoPath}): ${erroUpload.message}`);
        } else {
          mediaPath = candidatoPath;
        }
      } catch (err: any) {
        console.warn(`[ingest] exceção ao enviar mídia para o Storage (${candidatoPath}): ${err?.message ?? err}`);
        mediaPath = null;
      }

      if (msg.tipo === "audio") {
        // Transcreve direto dos bytes já em memória (midia.bytes) — evita
        // reabrir do Storage o arquivo que acabou de ser enviado (round-trip
        // de rede redundante e uma superfície de falha a mais). Por isso não
        // depende de `mediaPath`/do upload ter dado certo: mesmo que o
        // upload falhe, a transcrição ainda é tentada com os bytes em mãos.
        const { transcreverAudio } = await import("../groq-transcribe.server.ts");
        const r = await transcreverAudio(midia.bytes, midia.mime, { idioma: "pt" });
        if (r.ok) { transcricao = r.texto; transcricaoStatus = "ok"; }
        else { transcricaoStatus = "failed"; }
      }
    }
  }

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
    media_path: mediaPath,
    transcricao,
    transcricao_status: transcricaoStatus,
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
