// Camada de exposição do CRM. Cada função é fina: valida, exige sessão,
// importa o .server.ts dentro do handler e delega. Nenhuma regra de negócio
// nasce aqui — ela mora nos .server.ts, que a Fatia 2 já deixou prontos.
//
// ATENÇÃO: este arquivo vai para o bundle do cliente (só o corpo do handler é
// removido). Nada server-only no topo.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { exigirSessao, registrarErros } from "../auth/middleware.ts";
import { ESTAGIOS } from "./estagios.ts";

const porConversa = z.object({ conversaId: z.string().uuid() });
const porLead = z.object({ leadId: z.string().uuid() });
const porMensagem = z.object({ mensagemId: z.string().uuid() });

export const listarConversasDoInbox = createServerFn({ method: "GET" })
  .middleware([registrarErros, exigirSessao])
  .handler(async (): Promise<any[]> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { listarConversas } = await import("./conversas.server.ts");
    return listarConversas(supabaseAdmin, 50);
  });

export const listarMensagensDaConversa = createServerFn({ method: "GET" })
  .middleware([registrarErros, exigirSessao])
  .validator((dados: unknown) =>
    z
      .object({
        conversaId: z.string().uuid(),
        // Teto de 500: o "carregar mais antigas" da tela sobe de 50 em 50, e
        // um limite aberto vindo do cliente puxaria a conversa inteira.
        limite: z.number().int().min(1).max(500).default(50),
      })
      .parse(dados),
  )
  .handler(async ({ data }): Promise<any[]> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { listarMensagens } = await import("./mensagens.server.ts");
    return listarMensagens(supabaseAdmin, data.conversaId, data.limite);
  });

/**
 * Estado de UMA conversa (se a IA está pausada), para a tela individual —
 * não a listagem do inbox, que só cobre as 50 conversas mais recentes.
 */
export const obterEstadoDaConversa = createServerFn({ method: "GET" })
  .middleware([registrarErros, exigirSessao])
  .validator((dados: unknown) => porConversa.parse(dados))
  .handler(async ({ data }): Promise<{ pausadaPelaIa: boolean } | null> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { obterEstadoConversa } = await import("./conversas.server.ts");
    return obterEstadoConversa(supabaseAdmin, data.conversaId);
  });

export const obterLeadDoCrm = createServerFn({ method: "GET" })
  .middleware([registrarErros, exigirSessao])
  .validator((dados: unknown) => porLead.parse(dados))
  .handler(async ({ data }): Promise<any | null> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { obterLead } = await import("./leads.server.ts");
    return obterLead(supabaseAdmin, data.leadId);
  });

export const listarTarefasDoCrm = createServerFn({ method: "GET" })
  .middleware([registrarErros, exigirSessao])
  .validator((dados: unknown) =>
    z.object({ apenasAbertas: z.boolean().default(true), leadId: z.string().uuid().optional() }).parse(dados),
  )
  .handler(async ({ data }): Promise<any[]> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { listarTarefas } = await import("./tarefas.server.ts");
    return listarTarefas(supabaseAdmin, {
      leadId: data.leadId,
      concluida: data.apenasAbertas ? false : undefined,
    });
  });

/**
 * URL assinada de 5 minutos para o bucket privado crm-midia.
 *
 * Recebe o ID da mensagem, nunca o caminho: o handler roda com service role, e
 * aceitar media_path vindo do navegador seria leitura arbitrária do bucket.
 */
export const obterUrlDeMidia = createServerFn({ method: "GET" })
  .middleware([registrarErros, exigirSessao])
  .validator((dados: unknown) => porMensagem.parse(dados))
  .handler(async ({ data }): Promise<{ url: string | null }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: mensagem } = await supabaseAdmin
      .from("mensagens")
      .select("media_path")
      .eq("id", data.mensagemId)
      .maybeSingle();
    if (!mensagem?.media_path) return { url: null };

    const { data: assinada } = await supabaseAdmin.storage
      .from("crm-midia")
      .createSignedUrl(mensagem.media_path, 300);
    return { url: assinada?.signedUrl ?? null };
  });

export const responderNoInbox = createServerFn({ method: "POST" })
  .middleware([registrarErros, exigirSessao])
  .validator((dados: unknown) =>
    z
      .object({
        conversaId: z.string().uuid(),
        leadId: z.string().uuid(),
        texto: z.string().min(1).max(4096),
      })
      .parse(dados),
  )
  .handler(async ({ data }): Promise<{ ok: boolean; erro?: string }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { responderComoHumano } = await import("./inbox.server.ts");
    return responderComoHumano(supabaseAdmin, data);
  });

export const devolverParaIa = createServerFn({ method: "POST" })
  .middleware([registrarErros, exigirSessao])
  .validator((dados: unknown) => porConversa.parse(dados))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { retomarIa } = await import("./conversas.server.ts");
    await retomarIa(supabaseAdmin, data.conversaId);
    return { ok: true };
  });

export const pausarIaNaConversa = createServerFn({ method: "POST" })
  .middleware([registrarErros, exigirSessao])
  .validator((dados: unknown) => porConversa.parse(dados))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { pausarIa } = await import("./conversas.server.ts");
    await pausarIa(supabaseAdmin, data.conversaId);
    return { ok: true };
  });

