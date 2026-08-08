// Middlewares das server functions. Vai ao bundle do cliente (só o corpo do
// .server() é removido) — nada server-only no topo.
import { createMiddleware } from "@tanstack/react-start";

/**
 * A fronteira de segurança do app inteiro.
 *
 * As server functions usam o client de service role, que ignora o RLS. Uma
 * função sem este middleware é um endpoint público no banco — há um
 * teste em crm.functions.test.ts que falha se alguma esquecer.
 *
 * Duas checagens, e a segunda não é redundante:
 *
 * 1. AUTENTICADO — `auth.getUser()`, que valida contra o servidor do Supabase.
 *    `getSession()` só decodifica o cookie, e um cookie forjado passaria.
 * 2. AUTORIZADO — está em `public.donos`. Como o service role ignora o RLS, a
 *    barreira que a migration 20260808d criou no banco protege apenas o
 *    PostgREST; por aqui ela não é consultada por ninguém. Sem o passo 2,
 *    qualquer conta criada em /auth/v1/signup (a publishable key vai no bundle
 *    do cliente) vira operador do CRM com acesso total de leitura E escrita.
 */
export const exigirSessao = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    const { obterUsuario, ehDono } = await import("./sessao.server.ts");
    const usuario = await obterUsuario();
    if (!usuario) {
      throw new Response("nao_autenticado", { status: 401 });
    }
    if (!(await ehDono(usuario.id))) {
      // 403, não 401: a sessão é válida, o que falta é permissão. Mandar para
      // o login não resolveria nada — ele já está logado.
      throw new Response("nao_autorizado", { status: 403 });
    }
    return next({ context: { usuario } });
  }
);

/** Equivalente ao logServerFnErrors do CPI: erro não some no console do browser. */
export const registrarErros = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    try {
      return await next();
    } catch (err: any) {
      // Response é fluxo normal (401, redirect) — não é erro para logar.
      if (!(err instanceof Response)) {
        console.error("[serverFn]", err?.message ?? err);
      }
      throw err;
    }
  }
);
