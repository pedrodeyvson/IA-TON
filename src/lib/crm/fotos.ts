// src/lib/crm/fotos.ts
// Assina em LOTE (uma chamada ao Storage, não uma por lead) as fotos dos
// leads que a lista do inbox vai mostrar. Bucket privado (crm-avatars) —
// decisão do dono, diferente do CPI que usa bucket público.
//
// Cache em memória no processo do servidor: o inbox faz polling a cada 5s
// (useConversas.ts) e o Supabase gera um token novo (URL diferente) a cada
// createSignedUrls, mesmo pedindo o mesmo path — sem cache, isso rebaixaria
// TODOS os avatares a cada 5s (o <img src> muda mesmo que a foto não tenha
// mudado). O TTL do cache é bem menor que os 300s reais de validade da URL
// assinada, pra nunca servir uma URL vencida.

const BUCKET_AVATARS = "crm-avatars";
const SEGUNDOS_DE_VALIDADE = 300;
const TTL_CACHE_MS = 4 * 60 * 1000; // 240_000ms — folga de 1min antes dos 300s reais.

type EntradaCache = { url: string; expiraEm: number };
const cacheDeFotos = new Map<string, EntradaCache>();

/** Só para teste: evita vazamento de estado do cache em memória entre casos
 *  de teste (o cache é module-level, sobrevive entre chamadas de propósito). */
export function resetCacheDeFotosParaTeste(): void {
  cacheDeFotos.clear();
}

export type DepsFotos = {
  /** Injetável só para teste. */
  assinarEmLote?: (admin: any, caminhos: string[]) => Promise<Map<string, string>>;
  /** Injetável só para teste — evita depender de Date.now()/timers reais. */
  agora?: () => number;
};

async function assinarEmLoteReal(admin: any, caminhos: string[]): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  const { data, error } = await admin.storage
    .from(BUCKET_AVATARS)
    .createSignedUrls(caminhos, SEGUNDOS_DE_VALIDADE);
  if (error || !data) return mapa;
  for (const item of data) {
    if (item?.signedUrl && item?.path) mapa.set(item.path, item.signedUrl);
  }
  return mapa;
}

/** Devolve os mesmos leads, cada um com `foto_url` (string ou null) quando
 *  tinha `foto_path`. Leads sem foto_path não ganham a propriedade.
 *
 *  Só os caminhos sem cache válido (nunca assinados ou vencidos) entram na
 *  chamada real de assinatura — os demais reusam a URL já cacheada, então o
 *  `<img src>` só muda quando a URL realmente precisa trocar. */
export async function anexarFotosAssinadas(
  admin: any,
  leads: any[],
  deps: DepsFotos = {},
): Promise<any[]> {
  const caminhos = [...new Set(leads.map((l) => l.foto_path).filter(Boolean))] as string[];
  if (caminhos.length === 0) return leads;

  const agora = deps.agora ?? Date.now;
  const agoraMs = agora();

  const semCacheValido = caminhos.filter((c) => {
    const entrada = cacheDeFotos.get(c);
    return !entrada || entrada.expiraEm <= agoraMs;
  });

  if (semCacheValido.length > 0) {
    const assinar = deps.assinarEmLote ?? assinarEmLoteReal;
    try {
      const mapa = await assinar(admin, semCacheValido);
      for (const [path, url] of mapa) {
        cacheDeFotos.set(path, { url, expiraEm: agoraMs + TTL_CACHE_MS });
      }
    } catch {
      // best-effort: falha ao assinar foto (rede, exceção do client de
      // Storage) nunca pode derrubar a listagem inteira do inbox.
    }
  }

  return leads.map((l) => {
    if (!l.foto_path) return l;
    const entrada = cacheDeFotos.get(l.foto_path);
    const valido = entrada && entrada.expiraEm > agoraMs;
    return { ...l, foto_url: valido ? entrada!.url : null };
  });
}
