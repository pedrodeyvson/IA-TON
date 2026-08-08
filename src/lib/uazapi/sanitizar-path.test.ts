import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizarSegmentoPath } from "./sanitizar-path.ts";

test("id normal passa inalterado", () => {
  assert.equal(sanitizarSegmentoPath("3EB0C767D26AA9F1E6D7"), "3EB0C767D26AA9F1E6D7");
});

test("id com ../ não sobrevive — sem . nem / no resultado", () => {
  const r = sanitizarSegmentoPath("../../etc/passwd");
  assert.equal(r.includes(".."), false);
  assert.equal(r.includes("/"), false);
  assert.equal(r, "______etc_passwd");
});

test("id com barra vira underscore", () => {
  assert.equal(sanitizarSegmentoPath("abc/def"), "abc_def");
});

test("id vazio cai no fallback", () => {
  assert.equal(sanitizarSegmentoPath(""), "sem-id");
});

test("id nulo cai no fallback", () => {
  assert.equal(sanitizarSegmentoPath(null), "sem-id");
});

test("id undefined cai no fallback", () => {
  assert.equal(sanitizarSegmentoPath(undefined), "sem-id");
});

test("id que sanitiza inteiramente para vazio (só caracteres especiais) cai no fallback", () => {
  assert.equal(sanitizarSegmentoPath("///..."), "sem-id");
});

test("fallback customizado é respeitado", () => {
  assert.equal(sanitizarSegmentoPath(null, "outro-fallback"), "outro-fallback");
});

test("é determinístico — mesma entrada sempre produz a mesma saída", () => {
  const a = sanitizarSegmentoPath("id com espaço e !@# símbolos");
  const b = sanitizarSegmentoPath("id com espaço e !@# símbolos");
  assert.equal(a, b);
});

test("trunca entradas muito longas para evitar path absurdo", () => {
  const longo = "a".repeat(500);
  const r = sanitizarSegmentoPath(longo);
  assert.equal(r.length, 128);
});
