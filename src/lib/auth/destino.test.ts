import { test } from "node:test";
import assert from "node:assert/strict";
import { destinoSeguro } from "./destino.ts";

test("destinoSeguro mantém caminho interno normal", () => {
  assert.equal(destinoSeguro("/inbox"), "/inbox");
});

test("destinoSeguro mantém caminho interno com busca", () => {
  assert.equal(destinoSeguro("/inbox/abc?leadId=1"), "/inbox/abc?leadId=1");
});

test("destinoSeguro rejeita URL protocol-relative (o ataque real)", () => {
  assert.equal(destinoSeguro("//evil.com"), "/inbox");
});

test("destinoSeguro rejeita variante com barra invertida", () => {
  assert.equal(destinoSeguro("/\\evil.com"), "/inbox");
});

test("destinoSeguro rejeita URL absoluta", () => {
  assert.equal(destinoSeguro("https://evil.com"), "/inbox");
});

test("destinoSeguro rejeita caminho sem barra inicial", () => {
  assert.equal(destinoSeguro("inbox"), "/inbox");
});

test("destinoSeguro rejeita valores que não são string", () => {
  assert.equal(destinoSeguro(undefined), "/inbox");
  assert.equal(destinoSeguro(123), "/inbox");
});

test("tab, CR e LF não driblam a checagem", () => {
  // A spec WHATWG REMOVE tab/CR/LF antes de parsear, então "/\t/evil.com"
  // vira https://evil.com/ no navegador — passando por qualquer guarda que
  // olhe só o prefixo literal. Chegam aqui como %09/%0A/%0D no ?destino=.
  assert.equal(destinoSeguro("/\t/evil.com"), "/inbox");
  assert.equal(destinoSeguro("/\n/evil.com"), "/inbox");
  assert.equal(destinoSeguro("/\r/evil.com"), "/inbox");
  assert.equal(destinoSeguro("/\r\n/evil.com"), "/inbox");
  assert.equal(destinoSeguro("/\t\t//evil.com"), "/inbox");
});
