import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CANAL_OFICIAL_TON, TAXAS, ANGULO_DO_TOQUE, ANGULO_DO_RESGATE, MODO_CONFIRMACAO,
} from "./conhecimento.ts";
import { montarSystemPrompt, instrucaoDoToque, instrucaoDoResgate, montarMensagens } from "./prompt.ts";

const LEAD = { nome: "Ana", estagio: "qualificando", maquina_interesse: null };

test("no modo venda o prompt traz a tabela de taxas e as objeções", () => {
  const p = montarSystemPrompt({ lead: LEAD, modo: "venda" });
  assert.ok(p.includes(TAXAS));
  assert.match(p, /Quebra de objeções/);
});

test("no modo pós-venda o prompt traz o roteiro de suporte e o canal oficial", () => {
  const p = montarSystemPrompt({ lead: { ...LEAD, estagio: "convertido" }, modo: "pos_venda" });
  assert.match(p, /Tente resolver/);
  assert.ok(p.includes(CANAL_OFICIAL_TON));
  // Não faz sentido gastar token com objeção de venda para quem já comprou.
  assert.equal(p.includes("Quebra de objeções"), false);
});

test("o prompt inclui nome, estágio e máquina do lead", () => {
  const p = montarSystemPrompt({
    lead: { nome: "Ana", estagio: "link_enviado", maquina_interesse: "T3 Smart" },
    modo: "venda",
  });
  assert.match(p, /Ana/);
  assert.match(p, /link_enviado/);
  assert.match(p, /T3 Smart/);
});

test("lead sem nome não vira 'null' no prompt", () => {
  const p = montarSystemPrompt({
    lead: { nome: null, estagio: "novo", maquina_interesse: null },
    modo: "venda",
  });
  assert.equal(p.includes("null"), false);
});

test("NENHUMA URL entra no prompt — o modelo só escolhe produto", () => {
  process.env.TON_REFERRER = "CEA4255F-0783-4EAD-AA55-48C682BA8FA7";
  for (const modo of ["venda", "pos_venda"] as const) {
    const p = montarSystemPrompt({ lead: LEAD, modo });
    assert.equal(p.includes("ton.com.br/checkout"), false, `${modo} vazou checkout`);
    assert.equal(p.includes("ton.com.br/catalogo"), false, `${modo} vazou catálogo`);
    assert.equal(p.includes("CEA4255F"), false, `${modo} vazou o referrer`);
    assert.equal(p.includes("referrer="), false, `${modo} vazou parâmetro de link`);
  }
});

test("a única URL do prompt é o canal de suporte da Ton", () => {
  // O canal de ajuda PODE aparecer: é o que a IA entrega ao encaminhar. Link de
  // venda, esse não — ele só existe dentro da tool.
  for (const modo of ["venda", "pos_venda"] as const) {
    const p = montarSystemPrompt({ lead: LEAD, modo });
    const urls = new Set(
      (p.match(/https?:\/\/\S+/g) ?? []).map((u) => u.replace(/[.,;:)]+$/, "")),
    );
    assert.deepEqual([...urls], ["https://ajuda.ton.com.br/"], `${modo} vazou URL`);
  }
});

test("o prompt lista os productId que o modelo pode escolher", () => {
  const p = montarSystemPrompt({ lead: LEAD, modo: "venda" });
  assert.match(p, /TONMEGA_TIER_SMART_POS/);
  assert.match(p, /TONBLACK_TIER_SMART_POS/);
  assert.match(p, /TONMEGA_TIER_S920/);
  assert.match(p, /TONMEGA_TIER_D195/);
  assert.match(p, /catalogo/);
});

test("o D150 (T1) agora é oferecido: a visita à página ao vivo achou o nome comercial", () => {
  // Antes o D150 não constava em nenhum PDF e ficava de fora (nome: null). A
  // visita a docs/conhecimento/links-verificados.md §5 achou "T1" na própria
  // página da Ton, então agora ele entra na lista como qualquer outro produto.
  const p = montarSystemPrompt({ lead: LEAD, modo: "venda" });
  assert.match(p, /TONMEGA_TIER_D150 — T1/);
});

