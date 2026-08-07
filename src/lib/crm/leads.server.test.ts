import { test } from "node:test";
import assert from "node:assert/strict";
import { criarAdminFake } from "./admin-fake.ts";
import {
  obterLead, atualizarLead, moverEstagio, marcarPrecisaAtencao, registrarNota,
} from "./leads.server.ts";

test("obterLead busca por id e devolve a linha", async () => {
  const admin = criarAdminFake({ "leads.select": { data: { id: "L1", estagio: "novo" }, error: null } });
  const lead = await obterLead(admin, "L1");
  assert.equal(lead.id, "L1");
  assert.deepEqual(admin.chamadas[0].filtros, [["id", "L1"]]);
});

test("obterLead devolve null quando não existe", async () => {
  const admin = criarAdminFake({ "leads.select": { data: null, error: null } });
  assert.equal(await obterLead(admin, "sumido"), null);
});

test("atualizarLead ignora campos undefined", async () => {
  const admin = criarAdminFake();
  await atualizarLead(admin, "L1", { nome: "Ana", maquina_interesse: undefined });
  const update = admin.chamadas.find((c) => c.operacao === "update");
  assert.deepEqual(update?.payload, { nome: "Ana" });
});

test("atualizarLead não toca no banco quando não há nada para mudar", async () => {
  const admin = criarAdminFake();
  await atualizarLead(admin, "L1", {});
  assert.equal(admin.chamadas.length, 0);
});

test("moverEstagio grava campos da transição e registra evento", async () => {
  const admin = criarAdminFake({
    "leads.select": { data: { id: "L1", estagio: "novo" }, error: null },
  });
  const mudou = await moverEstagio(admin, "L1", "qualificando");
  assert.equal(mudou, true);

  const update = admin.chamadas.find((c) => c.tabela === "leads" && c.operacao === "update");
  assert.equal(update?.payload.estagio, "qualificando");
  assert.ok(update?.payload.estagio_alterado_em);

  const evento = admin.chamadas.find((c) => c.tabela === "eventos_lead");
  assert.equal(evento?.payload.tipo_evento, "mudou_estagio");
  assert.deepEqual(evento?.payload.detalhe.de, "novo");
  assert.deepEqual(evento?.payload.detalhe.para, "qualificando");
});

test("moverEstagio para o mesmo estágio é no-op sem evento", async () => {
  const admin = criarAdminFake({
    "leads.select": { data: { id: "L1", estagio: "qualificando" }, error: null },
  });
  const mudou = await moverEstagio(admin, "L1", "qualificando");
  assert.equal(mudou, false);
  assert.equal(admin.chamadas.some((c) => c.tabela === "eventos_lead"), false);
});

test("moverEstagio para lead inexistente devolve false", async () => {
  const admin = criarAdminFake({ "leads.select": { data: null, error: null } });
  assert.equal(await moverEstagio(admin, "sumido", "qualificando"), false);
});

test("marcarPrecisaAtencao liga a flag e registra o motivo no evento", async () => {
  const admin = criarAdminFake();
  await marcarPrecisaAtencao(admin, "L1", "pediu para falar com humano");

  const update = admin.chamadas.find((c) => c.tabela === "leads" && c.operacao === "update");
  assert.equal(update?.payload.precisa_atencao, true);

  const evento = admin.chamadas.find((c) => c.tabela === "eventos_lead");
  assert.equal(evento?.payload.tipo_evento, "escalado");
  assert.equal(evento?.payload.detalhe.motivo, "pediu para falar com humano");
});

test("registrarNota grava evento do tipo nota", async () => {
  const admin = criarAdminFake();
  await registrarNota(admin, "L1", "cliente prefere ligar de manhã");
  const evento = admin.chamadas.find((c) => c.tabela === "eventos_lead");
  assert.equal(evento?.payload.tipo_evento, "nota");
  assert.equal(evento?.payload.detalhe.texto, "cliente prefere ligar de manhã");
});
