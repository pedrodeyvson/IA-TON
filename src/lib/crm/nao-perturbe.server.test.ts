import { test } from "node:test";
import assert from "node:assert/strict";
import { criarAdminFake } from "./admin-fake.ts";
import { registrarNaoPerturbe } from "./nao-perturbe.server.ts";

const CTX = { leadId: "L1", conversaId: "C1", motivo: "pediu para parar de receber mensagem" };

test("liga nao_perturbe e escala no mesmo movimento", async () => {
  const admin = criarAdminFake();
  await registrarNaoPerturbe(admin, CTX);

  const lead = admin.chamadas.find((c) => c.tabela === "leads" && c.operacao === "update");
  assert.equal(lead?.payload.nao_perturbe, true);
  assert.equal(lead?.payload.precisa_atencao, true, "o Pedro precisa saber que o lead saiu");
});

test("registra o evento com o motivo, para auditoria", async () => {
  const admin = criarAdminFake();
  await registrarNaoPerturbe(admin, CTX);

  const evento = admin.chamadas.find((c) => c.tabela === "eventos_lead");
  assert.equal(evento?.payload.tipo_evento, "nao_perturbe");
  assert.match(evento?.payload.detalhe.motivo, /parar/);
});

test("apaga qualquer agendamento pendente e pausa a IA", async () => {
  const admin = criarAdminFake();
  await registrarNaoPerturbe(admin, CTX);

  const updates = admin.chamadas.filter((c) => c.tabela === "conversas" && c.operacao === "update");
  assert.ok(updates.some((u) => u.payload.responder_em === null), "nenhum toque pode sobrar");
  assert.ok(updates.some((u) => u.payload.pausada_pela_ia === true));
});

test("zera o estado da régua (toque do ciclo e pausa de ciclo) junto com o agendamento", async () => {
  const admin = criarAdminFake();
  await registrarNaoPerturbe(admin, CTX);

  const updates = admin.chamadas.filter((c) => c.tabela === "conversas" && c.operacao === "update");
  assert.ok(updates.some((u) => u.payload.followup_toque === 0), "opt-out não pode deixar toque obsoleto");
  assert.ok(updates.some((u) => u.payload.ciclo_pausado_ate === null), "nem pausa de ciclo obsoleta");
});

test("funciona sem conversaId (opt-out vindo de fora da conversa)", async () => {
  const admin = criarAdminFake();
  await registrarNaoPerturbe(admin, { leadId: "L1", conversaId: null, motivo: "pediu no telefone" });
  assert.equal(admin.chamadas.some((c) => c.tabela === "conversas"), false);
  const lead = admin.chamadas.find((c) => c.tabela === "leads");
  assert.equal(lead?.payload.nao_perturbe, true);
});
