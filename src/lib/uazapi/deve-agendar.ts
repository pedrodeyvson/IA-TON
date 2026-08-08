// Puro: decide se a chegada de uma mensagem deve acordar o agente.
// Separado do ingest.server.ts porque aquele arquivo importa Storage, Groq e
// CAPI e não roda sob node --test.

export type ContextoAgendamento = {
  direcao: "in" | "out";
  /** conversas.pausada_pela_ia — o Pedro assumiu esta conversa. */
  pausada: boolean;
  /** leads.precisa_atencao — o agente já escalou este lead. */
  precisaAtencao: boolean;
  /** AGENTE_ATIVO — desliga o agente inteiro sem redeploy. */
  agenteAtivo: boolean;
};

export function deveAgendarResposta(ctx: ContextoAgendamento): boolean {
  if (!ctx.agenteAtivo) return false;
  // Mensagem "out" é o eco do que nós mesmos enviamos — responder a ela seria
  // o agente conversando sozinho.
  if (ctx.direcao !== "in") return false;
  if (ctx.pausada) return false;
  if (ctx.precisaAtencao) return false;
  return true;
}
