import { test } from "node:test";
import assert from "node:assert/strict";
import { criarAdminFake } from "../crm/admin-fake.ts";
import { DEFINICOES_TOOLS, executarTool } from "./tools.ts";
import { PRODUTOS } from "./links.ts";

const CTX = { leadId: "L1", conversaId: "C1" };
const REF = "CEA4255F-0783-4EAD-AA55-48C682BA8FA7";

function adminComLead(estagio = "qualificando") {
  return criarAdminFake({
    "leads.select": { data: { id: "L1", estagio }, error: null },
  });
}

function updateDe(admin: any, tabela: string) {
  return admin.chamadas.find((c: any) => c.tabela === tabela && c.operacao === "update")?.payload;
}

test("declara exatamente as quatro tools desta fatia", () => {
  const nomes = (DEFINICOES_TOOLS as any[]).map((t) => t.function.name).sort();
  assert.deepEqual(nomes, [
    "atualizar_lead",
    "escalar_para_humano",
    "registrar_link_enviado",
    "registrar_resultado_compra",
  ]);
});

test("toda tool tem descrição e schema de objeto", () => {
  for (const t of DEFINICOES_TOOLS as any[]) {
    assert.ok(t.function.description?.length > 10, `${t.function.name} sem descrição`);
    assert.equal(t.function.parameters.type, "object");
  }
});

test("o schema do link só aceita produto da lista — o modelo não digita URL", () => {
  const link = (DEFINICOES_TOOLS as any[]).find((t) => t.function.name === "registrar_link_enviado");
  const enumerados = link.function.parameters.properties.produto.enum;
  assert.ok(enumerados.includes("catalogo"));
  assert.ok(enumerados.includes("TONMEGA_TIER_SMART_POS"));
  assert.deepEqual(link.function.parameters.required, ["produto"]);
  // Nenhuma propriedade de texto livre que caiba um endereço.
  assert.equal(Object.keys(link.function.parameters.properties).length, 1);
});

test("o schema do resultado da compra tem os três resultados do adendo", () => {
  const t = (DEFINICOES_TOOLS as any[]).find((x) => x.function.name === "registrar_resultado_compra");
  assert.deepEqual(t.function.parameters.properties.resultado.enum, [
    "comprou",
    "nao_comprou",
    "nao_perturbe",
  ]);
});

test("atualizar_lead grava nome e máquina", async () => {
  const admin = adminComLead();
  const r = await executarTool(admin, "atualizar_lead", { nome: "Ana", maquina_interesse: "T3 Smart" }, CTX);
  const p = updateDe(admin, "leads");
  assert.equal(p.nome, "Ana");
  assert.equal(p.maquina_interesse, "T3 Smart");
  assert.match(r.conteudo, /ok/i);
});

test("atualizar_lead com estágio inválido devolve erro ao modelo sem gravar", async () => {
  const admin = adminComLead();
  const r = await executarTool(admin, "atualizar_lead", { estagio: "negociando" }, CTX);
  assert.match(r.conteudo, /inválido|invalido/i);
  assert.equal(admin.chamadas.some((c) => c.operacao === "update"), false);
});

test("registrar_link_enviado devolve o checkout do produto escolhido", async () => {
  process.env.TON_REFERRER = REF;
  const admin = adminComLead();
  const r = await executarTool(admin, "registrar_link_enviado", { produto: "TONMEGA_TIER_S920" }, CTX);

  assert.match(r.conteudo, /https:\/\/ton\.com\.br\/checkout\/cart\/\?productId=TONMEGA_TIER_S920/);
  assert.match(r.conteudo, new RegExp(`referrer=${REF}`));
  assert.match(r.conteudo, /userTag=tonmega_tier/);
});

