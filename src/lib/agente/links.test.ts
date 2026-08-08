import { test } from "node:test";
import assert from "node:assert/strict";
import { PRODUTOS, ALVOS_DE_LINK, ehAlvoDeLink, montarLink } from "./links.ts";

const REF = "CEA4255F-0783-4EAD-AA55-48C682BA8FA7";

function comReferrer<T>(fn: () => T): T {
  const original = process.env.TON_REFERRER;
  process.env.TON_REFERRER = REF;
  try {
    return fn();
  } finally {
    if (original === undefined) delete process.env.TON_REFERRER;
    else process.env.TON_REFERRER = original;
  }
}

test("conhece exatamente os cinco productId do adendo, mais o catálogo", () => {
  assert.deepEqual(ALVOS_DE_LINK.slice().sort(), [
    "TONBLACK_TIER_SMART_POS",
    "TONMEGA_TIER_D150",
    "TONMEGA_TIER_D195",
    "TONMEGA_TIER_S920",
    "TONMEGA_TIER_SMART_POS",
    "catalogo",
  ]);
});

test("cada produto carrega o userTag do plano", () => {
  assert.equal(PRODUTOS.TONBLACK_TIER_SMART_POS.userTag, "tonblack_tier");
  for (const id of ["TONMEGA_TIER_SMART_POS", "TONMEGA_TIER_S920", "TONMEGA_TIER_D195", "TONMEGA_TIER_D150"] as const) {
    assert.equal(PRODUTOS[id].userTag, "tonmega_tier", `${id} tem que ser tonmega_tier`);
  }
});

test("o nome comercial vem do manual, não do código do hardware", () => {
  // S920 está no nível T3 e D195 no nível T2 em produtos-e-taxas.md.
  assert.match(PRODUTOS.TONMEGA_TIER_S920.nome ?? "", /T3/);
  assert.doesNotMatch(PRODUTOS.TONMEGA_TIER_S920.nome ?? "", /T2|T3 Smart/);
  assert.match(PRODUTOS.TONMEGA_TIER_D195.nome ?? "", /T2/);
  assert.match(PRODUTOS.TONMEGA_TIER_SMART_POS.nome ?? "", /T3 Smart/);
  assert.match(PRODUTOS.TONBLACK_TIER_SMART_POS.nome ?? "", /T3 Smart/);
  assert.match(PRODUTOS.TONBLACK_TIER_SMART_POS.nome ?? "", /Black/);
});

test("D150 não tem nome comercial: não consta em nenhum manual", () => {
  // Inventar "T1" ou "T2" aqui seria exatamente o erro que o adendo proíbe.
  assert.equal(PRODUTOS.TONMEGA_TIER_D150.nome, null);
});

test("checkout leva productId, referrer e userTag no formato do adendo", () => {
  const r = comReferrer(() => montarLink("TONMEGA_TIER_S920"));
  assert.equal(r.ok, true);
  const url = (r as { ok: true; url: string }).url;
  assert.equal(
    url,
    "https://ton.com.br/checkout/cart/?productId=TONMEGA_TIER_S920" +
      `&referrer=${REF}&userAnticipation=0&userTag=tonmega_tier` +
      "&utm_medium=invite_share&utm_source=revendedor",
  );
});

test("checkout do Black usa o userTag do Black", () => {
  const r = comReferrer(() => montarLink("TONBLACK_TIER_SMART_POS"));
  assert.match((r as any).url, /userTag=tonblack_tier/);
  assert.match((r as any).url, /productId=TONBLACK_TIER_SMART_POS/);
});

test("catálogo tem formato próprio: sem productId e sem userTag", () => {
  const r = comReferrer(() => montarLink("catalogo"));
  assert.equal(r.ok, true);
  const url = (r as { ok: true; url: string }).url;
  assert.equal(
    url,
    `https://ton.com.br/catalogo/?referrer=${REF}&userAnticipation=0` +
      "&utm_medium=invite_share&utm_source=revendedor",
  );
  assert.equal(url.includes("productId"), false);
  assert.equal(url.includes("userTag"), false);
});

test("todo link carrega o referrer do Pedro", () => {
  for (const alvo of ALVOS_DE_LINK) {
    const r = comReferrer(() => montarLink(alvo));
    assert.match((r as any).url, new RegExp(`referrer=${REF}`), `${alvo} sem referrer`);
  }
});

test("produto inválido não vira link", () => {
  const r = comReferrer(() => montarLink("TONMEGA_TIER_INVENTADO"));
  assert.deepEqual(r, { ok: false, erro: "produto_desconhecido" });
  assert.deepEqual(comReferrer(() => montarLink(undefined)), { ok: false, erro: "produto_desconhecido" });
});

test("sem TON_REFERRER não monta link quebrado", () => {
  const original = process.env.TON_REFERRER;
  delete process.env.TON_REFERRER;
  try {
    assert.deepEqual(montarLink("catalogo"), { ok: false, erro: "referrer_ausente" });
  } finally {
    if (original !== undefined) process.env.TON_REFERRER = original;
  }
});

test("referrer só com espaço conta como ausente", () => {
  const original = process.env.TON_REFERRER;
  process.env.TON_REFERRER = "   ";
  try {
    assert.deepEqual(montarLink("catalogo"), { ok: false, erro: "referrer_ausente" });
  } finally {
    if (original === undefined) delete process.env.TON_REFERRER;
    else process.env.TON_REFERRER = original;
  }
});

test("ehAlvoDeLink aceita válido e rejeita inventado", () => {
  assert.equal(ehAlvoDeLink("catalogo"), true);
  assert.equal(ehAlvoDeLink("TONMEGA_TIER_D150"), true);
  assert.equal(ehAlvoDeLink("T3"), false);
  assert.equal(ehAlvoDeLink(null), false);
});

test("ehAlvoDeLink rejeita nome comercial (o modelo escolhe productId, não modelo)", () => {
  assert.equal(ehAlvoDeLink("T3 Smart"), false);
});
