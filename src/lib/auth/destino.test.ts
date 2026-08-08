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

test("dot-segment não reconstrói caminho protocol-relative na saída", () => {
  // "/.//evil.com" resolve com a origem CERTA (a base sentinela), mas a
  // remoção de dot-segments deixa o pathname "//evil.com" — que, relido por
  // qualquer navegação, vira https://evil.com. Validar só a entrada não
  // basta: a saída também precisa passar pelo mesmo teste.
  assert.equal(destinoSeguro("/.//evil.com"), "/inbox");
  assert.equal(destinoSeguro("/././/evil.com"), "/inbox");
  assert.equal(destinoSeguro("/x/..//evil.com"), "/inbox");
  assert.equal(destinoSeguro("/.///evil.com"), "/inbox");
  assert.equal(destinoSeguro("/a/../..//evil.com"), "/inbox");
  assert.equal(destinoSeguro("/\t.//evil.com"), "/inbox");
});

test("caminhos internos legítimos atravessam intactos", () => {
  // O outro lado do risco: normalização agressiva demais quebraria o retorno
  // pós-login, que é a razão de o ?destino= existir.
  assert.equal(destinoSeguro("/inbox/"), "/inbox/");
  assert.equal(destinoSeguro("/tarefas"), "/tarefas");
  assert.equal(destinoSeguro("/inbox/x#topo"), "/inbox/x#topo");
  assert.equal(destinoSeguro("/inbox/a/b?q=1&r=2"), "/inbox/a/b?q=1&r=2");
});
