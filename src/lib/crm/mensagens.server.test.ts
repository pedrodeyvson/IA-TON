import { test } from "node:test";
import assert from "node:assert/strict";
import { criarAdminFake } from "./admin-fake.ts";
import { enviarTextoDoCrm, listarMensagens } from "./mensagens.server.ts";

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

test("update para 'enviada' falha: a mensagem foi entregue, e o retorno sinaliza a falha de persistência separadamente", async () => {
  const admin = criarAdminFake({
    "mensagens.insert": { data: { id: "M1" }, error: null },
    "mensagens.update": { data: null, error: { message: "conexão perdida" } },
  });
  const r = await enviarTextoDoCrm(admin, BASE, { enviar: async () => ({ messageid: "WA1" }) });

  // A UAZAPI recebeu a mensagem — isso não é uma falha de envio — mas o
  // banco não conseguiu marcar "enviada", então o erro precisa aparecer
  // mesmo com ok:true, para quem chama não tratar isso como sucesso mudo.
  assert.equal(r.ok, true);
  assert.match(r.erro ?? "", /conexão perdida/);
});

test("falha no envio E falha ao marcar 'falhou': não lança e sinaliza os dois erros", async () => {
  const admin = criarAdminFake({
    "mensagens.insert": { data: { id: "M1" }, error: null },
    "mensagens.update": { data: null, error: { message: "timeout no update" } },
  });
  const r = await enviarTextoDoCrm(admin, BASE, {
    enviar: async () => { throw new Error("UAZAPI 500"); },
  });

  assert.equal(r.ok, false);
  assert.match(r.erro ?? "", /UAZAPI 500/);
  assert.match(r.erro ?? "", /timeout no update/);
});

test("update para 'falhou' lança exceção: a função ainda assim não lança", async () => {
  const admin = criarAdminFake({
    "mensagens.insert": { data: { id: "M1" }, error: null },
    "mensagens.update": () => { throw new Error("conexão caiu"); },
  });
  const r = await enviarTextoDoCrm(admin, BASE, {
    enviar: async () => { throw new Error("UAZAPI 500"); },
  });

  assert.equal(r.ok, false);
  assert.match(r.erro ?? "", /UAZAPI 500/);
  assert.match(r.erro ?? "", /conexão caiu/);
});

test("listarMensagens devolve a conversa do mais antigo para o mais novo", async () => {
  // O banco devolve mais novo primeiro (ORDER BY timestamp_ms DESC); a função
  // precisa inverter isso antes de devolver, senão a IA lê a conversa de
  // trás para frente sem ninguém perceber.
  const doBancoMaisNovoPrimeiro = [
    { id: "M3", timestamp_ms: 300 },
    { id: "M2", timestamp_ms: 200 },
    { id: "M1", timestamp_ms: 100 },
  ];
  const admin = criarAdminFake({
    "mensagens.select": { data: doBancoMaisNovoPrimeiro, error: null },
  });
  const resultado = await listarMensagens(admin, "C1");
  assert.deepEqual(resultado.map((m: any) => m.id), ["M1", "M2", "M3"]);
});
