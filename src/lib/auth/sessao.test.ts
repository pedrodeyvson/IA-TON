import { test } from "node:test";
import assert from "node:assert/strict";
import { obterUsuario } from "./sessao.server.ts";

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
