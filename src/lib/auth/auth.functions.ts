// As TRÊS únicas server functions sem exigirSessao no projeto: entrar e sair
// criam/encerram a sessão; obterSessaoAtual só lê e devolve null em vez de
// 401. O teste do invariante em crm.functions.test.ts as conhece nominalmente
// como exceções.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { registrarErros } from "./middleware.ts";

const entradaLogin = z.object({
  email: z.string().email(),
  senha: z.string().min(1),
});

export const entrar = createServerFn({ method: "POST" })
  .middleware([registrarErros])
  .validator((dados: unknown) => entradaLogin.parse(dados))
  .handler(async ({ data }): Promise<{ ok: boolean; erro?: string }> => {
    const { criarClienteDeSessao } = await import("./sessao.server.ts");
    const cliente = await criarClienteDeSessao();
    const { error } = await cliente.auth.signInWithPassword({
      email: data.email,
      password: data.senha,
    });
    // Mensagem genérica de propósito: dizer qual campo errou entrega ao
    // atacante a informação de que aquele e-mail existe.
    if (error) return { ok: false, erro: "E-mail ou senha inválidos." };
    return { ok: true };
  });

export const sair = createServerFn({ method: "POST" })
  .middleware([registrarErros])
  .handler(async (): Promise<{ ok: true }> => {
    const { criarClienteDeSessao } = await import("./sessao.server.ts");
    const cliente = await criarClienteDeSessao();
    await cliente.auth.signOut();
    return { ok: true };
  });

/** Usada pelo beforeLoad do layout _app. Devolve null em vez de 401 — quem
 *  decide o redirect é a rota, não o middleware. */
export const obterSessaoAtual = createServerFn({ method: "GET" })
  .middleware([registrarErros])
  .handler(async (): Promise<{ id: string; email?: string } | null> => {
    const { obterUsuario } = await import("./sessao.server.ts");
    return obterUsuario();
  });
