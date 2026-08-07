import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types.ts";

const URL_SUPABASE =
  import.meta.env?.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
const CHAVE_PUBLICAVEL =
  import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY ?? "";

/**
 * As chaves novas do Supabase (sb_publishable_/sb_secret_) NÃO são JWTs.
 * Mandar `Authorization: Bearer <chave>` faz o PostgREST rejeitar — só o
 * header `apikey` deve carregá-la.
 */
function ehChaveNova(chave: string): boolean {
  return chave.startsWith("sb_publishable_") || chave.startsWith("sb_secret_");
}

export function criarFetchSupabase(chave: string): typeof fetch {
  return async (entrada, init) => {
    const headers = new Headers(init?.headers);
    if (ehChaveNova(chave) && headers.get("Authorization") === `Bearer ${chave}`) {
      headers.delete("Authorization");
    }
    headers.set("apikey", chave);
    return fetch(entrada, { ...init, headers });
  };
}

function criar() {
  if (!URL_SUPABASE || !CHAVE_PUBLICAVEL) {
    throw new Error("Supabase não configurado: defina VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY");
  }
  return createClient<Database>(URL_SUPABASE, CHAVE_PUBLICAVEL, {
    global: { fetch: criarFetchSupabase(CHAVE_PUBLICAVEL) },
    auth: {
      storage: typeof window !== "undefined" ? localStorage : undefined,
      persistSession: true,
      autoRefreshToken: true,
    },
  });
}

// Proxy lazy: não instancia (nem valida env) até o primeiro uso, para que
// importar este módulo num contexto sem env não derrube o processo.
let _cliente: ReturnType<typeof criar> | undefined;
export const supabase = new Proxy({} as ReturnType<typeof criar>, {
  get(_alvo, prop, receptor) {
    if (!_cliente) _cliente = criar();
    return Reflect.get(_cliente, prop, receptor);
  },
});
