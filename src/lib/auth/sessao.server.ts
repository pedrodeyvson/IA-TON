// Sessão do operador sobre cookie httpOnly. Server-only.
//
// Usa auth.getUser(), NUNCA auth.getSession(): o getSession só decodifica o JWT
// que veio no cookie, então um cookie forjado passaria. O getUser valida contra
// o servidor do Supabase. Como as server functions rodam com service role (que
// ignora o RLS), esta é a checagem que sustenta a autorização inteira do app.
import { createServerClient } from "@supabase/ssr";
import { criarFetchSupabase } from "../../integrations/supabase/client.ts";

export type CookieLido = { name: string; value: string };
export type CookieParaGravar = { name: string; value: string; options?: any };

export type DepsSessao = {
  /** Injetáveis só para teste. Em produção resolvem para os helpers do TanStack. */
  lerCookies?: () => CookieLido[];
  gravarCookies?: (cookies: CookieParaGravar[]) => void;
  criarCliente?: (deps: DepsSessao) => any;
};

/** Os helpers de cookie só existem dentro do request do TanStack, por isso são
 *  resolvidos por import dinâmico — e por isso criarClienteDeSessao é async. */
async function helpersDoPedido() {
  const { getCookies, setCookie } = await import("@tanstack/react-start/server");
  return {
    lerCookies: (): CookieLido[] =>
      Object.entries(getCookies() ?? {}).map(([name, value]) => ({ name, value: String(value) })),
    gravarCookies: (cookies: CookieParaGravar[]) => {
      for (const { name, value, options } of cookies) setCookie(name, value, options);
    },
  };
}

function criarClientePadrao(deps: Required<Pick<DepsSessao, "lerCookies" | "gravarCookies">>) {
  const url = process.env.SUPABASE_URL ?? "";
  const chave = process.env.SUPABASE_PUBLISHABLE_KEY ?? "";
  if (!url || !chave) {
    throw new Error("Sessão não configurada: defina SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY");
  }
  return createServerClient(url, chave, {
    // Mesmo tratamento das chaves novas (sb_publishable_) usado nos outros
    // clients: elas não são JWT e o PostgREST rejeita se forem no Authorization.
    global: { fetch: criarFetchSupabase(chave) },
    cookies: {
      getAll: () => deps.lerCookies(),
      setAll: (cookies: CookieParaGravar[]) => deps.gravarCookies(cookies),
    },
  });
}

/** Client ligado aos cookies do request atual. Use dentro de um handler. */
export async function criarClienteDeSessao(deps: DepsSessao = {}): Promise<any> {
  // O client injetado vem primeiro, e nada do runtime do TanStack é tocado —
  // é o que permite testar este módulo sob node --test, fora de um request.
  if (deps.criarCliente) return deps.criarCliente(deps);

  const doPedido = await helpersDoPedido();
  return criarClientePadrao({
    lerCookies: deps.lerCookies ?? doPedido.lerCookies,
    gravarCookies: deps.gravarCookies ?? doPedido.gravarCookies,
  });
}

/**
 * Usuário logado, ou null. Nunca lança: uma falha de rede com o Supabase vira
 * "não autenticado", que o middleware traduz em 401 — melhor recusar do que
 * derrubar o handler com stack trace.
 */
export async function obterUsuario(
  deps: DepsSessao = {},
): Promise<{ id: string; email?: string } | null> {
  try {
    const cliente = await criarClienteDeSessao(deps);
    const { data, error } = await cliente.auth.getUser();
    if (error || !data?.user) return null;
    return { id: data.user.id, email: data.user.email ?? undefined };
  } catch {
    return null;
  }
}

/**
 * O usuário está em `public.donos`?
 *
 * Autenticado NÃO é o mesmo que autorizado. As server functions rodam com
 * service role, que ignora o RLS — então a barreira que a migration
 * 20260808d levantou no banco protege só o acesso direto via PostgREST, e o
 * CRM não passa por lá. Sem esta checagem, qualquer conta criada em
 * /auth/v1/signup (a publishable key está no bundle) lê todos os leads e
 * mensagens E escreve: dispara WhatsApp real, move estágio, apaga tarefa.
 *
 * Falha FECHADO: erro de banco vira "não é dono". Recusar acesso numa
 * indisponibilidade é o lado certo de errar para a fronteira de segurança do
 * app inteiro.
 */
export async function ehDono(
  usuarioId: string,
  deps: { admin?: any } = {},
): Promise<boolean> {
  try {
    const admin =
      deps.admin ?? (await import("../../integrations/supabase/client.server.ts")).supabaseAdmin;
    const { data, error } = await admin
      .from("donos")
      .select("user_id")
      .eq("user_id", usuarioId)
      .maybeSingle();
    if (error) {
      console.error("[auth] falha ao conferir donos — negando acesso:", error.message);
      return false;
    }
    return Boolean(data);
  } catch (err: any) {
    console.error("[auth] exceção ao conferir donos — negando acesso:", err?.message ?? err);
    return false;
  }
}
