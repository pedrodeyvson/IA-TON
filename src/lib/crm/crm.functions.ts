// Camada de exposição do CRM. Cada função é fina: valida, exige sessão,
// importa o .server.ts dentro do handler e delega. Nenhuma regra de negócio
// nasce aqui — ela mora nos .server.ts, que a Fatia 2 já deixou prontos.
//
// ATENÇÃO: este arquivo vai para o bundle do cliente (só o corpo do handler é
// removido). Nada server-only no topo.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { exigirSessao, registrarErros } from "../auth/middleware.ts";

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
