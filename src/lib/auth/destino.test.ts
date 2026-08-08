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
