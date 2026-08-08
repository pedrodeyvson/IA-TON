import { test } from "node:test";
import assert from "node:assert/strict";
import { obterUsuario, ehDono } from "./sessao.server.ts";

function clienteFalso(resposta: any) {
  return { auth: { getUser: async () => resposta } };
}

test("sem usuário na resposta do Supabase, não há sessão", async () => {
  const usuario = await obterUsuario({
    criarCliente: () => clienteFalso({ data: { user: null }, error: null }),
  });
  assert.equal(usuario, null);
});

test("token recusado pelo servidor não vira sessão", async () => {
  // getUser() valida contra o Supabase; um cookie forjado cai aqui, e é por
  // isso que este módulo não usa getSession(), que só decodifica o JWT local.
  const usuario = await obterUsuario({
    criarCliente: () => clienteFalso({ data: { user: null }, error: { message: "invalid JWT" } }),
  });
  assert.equal(usuario, null);
});

test("usuário válido volta como id e email", async () => {
  const usuario = await obterUsuario({
    criarCliente: () =>
      clienteFalso({ data: { user: { id: "u-1", email: "pedro@exemplo.com" } }, error: null }),
  });
  assert.deepEqual(usuario, { id: "u-1", email: "pedro@exemplo.com" });
});

test("usuário sem email não inventa string vazia", async () => {
  const usuario = await obterUsuario({
    criarCliente: () => clienteFalso({ data: { user: { id: "u-1", email: null } }, error: null }),
  });
  assert.deepEqual(usuario, { id: "u-1", email: undefined });
});

test("exceção do getUser não escapa — vira ausência de sessão", async () => {
  // Supabase fora do ar tem que virar 401, não stack trace no handler.
  const usuario = await obterUsuario({
    criarCliente: () => ({
      auth: {
        getUser: async () => {
          throw new Error("supabase fora do ar");
        },
      },
    }),
  });
  assert.equal(usuario, null);
});

test("com criarCliente injetado, nada do runtime do TanStack é tocado", async () => {
  // Se criarClienteDeSessao resolvesse os helpers de cookie antes de checar o
  // criarCliente injetado, este teste explodiria fora de um request.
  let chamou = false;
  await obterUsuario({
    criarCliente: () => {
      chamou = true;
      return clienteFalso({ data: { user: null }, error: null });
    },
  });
  assert.equal(chamou, true);
});

// ===================== autorização: ehDono =====================
// Autenticado NÃO é autorizado. As server functions usam service role e
// ignoram o RLS, então `public.donos` só protege o PostgREST — por aqui, quem
// tem que consultar a tabela é este código.

/** Admin falso mínimo: só o caminho from().select().eq().maybeSingle(). */
function criarAdminDeDonos(ids: string[]) {
  return {
    from: () => ({
      select: () => ({
        eq: (_coluna: string, valor: string) => ({
          maybeSingle: async () => ({
            data: ids.includes(valor) ? { user_id: valor } : null,
            error: null,
          }),
        }),
      }),
    }),
  };
}

test("ehDono: usuário presente em donos é autorizado", async () => {
  assert.equal(await ehDono("u1", { admin: criarAdminDeDonos(["u1"]) }), true);
});

test("ehDono: conta criada por signup, ausente de donos, é recusada", async () => {
  // Cenário real: publishable key sai no bundle -> /auth/v1/signup -> login no
  // CRM. Sem esta recusa ele lê todo lead e dispara WhatsApp em nome da casa.
  assert.equal(await ehDono("intruso", { admin: criarAdminDeDonos(["u1"]) }), false);
});

test("ehDono: falha do banco NEGA o acesso, não libera", async () => {
  const comErro = {
    from: () => ({ select: () => ({ eq: () => ({
      maybeSingle: async () => ({ data: null, error: { message: "conexão caiu" } }),
    }) }) }),
  };
  assert.equal(await ehDono("u1", { admin: comErro }), false);
});

test("ehDono: exceção também NEGA — falha fechado em qualquer caminho", async () => {
  const explode = { from: () => { throw new Error("boom"); } };
  assert.equal(await ehDono("u1", { admin: explode }), false);
});
