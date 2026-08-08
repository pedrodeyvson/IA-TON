// Agendamento, lock, pausa e régua da conversa. O worker (src/lib/worker) varre
// por responder_em; tudo que mexe nessa coluna passa por aqui.
//
// O follow-up REUSA o mesmo agendamento da resposta: um loop, um lock, um
// caminho de erro. O cancelamento sai de graça — se o lead responder antes, o
// webhook reagenda com motivo "resposta" e o toque simplesmente deixa de
// existir.
import { TOTAL_DE_TOQUES } from "./regua.ts";

/** Base do backoff: `MS_POR_TENTATIVA * 2 ** tentativas` — 60s na 1ª falha,
 *  120s na 2ª; na 3ª (`MAX_TENTATIVAS`) desiste em vez de calcular um novo prazo. */
export const MS_POR_TENTATIVA = 30_000;

/** Depois de 3 falhas seguidas o agente desiste e o lead vira problema do Pedro. */
export const MAX_TENTATIVAS = 3;

export type ResultadoAgendamento = { agendado: boolean; motivo?: "nao_perturbe" };

/**
 * A instância de WhatsApp é compartilhada com outro projeto do dono: um
 * webhook/worker que esqueça de checar `nao_perturbe` antes de chamar
 * `agendarResposta`/`agendarToque` reabriria follow-up para quem pediu para
 * parar. Por isso a checagem mora aqui dentro, não só no lado de quem chama —
 * defesa em profundidade, não depende de disciplina externa.
 */
async function leadOptouPorNaoPerturbe(admin: any, conversaId: string): Promise<boolean> {
  const { data } = await admin
    .from("conversas")
    .select("id, leads(nao_perturbe)")
    .eq("id", conversaId)
    .maybeSingle();
  return data?.leads?.nao_perturbe === true;
}

export async function agendarResposta(
  admin: any,
  conversaId: string,
  atrasoMs: number,
  agoraMs: number = Date.now(),
): Promise<ResultadoAgendamento> {
  if (await leadOptouPorNaoPerturbe(admin, conversaId)) {
    return { agendado: false, motivo: "nao_perturbe" };
  }
  await admin
    .from("conversas")
    .update({
      responder_em: new Date(agoraMs + atrasoMs).toISOString(),
      motivo_agendamento: "resposta",
      // Mensagem nova reabre o crédito: uma falha de ontem não pode condenar a
      // resposta de hoje.
      tentativas: 0,
      ultimo_erro: null,
    })
    .eq("id", conversaId);
  return { agendado: true };
}

/** Agenda um toque da régua no instante exato que `planejarProximoToque` devolveu. */
export async function agendarToque(
  admin: any,
  conversaId: string,
  quandoIso: string,
): Promise<ResultadoAgendamento> {
  if (await leadOptouPorNaoPerturbe(admin, conversaId)) {
    return { agendado: false, motivo: "nao_perturbe" };
  }
  await admin
    .from("conversas")
    .update({
      responder_em: quandoIso,
      motivo_agendamento: "followup",
      tentativas: 0,
      ultimo_erro: null,
    })
    .eq("id", conversaId);
  return { agendado: true };
}

export async function registrarToqueEnviado(
  admin: any,
  conversaId: string,
  toque: number,
): Promise<void> {
  if (!Number.isInteger(toque) || toque < 1 || toque > TOTAL_DE_TOQUES) {
    throw new Error(`toque ${toque} fora da cadência (1..${TOTAL_DE_TOQUES})`);
  }
  await admin
    .from("conversas")
    .update({ followup_toque: toque, followup_enviado: true })
    .eq("id", conversaId);
}

/** Pausa obrigatória de 30 dias depois do 4º toque sem resposta. */
export async function pausarCiclo(
  admin: any,
  conversaId: string,
  ateIso: string,
): Promise<void> {
  await admin
    .from("conversas")
    .update({
      ciclo_pausado_ate: ateIso,
      responder_em: null,
      motivo_agendamento: null,
      processando_em: null,
    })
    .eq("id", conversaId);
}

/** Zera o ciclo — usado quando um novo ciclo pode começar (link novo). */
export async function reiniciarCiclo(admin: any, conversaId: string): Promise<void> {
  await admin
    .from("conversas")
    .update({ followup_toque: 0, followup_enviado: false, ciclo_pausado_ate: null })
    .eq("id", conversaId);
}

export async function limparAgendamento(admin: any, conversaId: string): Promise<void> {
  await admin
    .from("conversas")
    .update({ responder_em: null, motivo_agendamento: null, processando_em: null })
    .eq("id", conversaId);
}

/**
 * Solta só o lock, preservando responder_em.
 *
 * É o que o worker usa quando o turno JÁ agendou o próximo toque: chamar
 * limparAgendamento ali apagaria a régua que o agente acabou de montar.
 */
export async function soltarLock(admin: any, conversaId: string): Promise<void> {
  await admin.from("conversas").update({ processando_em: null }).eq("id", conversaId);
}

/**
 * Registra a falha do turno e decide se tenta de novo.
 * `tentativas` é o número já incrementado (1 na primeira falha).
 */
export async function registrarFalha(
  admin: any,
  conversaId: string,
  tentativas: number,
  erro: string,
  agoraMs: number = Date.now(),
): Promise<void> {
  const desistiu = tentativas >= MAX_TENTATIVAS;
  await admin
    .from("conversas")
    .update({
      tentativas,
      ultimo_erro: erro.slice(0, 500),
      // Solta o lock sempre — senão a conversa fica presa até o varredor de
      // órfãos passar.
      processando_em: null,
      responder_em: desistiu
        ? null
        : new Date(agoraMs + MS_POR_TENTATIVA * 2 ** tentativas).toISOString(),
    })
    .eq("id", conversaId);
}

export async function pausarIa(admin: any, conversaId: string): Promise<void> {
  await admin
    .from("conversas")
    .update({ pausada_pela_ia: true, assumida_em: new Date().toISOString() })
    .eq("id", conversaId);
}

export async function retomarIa(admin: any, conversaId: string): Promise<void> {
  await admin
    .from("conversas")
    .update({ pausada_pela_ia: false, assumida_em: null })
    .eq("id", conversaId);
}

export async function marcarLida(admin: any, leadId: string): Promise<void> {
  await admin.from("leads").update({ nao_lidas: 0 }).eq("id", leadId);
}

/** Lista para o inbox da Fatia 4: lead + estado da conversa, mais recente primeiro. */
export async function listarConversas(admin: any, limite = 50): Promise<any[]> {
  const { data } = await admin
    .from("leads")
    .select(
      "id, nome, telefone, estagio, precisa_atencao, nao_perturbe, nao_lidas," +
        " ultima_mensagem_em, ultima_mensagem_preview, ultima_mensagem_direcao," +
        " conversas(id, pausada_pela_ia, followup_toque, ciclo_pausado_ate)",
    )
    .order("ultima_mensagem_em", { ascending: false })
    .limit(limite);
  return data ?? [];
}