test("o prompt explica as quatro tools, inclusive as novas", () => {
  const p = montarSystemPrompt({ lead: LEAD, modo: "venda" });
  for (const tool of [
    "atualizar_lead",
    "registrar_link_enviado",
    "registrar_resultado_compra",
    "escalar_para_humano",
  ]) {
    assert.match(p, new RegExp(tool), `${tool} não foi explicada`);
  }
});

test("instrucaoDoToque muda de ângulo a cada toque", () => {
  const textos = [1, 2, 3, 4].map((n) => instrucaoDoToque(n));
  assert.equal(new Set(textos).size, 4);
  assert.ok(textos[0].includes(ANGULO_DO_TOQUE[1]));
  assert.ok(textos[3].includes(ANGULO_DO_TOQUE[4]));
});

test("toda instrução de toque proíbe urgência inventada e repetição", () => {
  for (const n of [1, 2, 3, 4]) {
    const t = instrucaoDoToque(n).toLowerCase();
    assert.match(t, /não invente prazo|nao invente prazo/);
    assert.match(t, /não repita|nao repita/);
    assert.match(t, /uma (única )?mensagem/);
  }
});

test("toque fora da cadência não gera instrução de toque", () => {
  assert.throws(() => instrucaoDoToque(5), /cadência|cadencia/i);
  assert.throws(() => instrucaoDoToque(0), /cadência|cadencia/i);
});

test("instrucaoDoResgate muda de ângulo a cada toque, cadência SEPARADA da régua oficial", () => {
  const textos = [1, 2, 3, 4].map((n) => instrucaoDoResgate(n));
  assert.equal(new Set(textos).size, 4);
  assert.ok(textos[0].includes(ANGULO_DO_RESGATE[1]));
  assert.ok(textos[3].includes(ANGULO_DO_RESGATE[4]));
  // Não pode ser confundido com o texto da régua oficial.
  for (const [n, texto] of textos.entries()) {
    assert.equal(texto.includes(ANGULO_DO_TOQUE[(n + 1) as 1 | 2 | 3 | 4]), false);
  }
});

test("toda instrução de resgate proíbe urgência inventada, repetição e link", () => {
  for (const n of [1, 2, 3, 4]) {
    const t = instrucaoDoResgate(n).toLowerCase();
    assert.match(t, /não invente prazo|nao invente prazo/);
    assert.match(t, /não repita|nao repita/);
    assert.match(t, /não mande link|nao mande link/);
    assert.match(t, /uma (única )?mensagem/);
  }
});

test("toque de resgate fora da cadência (1..4) lança erro", () => {
  assert.throws(() => instrucaoDoResgate(5), /cadência|cadencia/i);
  assert.throws(() => instrucaoDoResgate(0), /cadência|cadencia/i);
});

test("montarMensagens põe o system na frente e o histórico na ordem", () => {
  const msgs = montarMensagens("SYS", [
    { remetente: "lead", conteudo: "oi" },
    { remetente: "ia", conteudo: "olá!" },
    { remetente: "lead", conteudo: "quanto custa" },
  ]);
  assert.equal(msgs[0].role, "system");
  assert.equal(msgs[0].content, "SYS");
  assert.deepEqual(msgs.slice(1).map((m) => m.role), ["user", "assistant", "user"]);
  assert.equal(msgs[3].content, "quanto custa");
});

test("mensagem humana entra como assistant (o lead não distingue quem falou)", () => {
  const msgs = montarMensagens("SYS", [{ remetente: "humano", conteudo: "aqui é o Pedro" }]);
  assert.equal(msgs[1].role, "assistant");
});

test("áudio entra pela transcrição, e sem ela vira marcador", () => {
  const comTexto = montarMensagens("SYS", [
    { remetente: "lead", tipo: "audio", conteudo: null, transcricao: "quero uma maquininha" },
  ]);
  assert.equal(comTexto[1].content, "quero uma maquininha");

  const semTexto = montarMensagens("SYS", [
    { remetente: "lead", tipo: "audio", conteudo: null, transcricao: null },
  ]);
  assert.match(semTexto[1].content ?? "", /áudio/i);
});

