import { createFileRoute } from "@tanstack/react-router";

const HEADERS_REDIGIDOS = new Set(["x-uazapi-secret", "authorization", "token", "admintoken"]);

export const Route = createFileRoute("/api/public/uazapi")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { segredoConfere } = await import("@/lib/webhook-auth.server");
        if (!segredoConfere(request)) return new Response("forbidden", { status: 403 });
        return Response.json({ ok: true, msg: "Webhook UAZAPI ativo. Envie POST aqui." });
      },

      POST: async ({ request }) => {
        const { segredoConfere } = await import("@/lib/webhook-auth.server");
        if (!segredoConfere(request)) return new Response("forbidden", { status: 403 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { ingerirEvento } = await import("@/lib/uazapi/ingest.server");

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ ok: false, erro: "corpo inválido" }, { status: 400 });
        }

        // Auditoria ANTES de processar: se o processamento explodir, o payload
        // continua disponível para reprocessar.
        const headers: Record<string, string> = {};
        request.headers.forEach((valor, chave) => {
          headers[chave] = HEADERS_REDIGIDOS.has(chave.toLowerCase()) ? "[redacted]" : valor;
        });

        const { data: registrado } = await supabaseAdmin
          .from("webhook_events")
          .insert({
            source: "uazapi",
            event_type: String((body as any)?.EventType ?? (body as any)?.event ?? "").toLowerCase(),
            raw_body: body as any,
            headers,
            status: "processing",
            attempts: 1,
          })
          .select("id")
          .single();

        const eventoId = registrado?.id;

        try {
          const resultados = await ingerirEvento(supabaseAdmin, body);
          const falhou = resultados.find((r) => r.status === "error");

          if (falhou) {
            if (eventoId) {
              await supabaseAdmin.from("webhook_events").update({
                status: "failed",
                last_error: falhou.error ?? "erro no ingest",
                next_retry_at: new Date(Date.now() + 60_000).toISOString(),
              }).eq("id", eventoId);
            }
            // 500 faz a UAZAPI reentregar. O pré-check de idempotência torna
            // o retry seguro.
            return Response.json({ ok: false, erro: falhou.error }, { status: 500 });
          }

          if (eventoId) {
            await supabaseAdmin.from("webhook_events").update({
              status: "processed",
              processed_at: new Date().toISOString(),
            }).eq("id", eventoId);
          }
          return Response.json({ ok: true, processados: resultados.length });
        } catch (err: any) {
          if (eventoId) {
            await supabaseAdmin.from("webhook_events").update({
              status: "failed",
              last_error: err?.message ?? "erro desconhecido",
              next_retry_at: new Date(Date.now() + 60_000).toISOString(),
            }).eq("id", eventoId);
          }
          return Response.json({ ok: false, erro: err?.message }, { status: 500 });
        }
      },
    },
  },
});
