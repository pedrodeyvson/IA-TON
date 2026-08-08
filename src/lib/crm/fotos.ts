// Assina em LOTE (uma chamada ao Storage, não uma por lead) as fotos dos
// leads que a lista do inbox vai mostrar. Bucket privado (crm-avatars) —
// decisão do dono, diferente do CPI que usa bucket público.

const BUCKET_AVATARS = "crm-avatars";
const SEGUNDOS_DE_VALIDADE = 300;

export type DepsFotos = {
  /** Injetável só para teste. */
  assinarEmLote?: (admin: any, caminhos: string[]) => Promise<Map<string, string>>;
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
 *  tinha `foto_path`. Leads sem foto_path não ganham a propriedade. */
export async function anexarFotosAssinadas(
  admin: any,
  leads: any[],
  deps: DepsFotos = {},
): Promise<any[]> {
  const caminhos = [...new Set(leads.map((l) => l.foto_path).filter(Boolean))] as string[];
  if (caminhos.length === 0) return leads;

  const assinar = deps.assinarEmLote ?? assinarEmLoteReal;
  const mapa = await assinar(admin, caminhos);

  return leads.map((l) =>
    l.foto_path ? { ...l, foto_url: mapa.get(l.foto_path) ?? null } : l,
  );
}
