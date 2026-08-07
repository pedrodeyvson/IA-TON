import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extrairAtribuicaoAnuncio } from "./anuncio.ts";

function fixture(nome: string) {
  return JSON.parse(readFileSync(new URL(`./fixtures/${nome}.json`, import.meta.url), "utf8"));
}

test("devolve null quando a mensagem não veio de anúncio", () => {
  const conteudo = fixture("mensagem-texto").message.content;
  assert.equal(extrairAtribuicaoAnuncio(conteudo), null);
});

test("extrai os campos do externalAdReply", () => {
  const conteudo = fixture("mensagem-anuncio").message.content;
  const a = extrairAtribuicaoAnuncio(conteudo);
  assert.ok(a);
  assert.equal(a.adSourceId, "120226305854810726");
  assert.equal(a.adSourceUrl, "https://fb.me/3cr4Wqqkv");
  assert.equal(a.adTitle, "Maquininha Ton a partir de R$ 12x");
  assert.equal(a.adSourceApp, "facebook");
  assert.equal(a.adConversionSource, "FB_Ads");
});

test("captura ctwa_clid quando presente (grafia ctwaClid do proto)", () => {
  const a = extrairAtribuicaoAnuncio({
    contextInfo: { externalAdReply: { sourceID: "1", ctwaClid: "ARAkLkA8rmlFeiCkt" } },
  });
  assert.equal(a?.ctwaClid, "ARAkLkA8rmlFeiCkt");
});

test("ctwa_clid ausente vira null, não quebra", () => {
  const a = extrairAtribuicaoAnuncio({ contextInfo: { externalAdReply: { sourceID: "1" } } });
  assert.equal(a?.ctwaClid, null);
});

test("preserva o contextInfo inteiro em referralRaw", () => {
  const contextInfo = { externalAdReply: { sourceID: "1" }, campoNovoDesconhecido: "x" };
  const a = extrairAtribuicaoAnuncio({ contextInfo });
  assert.deepEqual(a?.referralRaw, contextInfo);
});

test("NÃO aceita a grafia minúscula sourceId (é sourceID no proto)", () => {
  const a = extrairAtribuicaoAnuncio({ contextInfo: { externalAdReply: { sourceId: "999" } } });
  assert.equal(a?.adSourceId, null);
});

test("tolera conteudo nulo ou sem contextInfo", () => {
  assert.equal(extrairAtribuicaoAnuncio(null), null);
  assert.equal(extrairAtribuicaoAnuncio({}), null);
  assert.equal(extrairAtribuicaoAnuncio({ contextInfo: {} }), null);
});