export const marcarConversaLida = createServerFn({ method: "POST" })
  .middleware([registrarErros, exigirSessao])
  .validator((dados: unknown) => porLead.parse(dados))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { marcarLida } = await import("./conversas.server.ts");
    await marcarLida(supabaseAdmin, data.leadId);
    return { ok: true };
  });

export const resolverAtencao = createServerFn({ method: "POST" })
  .middleware([registrarErros, exigirSessao])
  .validator((dados: unknown) => porLead.parse(dados))
  .handler(async ({ data }): Promise<{ ok: boolean; erro?: string }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: erroUpdate } = await supabaseAdmin
      .from("leads")
      .update({ precisa_atencao: false })
      .eq("id", data.leadId);
    if (erroUpdate) return { ok: false, erro: erroUpdate.message };

    const { error: erroEvento } = await supabaseAdmin
      .from("eventos_lead")
      .insert({ lead_id: data.leadId, tipo_evento: "atencao_resolvida", detalhe: {} });
    if (erroEvento) return { ok: false, erro: erroEvento.message };

    return { ok: true };
  });

export const moverEstagioDoLead = createServerFn({ method: "POST" })
  .middleware([registrarErros, exigirSessao])
  .validator((dados: unknown) =>
    z.object({ leadId: z.string().uuid(), estagio: z.enum(ESTAGIOS) }).parse(dados),
  )
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { moverEstagio } = await import("./leads.server.ts");
    const mudou = await moverEstagio(supabaseAdmin, data.leadId, data.estagio, { origem: "inbox" });
    return { ok: mudou };
  });

export const atualizarDadosDoLead = createServerFn({ method: "POST" })
  .middleware([registrarErros, exigirSessao])
  .validator((dados: unknown) =>
    z
      .object({
        leadId: z.string().uuid(),
        campos: z.object({
          nome: z.string().max(120).nullable().optional(),
          maquina_interesse: z.string().max(120).nullable().optional(),
          comissao_estimada: z.number().nonnegative().nullable().optional(),
        }),
      })
      .parse(dados),
  )
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { atualizarLead } = await import("./leads.server.ts");
    await atualizarLead(supabaseAdmin, data.leadId, data.campos);
    return { ok: true };
  });

export const registrarNotaNoLead = createServerFn({ method: "POST" })
  .middleware([registrarErros, exigirSessao])
  .validator((dados: unknown) =>
    z.object({ leadId: z.string().uuid(), texto: z.string().min(1).max(2000) }).parse(dados),
  )
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { registrarNota } = await import("./leads.server.ts");
    await registrarNota(supabaseAdmin, data.leadId, data.texto);
    return { ok: true };
  });

/**
 * Só liga o não-perturbe. Desligar é decisão que o spec mestre reserva ao
 * banco, à mão — o opt-out é permanente por escolha de conduta do programa.
 */
export const alternarNaoPerturbe = createServerFn({ method: "POST" })
  .middleware([registrarErros, exigirSessao])
  .validator((dados: unknown) =>
    z
      .object({
        leadId: z.string().uuid(),
        conversaId: z.string().uuid().nullable().optional(),
        motivo: z.string().max(300).default("marcado manualmente no inbox"),
      })
      .parse(dados),
  )
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { registrarNaoPerturbe } = await import("./nao-perturbe.server.ts");
    await registrarNaoPerturbe(supabaseAdmin, {
      leadId: data.leadId,
      conversaId: data.conversaId ?? null,
      motivo: data.motivo,
    });
    return { ok: true };
  });

export const criarTarefaDoCrm = createServerFn({ method: "POST" })
  .middleware([registrarErros, exigirSessao])
  .validator((dados: unknown) =>
    z
      .object({
        leadId: z.string().uuid(),
        titulo: z.string().min(1).max(200),
        descricao: z.string().max(2000).nullable().optional(),
        prazo: z.string().datetime().nullable().optional(),
      })
      .parse(dados),
  )
  .handler(async ({ data }): Promise<any> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { criarTarefa } = await import("./tarefas.server.ts");
    return criarTarefa(supabaseAdmin, data);
  });

export const alternarTarefaDoCrm = createServerFn({ method: "POST" })
  .middleware([registrarErros, exigirSessao])
  .validator((dados: unknown) =>
    z.object({ tarefaId: z.string().uuid(), concluida: z.boolean() }).parse(dados),
  )
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { alternarTarefa } = await import("./tarefas.server.ts");
    await alternarTarefa(supabaseAdmin, data.tarefaId, data.concluida);
    return { ok: true };
  });

export const excluirTarefaDoCrm = createServerFn({ method: "POST" })
  .middleware([registrarErros, exigirSessao])
  .validator((dados: unknown) => z.object({ tarefaId: z.string().uuid() }).parse(dados))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { excluirTarefa } = await import("./tarefas.server.ts");
    await excluirTarefa(supabaseAdmin, data.tarefaId);
    return { ok: true };
  });

/**
 * Reenvia uma mensagem que ficou em `falhou`. O cliente manda só qual
 * mensagem; todo o resto sai do banco.
 */
export const reenviarMensagem = createServerFn({ method: "POST" })
  .middleware([registrarErros, exigirSessao])
  .validator((dados: unknown) => porMensagem.parse(dados))
  .handler(async ({ data }): Promise<{ ok: boolean; erro?: string }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { reenviarFalhada } = await import("./inbox.server.ts");
    return reenviarFalhada(supabaseAdmin, data.mensagemId);
  });
