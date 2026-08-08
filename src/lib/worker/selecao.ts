// Puro: a única regra do worker que dá para testar sem banco.

/** Lock mais velho que isso é considerado abandonado (container reiniciou). */
export const MS_LOCK_ORFAO = 120_000;

export function ehLockOrfao(processandoEm: string | null, agoraMs: number): boolean {
  if (!processandoEm) return false;
  const quando = Date.parse(processandoEm);
  // Data ilegível: liberar é melhor do que deixar a conversa presa para sempre.
  if (Number.isNaN(quando)) return true;
  return agoraMs - quando > MS_LOCK_ORFAO;
}
