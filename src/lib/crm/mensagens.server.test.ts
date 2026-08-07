import { test } from "node:test";
import assert from "node:assert/strict";
import { criarAdminFake } from "./admin-fake.ts";
import { enviarTextoDoCrm } from "./mensagens.server.ts";

const BASE = {
  conversaId: "C1", leadId: "L1", telefone: "5511987654321",
  texto: "Oi! Tudo bem?", remetente: "ia" as const,
};

test("grava a mensagem como pendente ANTES de tentar enviar", async () => {
  const ordem: string[] = [];
  const admin = criarAdminFake({
    "mensagens.insert": (c: any) => { ordem.push(`insert:${c.payload.status}`); return { data: { id: "M1" }, error: null }; },
  });
  await enviarTextoDoCrm(admin, BASE, {
    enviar: async () => { ordem.push("uazapi"); return { messageid: "WA1" }; },
  });
  assert.deepEqual(ordem.slice(0, 2), ["insert:pendente", "uazapi"]);
});

test("no sucesso marca enviada e guarda o provider_message_id", async () => {
  const admin = criarAdminFake({ "mensagens.insert": { data: { id: "M1" }, error: null } });
  const r = await enviarTextoDoCrm(admin, BASE, { enviar: async () => ({ messageid: "WA1" }) });

  assert.equal(r.ok, true);
  const update = admin.chamadas.find((c) => c.tabela === "mensagens" && c.operacao === "update");
  assert.equal(update?.payload.status, "enviada");
  assert.equal(update?.payload.provider_message_id, "WA1");
});

test("aceita id da UAZAPI vindo como `id` em vez de `messageid`", async () => {
  // A UAZAPI não é consistente entre endpoints; a Fatia 1 já apanhou disso
  // com sourceID/sourceId. Aceita as duas grafias.
  const admin = criarAdminFake({ "mensagens.insert": { data: { id: "M1" }, error: null } });
  await enviarTextoDoCrm(admin, BASE, { enviar: async () => ({ id: "WA2" }) });
  const update = admin.chamadas.find((c) => c.tabela === "mensagens" && c.operacao === "update");
  assert.equal(update?.payload.provider_message_id, "WA2");
});

test("falha no envio marca a mensagem como falhou e não lança", async () => {
  const admin = criarAdminFake({ "mensagens.insert": { data: { id: "M1" }, error: null } });
  const r = await enviarTextoDoCrm(admin, BASE, {
    enviar: async () => { throw new Error("UAZAPI 500"); },
  });

  assert.equal(r.ok, false);
  assert.match(r.erro ?? "", /UAZAPI 500/);
  const update = admin.chamadas.find((c) => c.tabela === "mensagens" && c.operacao === "update");
  assert.equal(update?.payload.status, "falhou");
});

test("grava direcao out e o remetente recebido", async () => {
  const admin = criarAdminFake({ "mensagens.insert": { data: { id: "M1" }, error: null } });
  await enviarTextoDoCrm(admin, { ...BASE, remetente: "humano" }, { enviar: async () => ({}) });

  const insert = admin.chamadas.find((c) => c.operacao === "insert");
  assert.equal(insert?.payload.direcao, "out");
  assert.equal(insert?.payload.remetente, "humano");
  assert.equal(insert?.payload.tipo, "texto");
  assert.equal(insert?.payload.conteudo, BASE.texto);
});

test("sem telefone não tenta enviar e devolve erro", async () => {
  const admin = criarAdminFake();
  let tentou = false;
  const r = await enviarTextoDoCrm(admin, { ...BASE, telefone: "" }, {
    enviar: async () => { tentou = true; return {}; },
  });
  assert.equal(r.ok, false);
  assert.equal(tentou, false);
});