test("imagem vira marcador de texto nesta fatia", () => {
  const msgs = montarMensagens("SYS", [{ remetente: "lead", tipo: "imagem", conteudo: null }]);
  assert.match(msgs[1].content ?? "", /imagem/i);
});

test("imagem com mediaUrl vira mensagem multimodal (texto + image_url) de verdade", () => {
  const msgs = montarMensagens("SYS", [
    { remetente: "lead", tipo: "imagem", conteudo: "essa aqui?", mediaUrl: "https://exemplo.com/foto.jpg" },
  ]);
  const conteudo = msgs[1].content as any[];
  assert.ok(Array.isArray(conteudo));
  assert.deepEqual(conteudo[0], { type: "text", text: "essa aqui?" });
  assert.deepEqual(conteudo[1], { type: "image_url", image_url: { url: "https://exemplo.com/foto.jpg" } });
});

test("imagem sem mediaUrl continua no marcador de texto (fallback do Storage)", () => {
  const msgs = montarMensagens("SYS", [
    { remetente: "lead", tipo: "imagem", conteudo: "essa aqui?" },
  ]);
  assert.equal(typeof msgs[1].content, "string");
  assert.match(msgs[1].content as string, /imagem/i);
});

test("imagem COM legenda mantém o marcador — a legenda não pode virar texto puro", () => {
  // Achado real em produção: sem isso, o modelo respondia como se tivesse
  // visto a foto, tendo só a legenda.
  const msgs = montarMensagens("SYS", [
    { remetente: "lead", tipo: "imagem", conteudo: "essa aqui?" },
  ]);
  assert.match(msgs[1].content ?? "", /imagem/i);
  assert.match(msgs[1].content ?? "", /essa aqui\?/);
});

// ===================== Fatia 6, Task 4: modo CONFIRMAÇÃO =====================

test("sem link enviado, o modo venda NÃO traz o bloco de confirmação", () => {
  const p = montarSystemPrompt({ lead: LEAD, modo: "venda", confirmacaoPendente: false });
  assert.equal(p.includes(MODO_CONFIRMACAO), false);
});

test("link enviado sem compra confirmada: modo continua venda, mas com o bloco de confirmação", () => {
  const p = montarSystemPrompt({ lead: LEAD, modo: "venda", confirmacaoPendente: true });
  // Continua "venda", não um terceiro modo: a tabela de taxas e as objeções
  // seguem lá — é conteúdo ADICIONAL, não substituição de modo.
  assert.ok(p.includes(TAXAS));
  assert.match(p, /Quebra de objeções/);
  assert.ok(p.includes(MODO_CONFIRMACAO));
  assert.match(p, /conseguiu finalizar o cadastro/i);
});

test("confirmacaoPendente é ignorado no modo pós-venda — lá a compra já está confirmada", () => {
  const p = montarSystemPrompt({
    lead: { ...LEAD, estagio: "convertido" },
    modo: "pos_venda",
    confirmacaoPendente: true,
  });
  assert.equal(p.includes(MODO_CONFIRMACAO), false);
});

test("o modo venda sempre orienta suporte-antes-da-confirmação, com ou sem link enviado", () => {
  // A Task 4 trata isso como conteúdo permanente de "venda" (que por definição
  // é sempre pré-confirmação), não condicionado a link_enviado_em.
  for (const confirmacaoPendente of [false, true]) {
    const p = montarSystemPrompt({ lead: LEAD, modo: "venda", confirmacaoPendente });
    assert.match(p, /quatro tempos|Pedido de suporte ANTES/i);
    assert.match(p, /risco de comissão/i);
  }
});

test("mensagem sem conteúdo aproveitável é descartada", () => {
  const msgs = montarMensagens("SYS", [
    { remetente: "lead", tipo: "texto", conteudo: "  " },
    { remetente: "lead", tipo: "texto", conteudo: "oi" },
  ]);
  assert.equal(msgs.length, 2);
});
