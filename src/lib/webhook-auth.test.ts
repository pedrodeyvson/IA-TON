import { test } from "node:test";
import assert from "node:assert/strict";
import { comparacaoSegura } from "./webhook-auth.ts";

test("compara strings iguais", () => {
  assert.equal(comparacaoSegura("abc123", "abc123"), true);
});

test("rejeita strings diferentes do mesmo tamanho", () => {
  assert.equal(comparacaoSegura("abc123", "abc124"), false);
});

test("rejeita tamanhos diferentes", () => {
  assert.equal(comparacaoSegura("abc", "abcd"), false);
});

test("rejeita string vazia", () => {
  assert.equal(comparacaoSegura("", ""), true);
  assert.equal(comparacaoSegura("", "x"), false);
});
