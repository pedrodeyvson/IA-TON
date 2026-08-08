import { test } from "node:test";
import assert from "node:assert/strict";
import { responderComoHumano } from "./inbox.server.ts";

/**
 * Dublê mínimo do client do Supabase, registrando a ordem das operações.
 * `leads` e `conversas` respondem a update; `mensagens` responde a insert e
 * update, como enviarTextoDoCrm espera.
 */
function adminFalso(opcoes: { telefone?: string | null } = {}) {
  const ordem: string[] = [];
  const telefone = opcoes.telefone === undefined ? "5511999999999" : opcoes.telefone;

  const admin: any = {
    ordem,
    from(tabela: string) {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        maybeSingle: async () => {
          ordem.push(`select:${tabela}`);
          return { data: tabela === "leads" ? { id: "lead-1", telefone } : {}, error: null };
        },
        single: async () => {
          ordem.push(`insert:${tabela}`);
          return { data: { id: "msg-1" }, error: null };
        },
        insert() {
          return this;
        },
        update(campos: Record<string, unknown>) {
          ordem.push(`update:${tabela}:${Object.keys(campos).join(",")}`);
          return this;
        },
      };
    },
  };
  return admin;
}

test("pausa a IA antes de enviar", async () => {
  const admin = adminFalso();
  const enviados: string[] = [];

  const resultado = await responderComoHumano(
    admin,
    { conversaId: "conv-1", leadId: "lead-1", texto: "oi, aqui é o Pedro" },
    {
      enviar: async (_numero, texto) => {
        admin.ordem.push("envio");
        enviados.push(texto);
        return { messageid: "prov-1" };
      },
    },
  );

  assert.equal(resultado.ok, true);
  const posPausa = admin.ordem.findIndex((p: string) => p.startsWith("update:conversas:pausada_pela_ia"));
  const posEnvio = admin.ordem.indexOf("envio");
  assert.ok(posPausa !== -1, "não pausou a IA");
  // Na ordem inversa, um worker acordando no meio entregaria a resposta da IA
  // logo depois da humana, possivelmente se contradizendo.
  assert.ok(posPausa < posEnvio, "pausou depois de enviar");
});

test("usa o telefone do banco, ignorando o que vier de fora", async () => {
  const admin = adminFalso({ telefone: "5511888888888" });
  let numeroUsado = "";

  await responderComoHumano(
    admin,
    // O tipo não aceita telefone; este teste garante que, mesmo que alguém
    // acrescente o campo depois, o valor do banco continua ganhando.
    { conversaId: "conv-1", leadId: "lead-1", texto: "oi", telefone: "5511000000000" } as any,
    {
      enviar: async (numero) => {
        numeroUsado = numero;
        return { messageid: "prov-1" };
      },
    },
  );

  assert.equal(numeroUsado, "5511888888888");
});

test("lead sem telefone não envia e explica o motivo", async () => {
  const admin = adminFalso({ telefone: null });
  let chamou = false;

  const resultado = await responderComoHumano(
    admin,
    { conversaId: "conv-1", leadId: "lead-1", texto: "oi" },
    {
      enviar: async () => {
        chamou = true;
        return {};
      },
    },
  );

  assert.equal(resultado.ok, false);
  assert.match(resultado.erro ?? "", /telefone/i);
  assert.equal(chamou, false);
});

test("texto em branco é recusado antes de qualquer escrita", async () => {
  const admin = adminFalso();
  const resultado = await responderComoHumano(
    admin,
    { conversaId: "conv-1", leadId: "lead-1", texto: "   " },
    { enviar: async () => ({}) },
  );
  assert.equal(resultado.ok, false);
  assert.deepEqual(admin.ordem, []);
});

test("falha no envio devolve erro sem lançar", async () => {
  const admin = adminFalso();
  const resultado = await responderComoHumano(
    admin,
    { conversaId: "conv-1", leadId: "lead-1", texto: "oi" },
    {
      enviar: async () => {
        throw new Error("uazapi fora do ar");
      },
    },
  );
  assert.equal(resultado.ok, false);
  assert.match(resultado.erro ?? "", /uazapi/i);
});
