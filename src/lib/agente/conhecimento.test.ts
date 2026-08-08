import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  CONHECIMENTO_VENDA,
  CONHECIMENTO_POS_VENDA,
  POS_VENDA,
  REGRAS_ESCALACAO,
  CANAL_OFICIAL_TON,
  ANGULO_DO_TOQUE,
  ANGULO_DO_RESGATE,
} from "./conhecimento.ts";

const RAIZ = new URL("../../../", import.meta.url);
const MANUAIS = [
  "produtos-e-taxas.md",
  "vendas-e-objecoes.md",
  "pos-venda-e-suporte.md",
  "gerador-de-mensagens.md",
];

/** Tira espaço e negrito para comparar "R$ 82,05" com "**R$82,05**". */
function normalizar(texto: string): string {
  return texto.replace(/\s+/g, "").replace(/\*/g, "");
}

async function textoDosManuais(): Promise<string> {
  const partes = await Promise.all(
    MANUAIS.map((nome) => readFile(new URL(`docs/conhecimento/${nome}`, RAIZ), "utf8")),
  );
  return normalizar(partes.join("\n"));
}

const TUDO = [CONHECIMENTO_VENDA, CONHECIMENTO_POS_VENDA].join("\n");

test("todo percentual do conhecimento existe nos manuais", async () => {
  const manuais = await textoDosManuais();
  const percentuais = TUDO.match(/\d+[.,]\d+\s*%/g) ?? [];
  assert.ok(percentuais.length > 20, "o conhecimento tem que trazer números de taxa");
  for (const bruto of new Set(percentuais)) {
    assert.ok(
      manuais.includes(normalizar(bruto)),
      `o percentual ${bruto} NÃO está em nenhum manual — o agente não pode falar isso`,
    );
  }
});

test("todo valor em reais do conhecimento existe nos manuais", async () => {
  const manuais = await textoDosManuais();
  const valores = TUDO.match(/R\$\s?\d[\d.]*(?:,\d{2})?/g) ?? [];
  assert.ok(valores.length > 10, "o conhecimento tem que trazer preço de adesão");
  for (const bruto of new Set(valores)) {
    assert.ok(
      manuais.includes(normalizar(bruto)),
      `o valor ${bruto} NÃO está em nenhum manual — o agente não pode falar isso`,
    );
  }
});

test("nas contradições vale a tabela oficial, e a perdedora não aparece", () => {
  // tabela_taxas_rex.pdf: TapTon débito Visa/Master 1 dia útil = 0,57%.
  assert.ok(TUDO.includes("0,57%"));
  assert.equal(TUDO.includes("0,79%"), false, "0,79% perdeu para 0,57%");
  // tabela-adesao-rex.pdf: T2 Ton Mega+ = R$49,88.
  assert.ok(TUDO.includes("R$49,88"));
  assert.equal(TUDO.includes("59,88"), false, "R$59,88 perdeu para R$49,88");
});

test("a comissão do parceiro nunca entra no conhecimento", () => {
  assert.equal(TUDO.includes("0,20%"), false);
  assert.doesNotMatch(TUDO, /comiss(ão|ao) (do|de) (parceiro|indica)/i);
  assert.doesNotMatch(TUDO, /Indique um Parceiro/i);
  // A REGRA de não falar comissão, essa sim, precisa existir.
  assert.match(REGRAS_ESCALACAO.toLowerCase(), /comiss/);
});

test("nenhuma URL de venda entra no prompt — o link só vem da tool", () => {
  assert.equal(TUDO.includes("ton.com.br/checkout"), false);
  assert.equal(TUDO.includes("ton.com.br/catalogo"), false);
  assert.equal(TUDO.includes("referrer"), false);
});

test("o pós-venda manda tentar resolver ANTES de encaminhar", () => {
  const p = POS_VENDA.toLowerCase();
  assert.match(p, /tente resolver/);
  assert.match(p, /confirme se resolveu/);
  assert.ok(POS_VENDA.includes(CANAL_OFICIAL_TON), "o canal oficial anda junto da escalação");
});

test("o canal oficial é o do dono, não um genérico", () => {
  assert.match(CANAL_OFICIAL_TON, /app da Ton/i);
  assert.match(CANAL_OFICIAL_TON, /https:\/\/ajuda\.ton\.com\.br\//);
});

test("as regras cobrem taxa fora da tabela e urgência inventada", () => {
  const r = REGRAS_ESCALACAO.toLowerCase();
  assert.match(r, /escalar_para_humano/);
  assert.match(r, /taxa/);
  assert.match(r, /urgência/);
});

test("os 4 ângulos da régua existem e são todos diferentes", () => {
  const angulos = [1, 2, 3, 4].map((n) => ANGULO_DO_TOQUE[n as 1 | 2 | 3 | 4]);
  assert.equal(new Set(angulos).size, 4, "repetir argumento é o que o material proíbe");
  for (const a of angulos) assert.ok(a.length > 30);
});

test("os 4 ângulos do resgate pré-link existem, são diferentes entre si e da régua oficial", () => {
  const angulosResgate = [1, 2, 3, 4].map((n) => ANGULO_DO_RESGATE[n as 1 | 2 | 3 | 4]);
  assert.equal(new Set(angulosResgate).size, 4, "repetir argumento é o pior padrão medido (27,8%)");
  for (const a of angulosResgate) assert.ok(a.length > 30);

  const angulosToque = [1, 2, 3, 4].map((n) => ANGULO_DO_TOQUE[n as 1 | 2 | 3 | 4]);
  for (const a of angulosResgate) assert.equal(angulosToque.includes(a), false);
});

test("o toque 1 do resgate pede pergunta FECHADA, nunca repete a pergunta aberta", () => {
  assert.match(ANGULO_DO_RESGATE[1].toLowerCase(), /fechada/);
  assert.match(ANGULO_DO_RESGATE[1].toLowerCase(), /não repita|nao repita/);
});

test("o D150 não é oferecido pelo nome (não consta no material)", () => {
  assert.equal(TUDO.includes("D150"), false);
});

test("a persona vale nos dois modos: é a Mika, e nunca se apresenta como a Ton", () => {
  for (const bloco of [CONHECIMENTO_VENDA, CONHECIMENTO_POS_VENDA]) {
    assert.match(bloco, /Mika/);
    assert.match(bloco, /NUNCA diga que é funcionária da Ton/);
  }
});

test("a persona nunca diz que fala em nome do Pedro nem se chama de assistente", () => {
  for (const bloco of [CONHECIMENTO_VENDA, CONHECIMENTO_POS_VENDA]) {
    assert.doesNotMatch(bloco, /assistente do Pedro/i);
    assert.doesNotMatch(bloco, /fala em nome do Pedro/i);
  }
});

test("o conhecimento cabe no orçamento de prompt", () => {
  // ~22 mil caracteres ≈ 6 mil tokens: sobra espaço para 30 mensagens de
  // histórico sem estourar contexto nem custo por turno.
  assert.ok(CONHECIMENTO_VENDA.length < 22_000, `venda tem ${CONHECIMENTO_VENDA.length} chars`);
  assert.ok(
    CONHECIMENTO_POS_VENDA.length < 22_000,
    `pós-venda tem ${CONHECIMENTO_POS_VENDA.length} chars`,
  );
});