test("registrar_link_enviado com catalogo devolve o catálogo", async () => {
  process.env.TON_REFERRER = REF;
  const admin = adminComLead();
  const r = await executarTool(admin, "registrar_link_enviado", { produto: "catalogo" }, CTX);
  assert.match(r.conteudo, /https:\/\/ton\.com\.br\/catalogo\//);
  assert.equal(r.conteudo.includes("productId"), false);
});

test("registrar_link_enviado move o estágio e abre o ciclo no toque de 24h", async () => {
  process.env.TON_REFERRER = REF;
  const admin = adminComLead();
  const antes = Date.now();
  await executarTool(admin, "registrar_link_enviado", { produto: "TONMEGA_TIER_D195" }, CTX);

  assert.equal(updateDe(admin, "leads").estagio, "link_enviado");

  const updates = admin.chamadas.filter((c) => c.tabela === "conversas" && c.operacao === "update");
  const zerou = updates.find((u) => u.payload.followup_toque === 0);
  assert.ok(zerou, "um link novo abre um ciclo novo");
  assert.equal(zerou?.payload.ciclo_pausado_ate, null);

  const agendou = updates.find((u) => u.payload.motivo_agendamento === "followup");
  assert.ok(agendou, "tem que agendar o primeiro toque");
  const quando = new Date(agendou!.payload.responder_em).getTime();
  assert.ok(quando >= antes + 86_400_000 - 5_000, "o toque 1 é 24h depois do link");
});

test("registrar_link_enviado grava a comissão real do produto escolhido", async () => {
  process.env.TON_REFERRER = REF;
  const admin = adminComLead();
  await executarTool(admin, "registrar_link_enviado", { produto: "TONMEGA_TIER_D195" }, CTX);

  const atualizacoesLeads = admin.chamadas.filter(
    (c: any) => c.tabela === "leads" && c.operacao === "update",
  );
  const comissao = atualizacoesLeads.find((u: any) => u.payload.comissao_estimada !== undefined);
  assert.ok(comissao, "tem que gravar comissao_estimada");
  assert.equal(comissao?.payload.comissao_estimada, PRODUTOS.TONMEGA_TIER_D195.comissaoBRL);
});

test("registrar_link_enviado com catalogo não grava comissão (cliente ainda não decidiu a máquina)", async () => {
  process.env.TON_REFERRER = REF;
  const admin = adminComLead();
  await executarTool(admin, "registrar_link_enviado", { produto: "catalogo" }, CTX);

  const atualizacoesLeads = admin.chamadas.filter(
    (c: any) => c.tabela === "leads" && c.operacao === "update",
  );
  assert.equal(
    atualizacoesLeads.some((u: any) => u.payload.comissao_estimada !== undefined),
    false,
    "catálogo não tem produto decidido, não pode gravar comissão",
  );
});

test("produto inventado devolve erro ao modelo e não mexe no lead", async () => {
  process.env.TON_REFERRER = REF;
  const admin = adminComLead();
  const r = await executarTool(admin, "registrar_link_enviado", { produto: "T3 Smart" }, CTX);
  assert.match(r.conteudo, /produto/i);
  assert.equal(r.escalou, undefined);
  assert.equal(admin.chamadas.some((c) => c.operacao === "update"), false);
});

test("sem TON_REFERRER escala em vez de mandar link sem indicação", async () => {
  const original = process.env.TON_REFERRER;
  delete process.env.TON_REFERRER;
  try {
    const admin = adminComLead();
    const r = await executarTool(admin, "registrar_link_enviado", { produto: "catalogo" }, CTX);
    assert.equal(r.escalou, true);
    assert.equal(updateDe(admin, "leads").precisa_atencao, true);
  } finally {
    if (original !== undefined) process.env.TON_REFERRER = original;
  }
});

test("registrar_link_enviado não manda o link quando o toque é recusado por não-perturbe", async () => {
  process.env.TON_REFERRER = REF;
  const admin = criarAdminFake({
    "leads.select": { data: { id: "L1", estagio: "qualificando" }, error: null },
    "conversas.select": { data: { id: "C1", leads: { nao_perturbe: true } }, error: null },
  });
  const r = await executarTool(admin, "registrar_link_enviado", { produto: "catalogo" }, CTX);

  assert.equal(r.escalou, true);
  assert.equal(r.conteudo.includes("https://"), false, "o link não pode aparecer na resposta");
  assert.equal(updateDe(admin, "leads").estagio, undefined, "o estágio não pode mudar para link_enviado");
  assert.equal(updateDe(admin, "leads").precisa_atencao, true);
  assert.equal(updateDe(admin, "conversas").pausada_pela_ia, true);
});

test("registrar_link_enviado não manda o link quando não dá para confirmar o opt-out", async () => {
  process.env.TON_REFERRER = REF;
  const admin = criarAdminFake({
    "leads.select": { data: { id: "L1", estagio: "qualificando" }, error: null },
    "conversas.select": () => ({ data: null, error: { message: "conexão com o banco caiu" } }),
  });
  const r = await executarTool(admin, "registrar_link_enviado", { produto: "catalogo" }, CTX);

  assert.equal(r.escalou, true);
  assert.equal(r.conteudo.includes("https://"), false, "o link não pode aparecer na resposta");
  assert.equal(updateDe(admin, "leads").estagio, undefined, "o estágio não pode mudar para link_enviado");
  assert.equal(updateDe(admin, "leads").precisa_atencao, true);
  assert.equal(updateDe(admin, "conversas").pausada_pela_ia, true);
});

test("resultado comprou converte o lead e encerra a régua", async () => {
  const admin = adminComLead("link_enviado");
  const r = await executarTool(admin, "registrar_resultado_compra", { resultado: "comprou" }, CTX);

  assert.equal(updateDe(admin, "leads").estagio, "convertido");
  const conversa = admin.chamadas.find(
    (c) => c.tabela === "conversas" && c.operacao === "update" && c.payload.responder_em === null,
  );
  assert.ok(conversa, "nenhum toque pode sair depois da compra");
  assert.match(r.conteudo, /pós-venda|pos-venda/i);
});

test("resultado nao_comprou guarda o motivo e manda quebrar a objeção agora", async () => {
  const admin = adminComLead("link_enviado");
  const r = await executarTool(
    admin,
    "registrar_resultado_compra",
    { resultado: "nao_comprou", detalhe: "achou a taxa alta" },
    CTX,
  );

  assert.equal(updateDe(admin, "leads").estagio, "contornando_objecao");
  const evento = admin.chamadas.find((c) => c.tabela === "eventos_lead");
  assert.equal(evento?.payload.tipo_evento, "nao_comprou");
  assert.match(evento?.payload.detalhe.motivo, /taxa alta/);
  assert.match(r.conteudo, /objeção|objecao/i);
  assert.equal(r.escalou, undefined, "não desista: o turno continua");
});

test("resultado nao_perturbe é opt-out definitivo e escala", async () => {
  const admin = adminComLead("link_enviado");
  const r = await executarTool(
    admin,
    "registrar_resultado_compra",
    { resultado: "nao_perturbe", detalhe: "pediu para não mandar mais" },
    CTX,
  );

  assert.equal(r.escalou, true);
  const lead = updateDe(admin, "leads");
  assert.equal(lead.nao_perturbe, true);
  assert.equal(lead.precisa_atencao, true);
});

test("resultado inventado devolve erro sem gravar nada", async () => {
  const admin = adminComLead();
  const r = await executarTool(admin, "registrar_resultado_compra", { resultado: "talvez" }, CTX);
  assert.match(r.conteudo, /resultado/i);
  assert.equal(admin.chamadas.some((c) => c.operacao === "update"), false);
});

test("escalar_para_humano marca atenção, pausa a conversa e sinaliza escalou", async () => {
  const admin = adminComLead();
  const r = await executarTool(admin, "escalar_para_humano", { motivo: "pediu taxa fora da tabela" }, CTX);

  assert.equal(r.escalou, true);
  assert.equal(updateDe(admin, "leads").precisa_atencao, true);
  assert.equal(updateDe(admin, "conversas").pausada_pela_ia, true);
});

test("escalar_para_humano sem motivo ainda escala", async () => {
  const admin = adminComLead();
  assert.equal((await executarTool(admin, "escalar_para_humano", {}, CTX)).escalou, true);
});

test("tool desconhecida devolve erro ao modelo sem lançar", async () => {
  const admin = adminComLead();
  const r = await executarTool(admin, "deletar_banco", {}, CTX);
  assert.match(r.conteudo, /desconhecida/i);
});
