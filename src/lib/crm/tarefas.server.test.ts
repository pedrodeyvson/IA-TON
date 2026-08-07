import { test } from "node:test";
import assert from "node:assert/strict";
import { criarAdminFake } from "./admin-fake.ts";
import { listarTarefas, criarTarefa, alternarTarefa, excluirTarefa } from "./tarefas.server.ts";

test("criarTarefa exige título não vazio", async () => {
  const admin = criarAdminFake();
  await assert.rejects(
    () => criarTarefa(admin, { leadId: "L1", titulo: "   " }),
    /título/i,
  );
  assert.equal(admin.chamadas.length, 0);
});

test("criarTarefa grava lead, título e prazo", async () => {
  const admin = criarAdminFake({ "tarefas.insert": { data: { id: "T1" }, error: null } });
  await criarTarefa(admin, { leadId: "L1", titulo: "Ligar", prazo: "2026-08-10T12:00:00.000Z" });

  const insert = admin.chamadas.find((c) => c.operacao === "insert");
  assert.equal(insert?.payload.lead_id, "L1");
  assert.equal(insert?.payload.titulo, "Ligar");
  assert.equal(insert?.payload.prazo, "2026-08-10T12:00:00.000Z");
  assert.equal(insert?.payload.concluida, false);
});

test("alternarTarefa para concluída carimba concluida_em", async () => {
  const admin = criarAdminFake();
  await alternarTarefa(admin, "T1", true);
  const p = admin.chamadas[0].payload;
  assert.equal(p.concluida, true);
  assert.ok(p.concluida_em);
});

test("alternarTarefa para pendente limpa concluida_em", async () => {
  const admin = criarAdminFake();
  await alternarTarefa(admin, "T1", false);
  const p = admin.chamadas[0].payload;
  assert.equal(p.concluida, false);
  assert.equal(p.concluida_em, null);
});

test("listarTarefas filtra por lead quando pedido", async () => {
  const admin = criarAdminFake({ "tarefas.select": { data: [{ id: "T1" }], error: null } });
  const r = await listarTarefas(admin, { leadId: "L1" });
  assert.equal(r.length, 1);
  assert.deepEqual(admin.chamadas[0].filtros, [["lead_id", "L1"]]);
});

test("listarTarefas sem filtro não aplica nenhum eq", async () => {
  const admin = criarAdminFake({ "tarefas.select": { data: [], error: null } });
  await listarTarefas(admin);
  assert.deepEqual(admin.chamadas[0].filtros, []);
});

test("excluirTarefa usa delete filtrando por id", async () => {
  const admin = criarAdminFake();
  await excluirTarefa(admin, "T1");
  assert.equal(admin.chamadas[0].operacao, "delete");
  assert.deepEqual(admin.chamadas[0].filtros, [["id", "T1"]]);
});
