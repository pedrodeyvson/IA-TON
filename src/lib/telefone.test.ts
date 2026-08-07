import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizarTelefoneBr, normalizarCandidato } from "./telefone.ts";

test("normalizarTelefoneBr remove o 9º dígito de celular com DDI", () => {
  assert.equal(normalizarTelefoneBr("5511987654321"), "551187654321");
});

test("normalizarTelefoneBr descarta máscara e mantém número sem 9", () => {
  assert.equal(normalizarTelefoneBr("+55 (11) 8765-4321"), "551187654321");
});

test("normalizarTelefoneBr devolve vazio para entrada nula ou sem dígito", () => {
  assert.equal(normalizarTelefoneBr(null), "");
  assert.equal(normalizarTelefoneBr("abc"), "");
});

test("normalizarTelefoneBr não mexe em número que já vem sem o 9", () => {
  assert.equal(normalizarTelefoneBr("551187654321"), "551187654321");
});

test("normalizarCandidato completa o DDI 55 quando vem só DDD + número", () => {
  assert.equal(normalizarCandidato("11987654321"), "5511987654321");
  assert.equal(normalizarCandidato("1187654321"), "551187654321");
});

test("normalizarCandidato aceita número que já tem DDI", () => {
  assert.equal(normalizarCandidato("5511987654321"), "5511987654321");
});

test("normalizarCandidato rejeita identificador longo (LID)", () => {
  assert.equal(normalizarCandidato("264081359843075"), "");
});
