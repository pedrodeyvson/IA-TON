// Opt-out permanente. O lead pediu para parar — e "parar" aqui é definitivo:
// nenhum toque dispara de novo, em nenhum estágio, e a conversa vai para o
// Pedro. Só ele desfaz, à mão, no banco.
//
// Fica fora de leads.server.ts de propósito: o opt-out mexe em lead, conversa e
// evento no mesmo movimento, e nenhum desses módulos é dono dos três.
import { limparAgendamento, pausarIa, reiniciarCiclo } from "./conversas.server.ts";

export type ParamsNaoPerturbe = {
  leadId: string;
  /** Pode ser null quando o pedido não veio pela conversa. */
  conversaId?: string | null;
  motivo: string;
};

export async function registrarNaoPerturbe(
  admin: any,
  params: ParamsNaoPerturbe,
): Promise<void> {
  const motivo = params.motivo?.trim() || "lead pediu para não receber mais mensagens";

  await admin
    .from("leads")
    // precisa_atencao junto: o Pedro tem que saber que perdeu o canal com este
    // lead, senão o opt-out vira um silêncio que ninguém percebe.
    .update({ nao_perturbe: true, precisa_atencao: true })
    .eq("id", params.leadId);

  await admin
    .from("eventos_lead")
    .insert({ lead_id: params.leadId, tipo_evento: "nao_perturbe", detalhe: { motivo } });

  if (params.conversaId) {
    await limparAgendamento(admin, params.conversaId);
    // Opt-out é permanente: não faz sentido deixar followup_toque/ciclo_pausado_ate
    // obsoletos no banco, mesmo que agendarResposta/agendarToque já os
    // recusassem por conta própria caso alguém tentasse reler esse estado.
    await reiniciarCiclo(admin, params.conversaId);
    await pausarIa(admin, params.conversaId);
  }
}
