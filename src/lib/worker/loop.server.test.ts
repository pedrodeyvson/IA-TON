import { test } from "node:test";
import assert from "node:assert/strict";
import { criarAdminFake } from "../crm/admin-fake.ts";
import { processarPendentes } from "./loop.server.ts";

/**
 * A varredura de órfãos e a de pendentes batem na mesma tabela; o que as separa
 * é o filtro. O fake registra os filtros, então dá para responder cada uma.
 */
function adminComPendente(motivo: "resposta" | "followup") {
  return criarAdminFake({
    "conversas.select": (chamada: any) => {
      const colunas = chamada.filtros.map(([coluna]: [string, unknown]) => coluna);
      if (!colunas.includes("responder_em")) return { data: [], error: null }; // órfãos
      return {
        data: [{ id: "C1", lead_id: "L1", motivo_agendamento: motivo, tentativas: 0 }],
        error: null,
      };
    },
    // O UPDATE do lock devolve a linha travada: quem recebe linha, processa.
    "conversas.update": { data: [{ id: "C1" }], error: null },
  });
}

function updatesDeConversa(admin: any) {
  return admin.chamadas
    .filter((c: any) => c.tabela === "conversas" && c.operacao === "update")
    .map((c: any) => c.payload);
}

test("processa a conversa vencida e limpa o agendamento no fim", async () => {
  const admin = adminComPendente("resposta");
  const vistos: any[] = [];

  const total = await processarPendentes(admin, {
    turno: async (_a: any, ctx: any) => { vistos.push(ctx); return { status: "respondeu" }; },
  });

  assert.equal(total, 1);
  assert.deepEqual(vistos, [{ conversaId: "C1", leadId: "L1", motivo: "resposta" }]);
  assert.ok(updatesDeConversa(admin).some((p: any) => p.responder_em === null));
});

test("NÃO apaga o toque que o turno acabou de agendar", async () => {
  const admin = adminComPendente("followup");

  await processarPendentes(admin, {
    turno: async () => ({ status: "respondeu", reagendou: true }),
  });

  const limpezas = updatesDeConversa(admin).filter((p: any) => "responder_em" in p && p.responder_em === null);
  assert.equal(limpezas.length, 0, "limparAgendamento aqui mataria a régua");
  // Mas o lock TEM que sair, senão a conversa fica presa até o varredor passar.
  assert.ok(updatesDeConversa(admin).some((p: any) => p.processando_em === null));
});

test("turno pulado não é falha: limpa o agendamento e não conta tentativa", async () => {
  const admin = adminComPendente("followup");

  await processarPendentes(admin, {
    turno: async () => ({ status: "pulado", motivo: "ciclo_pausado" }),
  });

  const payloads = updatesDeConversa(admin);
  assert.ok(payloads.some((p: any) => p.responder_em === null));
  assert.equal(payloads.some((p: any) => p.tentativas !== undefined), false);
});

test("erro no turno vira backoff com tentativa incrementada", async () => {
  const admin = adminComPendente("resposta");

  await processarPendentes(admin, {
    turno: async () => ({ status: "erro", motivo: "OpenAI 503" }),
  });

  const falha = updatesDeConversa(admin).find((p: any) => p.tentativas === 1);
  assert.ok(falha, "a primeira falha grava tentativas = 1");
  assert.equal(falha.ultimo_erro, "OpenAI 503");
  assert.ok(falha.responder_em, "reagenda para tentar de novo");
});

test("sem candidata, não chama turno nenhum", async () => {
  const admin = criarAdminFake({ "conversas.select": { data: [], error: null } });
  let chamou = false;

  const total = await processarPendentes(admin, {
    turno: async () => { chamou = true; return { status: "respondeu" }; },
  });

  assert.equal(total, 0);
  assert.equal(chamou, false);
});
