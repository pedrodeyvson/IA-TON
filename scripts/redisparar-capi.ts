/**
 * Redispara os eventos CAPI que a Meta recusou enquanto faltava o
 * `META_PAGE_ID` (400 / code 100 / subcode 2804116 — todo evento de
 * `business_messaging` exige `user_data.page_id`).
 *
 * Não reimplementa nada: chama `sincronizarEventosCapi`, o MESMO caminho que o
 * ingest usa a cada mensagem. Isso significa que herda de graça a cascata por
 * estágio, a deduplicação (`status_resposta = "ok"` é o único estado que conta
 * como enviado) e a parada no primeiro erro. Rodar duas vezes não duplica
 * evento nenhum.
 *
 * Uso:
 *   bun run capi:redisparar          # dry-run: mostra o que faria
 *   bun run capi:redisparar -- --executar
 */
import { supabaseAdmin as admin } from "../src/integrations/supabase/client.server.ts";
import { sincronizarEventosCapi } from "../src/lib/capi/capi.server.ts";
import { eventosParaDisparar } from "../src/lib/capi/capi.constants.ts";

const EXECUTAR = process.argv.includes("--executar");

/** Prefixo reservado por scripts/semear-demo.ts. Esses leads têm
 *  `ad_source_id` inventado e estágios até `convertido`: redisparar a cascata
 *  neles mandaria AddToCart/InitiateCheckout/Purchase FALSOS para o pixel de
 *  produção, envenenando a otimização da campanha. Ficam de fora sempre. */
const PREFIXO_DEMO = "5511900000";

async function main() {
  if (!process.env.META_PIXEL_ID || !process.env.META_CAPI_TOKEN) {
    console.error("META_PIXEL_ID/META_CAPI_TOKEN ausentes — nada a fazer.");
    process.exit(1);
  }
  // Sem page_id todo envio é recusado. Falha aqui em vez de gastar 1 chamada
  // por lead para colecionar o mesmo 2804116 de novo.
  if (!process.env.META_PAGE_ID) {
    console.error(
      "META_PAGE_ID ausente. É ele que faltava: a Meta recusa 100% dos eventos de\n" +
        "business_messaging sem page_id (subcode 2804116). Configure antes de redisparar.",
    );
    process.exit(1);
  }

  // Só leads com atribuição de anúncio: sem ctwa_clid nem ad_source_id a Meta
  // não tem como atribuir a conversão, e `sincronizarEventosCapi` já sai cedo.
  const { data: leads, error } = await admin
    .from("leads")
    .select("id, nome, telefone, estagio, ctwa_clid, ad_source_id, comissao_estimada")
    .or("ctwa_clid.not.is.null,ad_source_id.not.is.null")
    .order("criado_em", { ascending: true });

  if (error) {
    console.error("falha ao ler leads:", error.message);
    process.exit(1);
  }

  const { data: eventos } = await admin
    .from("eventos_capi")
    .select("lead_id, nome_evento, status_resposta");

  const okPorLead = new Map<string, string[]>();
  for (const e of eventos ?? []) {
    if (e.status_resposta !== "ok") continue;
    okPorLead.set(e.lead_id, [...(okPorLead.get(e.lead_id) ?? []), e.nome_evento]);
  }

  const demo = (leads ?? []).filter((l) => (l.telefone ?? "").startsWith(PREFIXO_DEMO));
  const reais = (leads ?? []).filter((l) => !(l.telefone ?? "").startsWith(PREFIXO_DEMO));

  console.log(`${leads?.length ?? 0} leads com atribuição de anúncio.`);
  if (demo.length > 0) {
    // Nunca silencioso: um lead pulado sem aviso lê como "não tinha pendência".
    console.log(
      `${demo.length} são de demonstração (prefixo ${PREFIXO_DEMO}) e foram EXCLUÍDOS — ` +
        `disparariam conversão falsa no pixel: ${demo.map((l) => l.nome ?? l.telefone).join(", ")}`,
    );
  }
  console.log("");

  let comPendencia = 0;
  for (const lead of reais) {
    const pendentes = eventosParaDisparar(lead.estagio, okPorLead.get(lead.id) ?? []);
    if (pendentes.length === 0) continue;
    comPendencia++;

    const rotulo = `${lead.nome ?? "(sem nome)"} · ${lead.telefone ?? "(sem telefone)"} · ${lead.estagio}`;
    const nomes = pendentes.map((p) => p.evento).join(" -> ");

    if (!EXECUTAR) {
      console.log(`[dry-run] ${rotulo}\n          faltam: ${nomes}`);
      continue;
    }

    await sincronizarEventosCapi(admin, lead.id, lead.estagio, {
      ctwaClid: lead.ctwa_clid,
      adSourceId: lead.ad_source_id,
      telefone: lead.telefone,
      nome: lead.nome,
      comissaoEstimada: lead.comissao_estimada,
    });

    const { data: depois } = await admin
      .from("eventos_capi")
      .select("nome_evento, status_resposta")
      .eq("lead_id", lead.id);

    const enviados = (depois ?? []).filter((e: any) => e.status_resposta === "ok").map((e: any) => e.nome_evento);
    const falhou = (depois ?? []).filter((e: any) => e.status_resposta !== "ok").at(-1);
    console.log(
      `${enviados.length > 0 ? "OK " : "ERRO"} ${rotulo}\n` +
        `     tentou: ${nomes}\n` +
        `     ok agora: ${enviados.length > 0 ? enviados.join(", ") : "(nenhum)"}` +
        (enviados.length === 0 && falhou ? `\n     último erro: ${falhou.status_resposta}` : ""),
    );
  }

  if (comPendencia === 0) {
    console.log("Nenhum evento pendente — todos os leads com atribuição já estão em dia.");
  } else if (!EXECUTAR) {
    console.log(`\n${comPendencia} leads com evento pendente. Rode com --executar para disparar.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
