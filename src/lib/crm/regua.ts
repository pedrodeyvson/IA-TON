// Puro: a cadência oficial de remarketing da Ton (urgencia_remarketing.pdf),
// adotada no adendo comercial de 2026-08-08.
//
// 4 toques por ciclo, contados A PARTIR DO ENVIO DO LINK, e depois pausa
// obrigatória de 30 dias. O material trata frequência sem cadência como
// "perseguição (contra diretrizes)": passar de 4 toques não é agressividade
// comercial, é infração de programa.

export const MS_POR_DIA = 86_400_000;

/**
 * Dias, contados do envio do link, de cada toque:
 * toque 1 = dia 0 + 24h, toque 2 = +2 dias, toque 3 = +5, toque 4 = +10.
 */
export const DIAS_DO_TOQUE = [1, 2, 5, 10] as const;

export const TOTAL_DE_TOQUES = DIAS_DO_TOQUE.length;

/** Pausa obrigatória depois do 4º toque sem resposta. */
export const DIAS_DE_PAUSA = 30;

export type PlanoDoToque =
  | { tipo: "toque"; toque: number; quandoIso: string }
  | { tipo: "pausa"; ateIso: string };

/**
 * Decide o que acontece depois do toque `toqueAtual`.
 *
 * `toqueAtual` é quantos toques deste ciclo já saíram (0 = nenhum ainda).
 * Devolve o próximo toque com o instante em que ele deve sair, ou a pausa de
 * 30 dias quando o ciclo acabou.
 */
export function planejarProximoToque(
  toqueAtual: number,
  linkEnviadoEmMs: number,
  agoraMs: number,
): PlanoDoToque {
  const proximo = toqueAtual + 1;

  // Fora de 1..4 (inclusive lixo no banco): o ciclo acabou.
  if (!Number.isInteger(proximo) || proximo < 1 || proximo > TOTAL_DE_TOQUES) {
    return { tipo: "pausa", ateIso: new Date(agoraMs + DIAS_DE_PAUSA * MS_POR_DIA).toISOString() };
  }

  // Sem data de link legível, conta a partir de agora: um toque atrasado é
  // melhor que um lead que nunca mais recebe nada.
  const base = Number.isFinite(linkEnviadoEmMs) ? linkEnviadoEmMs : agoraMs;
  const alvo = base + DIAS_DO_TOQUE[proximo - 1] * MS_POR_DIA;

  // Worker que ficou fora do ar não dispara toque com data no passado — e não
  // dispara os atrasados em rajada, porque só um toque é planejado por vez.
  const quando = Math.max(alvo, agoraMs);

  return { tipo: "toque", toque: proximo, quandoIso: new Date(quando).toISOString() };
}

export function cicloEstaPausado(cicloPausadoAte: string | null, agoraMs: number): boolean {
  if (!cicloPausadoAte) return false;
  const ate = Date.parse(cicloPausadoAte);
  // Data ilegível: não pausa. Prender o lead para sempre é pior do que um toque.
  if (Number.isNaN(ate)) return false;
  return ate > agoraMs;
}
