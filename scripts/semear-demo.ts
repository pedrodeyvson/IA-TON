/**
 * Semeia dados FICTÍCIOS de demonstração. Idempotente: roda quantas vezes quiser.
 * Todos os telefones usam o prefixo 5511900000xxx, reservado para demo.
 *
 * Usa o `supabaseAdmin` do projeto (não um client novo) porque ele já resolve
 * o header `apikey` correto para os dois formatos de chave do Supabase — ver
 * src/integrations/supabase/client.server.ts.
 */
import { supabaseAdmin as admin } from "../src/integrations/supabase/client.server.ts";

const LEADS_DEMO = [
  { telefone: "5511900000001", nome: "Ana (demo)", estagio: "novo", origem: "anuncio",
    ad_source_id: "120226305854810726", ad_title: "Maquininha Ton 12x", ad_source_app: "facebook",
    maquina_interesse: "T3 Smart" },
  { telefone: "5511900000002", nome: "Bruno (demo)", estagio: "qualificando", origem: "inbound",
    maquina_interesse: "T2" },
  { telefone: "5511900000003", nome: "Carla (demo)", estagio: "link_enviado", origem: "anuncio",
    ad_source_id: "120226305854810726", ad_title: "Maquininha Ton 12x", ad_source_app: "facebook",
    maquina_interesse: "T3 Smart", comissao_estimada: 590 },
  { telefone: "5511900000004", nome: "Diego (demo)", estagio: "convertido", origem: "anuncio",
    ad_source_id: "120999888777666", ad_title: "TapTon sem maquininha", ad_source_app: "instagram",
    maquina_interesse: "TapTon", comissao_estimada: 590, comissao_confirmada: 590 },
  { telefone: "5511900000005", nome: "Elisa (demo)", estagio: "perdido", origem: "inbound" },
];

const CONVERSA_DEMO = [
  { direcao: "in",  remetente: "lead",   tipo: "texto", conteudo: "Oi, vi o anúncio da maquininha" },
  { direcao: "out", remetente: "ia",     tipo: "texto", conteudo: "Oi! Que bom que se interessou. Você já vende hoje ou está começando agora?" },
  { direcao: "in",  remetente: "lead",   tipo: "texto", conteudo: "Já vendo, mas uso a maquininha de outro banco" },
  { direcao: "out", remetente: "ia",     tipo: "texto", conteudo: "Entendi. A T3 Smart costuma compensar bem nesse caso — posso te mostrar as taxas?" },
  { direcao: "in",  remetente: "lead",   tipo: "audio", conteudo: null, transcricao: "Pode sim, manda aí por favor" },
];

async function main() {
  console.log("Semeando dados de demonstração...");

  for (const lead of LEADS_DEMO) {
    const { data: existente } = await admin
      .from("leads").select("id").eq("telefone", lead.telefone).maybeSingle();

    let leadId = existente?.id;
    if (!leadId) {
      const { data, error } = await admin.from("leads").insert(lead).select("id").single();
      if (error) throw new Error(`falha ao criar ${lead.nome}: ${error.message}`);
      leadId = data.id;
      console.log(`  + lead ${lead.nome}`);
    }

    const { data: conversa } = await admin
      .from("conversas").select("id").eq("lead_id", leadId).maybeSingle();
    let conversaId = conversa?.id;
    if (!conversaId) {
      const { data } = await admin.from("conversas").insert({ lead_id: leadId }).select("id").single();
      conversaId = data!.id;
    }

    // Só o lead em "qualificando" ganha histórico de conversa, para dar o que ver no inbox.
    if (lead.estagio !== "qualificando") continue;

    const { count } = await admin
      .from("mensagens").select("id", { count: "exact", head: true }).eq("lead_id", leadId);
    if ((count ?? 0) > 0) continue;

    const base = Date.now() - CONVERSA_DEMO.length * 60_000;
    for (const [i, m] of CONVERSA_DEMO.entries()) {
      await admin.from("mensagens").insert({
        conversa_id: conversaId, lead_id: leadId,
        provider_message_id: `demo-${leadId}-${i}`,
        direcao: m.direcao, remetente: m.remetente, tipo: m.tipo,
        conteudo: m.conteudo,
        transcricao: (m as any).transcricao ?? null,
        transcricao_status: (m as any).transcricao ? "ok" : null,
        timestamp_ms: base + i * 60_000,
      });
    }
    console.log(`  + ${CONVERSA_DEMO.length} mensagens em ${lead.nome}`);
  }

  console.log("Pronto.");
}

main().catch((err) => { console.error(err); process.exit(1); });
