// Middlewares das server functions. Vai ao bundle do cliente (só o corpo do
// .server() é removido) — nada server-only no topo.
import { createMiddleware } from "@tanstack/react-start";

/**
 * A fronteira de segurança do app inteiro.
 *
 * As server functions usam o client de service role, que ignora o RLS. Uma
 * função sem este middleware é um endpoint público no banco — há um
 * teste em crm.functions.test.ts que falha se alguma esquecer.
 */
export const exigirSessao = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    const { obterUsuario } = await import("./sessao.server.ts");
    const usuario = await obterUsuario();
    if (!usuario) {
      throw new Response("nao_autenticado", { status: 401 });
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
