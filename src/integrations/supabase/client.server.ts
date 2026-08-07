import { createClient } from "@supabase/supabase-js";
import { criarFetchSupabase } from "./client.ts";
import type { Database } from "./types.ts";

// Server-only. Ignora RLS. NUNCA importar no topo de um .functions.ts ou de uma
// rota — só com `await import()` de dentro de um handler.
const URL_SUPABASE = process.env.SUPABASE_URL ?? "";
const CHAVE_SERVICO = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

function criar() {
  if (!URL_SUPABASE || !CHAVE_SERVICO) {
    throw new Error("Supabase admin não configurado: defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient<Database>(URL_SUPABASE, CHAVE_SERVICO, {
    global: { fetch: criarFetchSupabase(CHAVE_SERVICO) },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}

let _admin: ReturnType<typeof criar> | undefined;
export const supabaseAdmin = new Proxy({} as ReturnType<typeof criar>, {
  get(_alvo, prop, receptor) {
    if (!_admin) _admin = criar();
    return Reflect.get(_admin, prop, receptor);
  },
});
