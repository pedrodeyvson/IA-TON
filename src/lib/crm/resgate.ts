// Puro: cadência de RESGATE pré-link (spec §4) — SEPARADA da régua oficial
// pós-link (regua.ts). Contada a partir da PRIMEIRA mensagem do lead, nunca
// da saudação automática do anúncio (mesmo critério de `ehSaudacaoDeAnuncio`
// em `estagios.ts`) — é a partir da primeira mensagem de verdade que o
// silêncio do lead começa a doer.
//
// `TOTAL_DE_TOQUES` e `followup_toque` (régua oficial) têm `check between 0
// and 4` no banco e são contados por `followup_toque` — o resgate usa contador
// PRÓPRIO (`resgate_toque`, Task 1), nunca reusa `followup_toque`, senão a
// régua oficial começaria já esgotada.
//
// Decisão do dono (spec §9, reenquadramento "o objetivo é conversão"): o
// resgate NÃO tem teto por norma, só por sinal. Por isso, diferente de
// `regua.ts`, o 4º toque sem resposta simplesmente ENCERRA — sem pausa de 30
// dias. A régua oficial assume dali pra frente, quando o link sair.

export const MINUTOS_DO_TOQUE_RESGATE = [60, 180, 360, 720] as const; // 1h, 3h, 6h, 12h

export const TOTAL_DE_TOQUES_RESGATE = MINUTOS_DO_TOQUE_RESGATE.length;

export const MS_POR_MINUTO = 60_000;

export type PlanoDoResgate =
  | { tipo: "toque"; toque: number; quandoIso: string }
  | { tipo: "encerrado" };

/**
 * Decide o que acontece depois do toque de resgate `toqueAtual`.
 *
 * `toqueAtual` é quantos toques deste resgate já saíram (0 = nenhum ainda).
 * Devolve o próximo toque com o instante em que ele deve sair, ou
 * `{tipo: "encerrado"}` quando os 4 toques já saíram.
 */
export function planejarProximoResgate(
  toqueAtual: number,
  primeiraMensagemEmMs: number,
  agoraMs: number,
): PlanoDoResgate {
  const proximo = toqueAtual + 1;

  // Fora de 1..4 (inclusive lixo no banco): o resgate acabou. Sem pausa —
  // decisão §9, diferente de `regua.ts`.
  if (!Number.isInteger(proximo) || proximo < 1 || proximo > TOTAL_DE_TOQUES_RESGATE) {
    return { tipo: "encerrado" };
  }

  // Sem data legível da primeira mensagem, conta a partir de agora: um toque
  // atrasado é melhor que um lead que nunca mais recebe nada.
  const base = Number.isFinite(primeiraMensagemEmMs) ? primeiraMensagemEmMs : agoraMs;
  const alvo = base + MINUTOS_DO_TOQUE_RESGATE[proximo - 1] * MS_POR_MINUTO;

  // Worker que ficou fora do ar não dispara toque com data no passado — e não
  // dispara os atrasados em rajada, porque só um toque é planejado por vez.
  // PISO de 2 minutos (não "agora mesmo"): agendar exatamente no instante
  // atual deixa o toque imediatamente "vencido" pro próximo tick do worker
  // (3s depois), o que pode encadear disparos em rajada em vez de espaçados
  // — achado em incidente real de 08/08/2026 (17 mensagens num minuto).
  const PISO_MS = 2 * MS_POR_MINUTO;
  const quando = Math.max(alvo, agoraMs + PISO_MS);

  return { tipo: "toque", toque: proximo, quandoIso: new Date(quando).toISOString() };
}
