import { test } from "node:test";
import assert from "node:assert/strict";
import { criarAdminFake } from "./admin-fake.ts";
import {
  obterLead, atualizarLead, moverEstagio, marcarPrecisaAtencao, registrarNota,
  coletarEvidenciaDoLead,
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

// Achado Importante da revisão final da Fatia 6: `compraConfirmada` lia
// `estagio === "convertido"`, um proxy que "funcionava por acidente" — hoje
// quem grava a confirmação de verdade é `compra_confirmada_em`
// (registrar_resultado_compra, Task 4). Um lead pode estar em "convertido"
// por outro caminho sem ter essa data, e vice-versa não deveria acontecer,
// mas o campo certo para ler é sempre a data, não o estágio.

test("coletarEvidenciaDoLead lê compraConfirmada de compra_confirmada_em, não do estágio", async () => {
  const admin = criarAdminFake({
    "leads.select": {
      data: {
        estagio: "convertido",
        maquina_interesse: "T3",
        link_enviado_em: "2026-08-08T12:00:00.000Z",
        compra_confirmada_em: null,
      },
      error: null,
    },
    "mensagens.select": { data: [{ conteudo: "comprei, chegou certinho" }], error: null },
  });
  const ev = await coletarEvidenciaDoLead(admin, "L1");
  assert.equal(ev.compraConfirmada, false, "estagio convertido sozinho não basta mais");
});

test("coletarEvidenciaDoLead confirma compra quando compra_confirmada_em está preenchido", async () => {
  const admin = criarAdminFake({
    "leads.select": {
      data: {
        estagio: "convertido",
        maquina_interesse: "T3",
        link_enviado_em: "2026-08-08T12:00:00.000Z",
        compra_confirmada_em: "2026-08-08T13:00:00.000Z",
      },
      error: null,
    },
    "mensagens.select": { data: [{ conteudo: "comprei, chegou certinho" }], error: null },
  });
  const ev = await coletarEvidenciaDoLead(admin, "L1");
  assert.equal(ev.compraConfirmada, true);
});

test("registrarNota grava evento do tipo nota", async () => {
  const admin = criarAdminFake();
  await registrarNota(admin, "L1", "cliente prefere ligar de manhã");
  const evento = admin.chamadas.find((c) => c.tabela === "eventos_lead");
  assert.equal(evento?.payload.tipo_evento, "nota");
  assert.equal(evento?.payload.detalhe.texto, "cliente prefere ligar de manhã");
});

// Decisão de design (Passo 12/13 da Task 13): moverEstagio recebe
// `sincronizarCapi` por injeção de dependência opcional (parâmetro `deps`,
// com default resolvendo via import dinâmico do capi.server.ts real). Isso
// permite espiar a chamada sem precisar configurar META_PIXEL_ID/TOKEN nem
// stubar fetch global — e sem trocar o admin-fake deste arquivo (que só
// rastreia `chamadas`, não `_tabelas` como o de capi.server.test.ts).

test("moverEstagio sincroniza CAPI depois de gravar a transição, com os dados do lead", async () => {
  const chamadasCapi: any[] = [];
  const admin = criarAdminFake({
    "leads.select": {
      data: {
        id: "L1", estagio: "novo", ctwa_clid: "clid-1", ad_source_id: null,
        telefone: "5511999999999", nome: "Ana", comissao_estimada: null,
      },
      error: null,
    },
  });
  const espiao = async (adminRecebido: any, leadId: string, estagioAtual: string, dados: any) => {
    chamadasCapi.push({
      adminRecebido, leadId, estagioAtual, dados,
      // Snapshot das chamadas ao admin no momento do espião: prova que a
      // sincronização acontece DEPOIS de gravar update+evento, não antes.
      chamadasAntes: [...admin.chamadas],
    });
  };

  const mudou = await moverEstagio(admin, "L1", "qualificando", {}, { sincronizarCapi: espiao });
  assert.equal(mudou, true);

  assert.equal(chamadasCapi.length, 1, "sincronizarCapi tem que ser chamado exatamente uma vez");
  assert.equal(chamadasCapi[0].adminRecebido, admin);
  assert.equal(chamadasCapi[0].leadId, "L1");
  assert.equal(chamadasCapi[0].estagioAtual, "qualificando");
  assert.deepEqual(chamadasCapi[0].dados, {
    ctwaClid: "clid-1", adSourceId: null, telefone: "5511999999999", nome: "Ana", comissaoEstimada: null,
  });

  const antes = chamadasCapi[0].chamadasAntes;
  assert.ok(
    antes.some((c: any) => c.tabela === "leads" && c.operacao === "update"),
    "update de leads já tinha acontecido quando sincronizarCapi foi chamado",
  );
  assert.ok(
    antes.some((c: any) => c.tabela === "eventos_lead"),
    "registro de eventos_lead já tinha acontecido quando sincronizarCapi foi chamado",
  );
});

test("moverEstagio não deixa a transição falhar se a sincronização de CAPI der erro", async () => {
  const admin = criarAdminFake({
    "leads.select": {
      data: { id: "L1", estagio: "novo", ctwa_clid: "clid-quebrado", telefone: null, nome: null },
      error: null,
    },
  });
  const sincronizarQuebrado = async () => {
    throw new Error("CAPI explodiu");
  };

  const mudou = await moverEstagio(admin, "L1", "qualificando", {}, { sincronizarCapi: sincronizarQuebrado });
  assert.equal(mudou, true, "a transição tem que acontecer mesmo se a sincronização CAPI lançar");

  // A transição em si ainda foi gravada normalmente, apesar do espião ter lançado.
  const update = admin.chamadas.find((c) => c.tabela === "leads" && c.operacao === "update");
  assert.equal(update?.payload.estagio, "qualificando");
});
