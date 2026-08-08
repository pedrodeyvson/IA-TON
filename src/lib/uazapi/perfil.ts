// Puro: sem banco, sem uazapi, sem alias — mesma regra de rotulos.ts, para o
// node --test importar direto.

export type PerfilUazapi = {
  name?: string | null;
  wa_name?: string | null;
  wa_contactName?: string | null;
  image?: string | null;
};

/**
 * Só sobrescrevemos nome PLACEHOLDER — nunca edição manual do operador.
 * Critério espelhado do CPI (src/lib/uazapi/profile.ts, isPlaceholderName):
 * vazio, começa com "WhatsApp ", igual ao telefone, ou só dígitos (mesmo que
 * não bata com o telefone — "61006359338" é lixo de ingestão, não um nome).
 */
export function nomeEhPlaceholder(
  nome: string | null | undefined,
  telefone: string | null | undefined,
): boolean {
  const n = (nome ?? "").trim();
  if (!n) return true;
  if (n.startsWith("WhatsApp ")) return true;
  if (telefone && n === telefone.trim()) return true;
  if (/^\d+$/.test(n)) return true;
  return false;
}

/** Prioridade: wa_contactName (só quem está na agenda do número) > name >
 *  wa_name. Campos vazios/só espaço contam como ausentes. */
export function escolherNomeDoPerfil(perfil: PerfilUazapi | null | undefined): string | null {
  const candidatos = [perfil?.wa_contactName, perfil?.name, perfil?.wa_name];
  for (const c of candidatos) {
    const t = (c ?? "").trim();
    if (t) return t;
  }
  return null;
}
