import { test } from "node:test";
import assert from "node:assert/strict";
import { ehLockOrfao, MS_LOCK_ORFAO } from "./selecao.ts";

const AGORA = Date.parse("2026-08-08T12:00:00.000Z");

test("sem lock não é órfão", () => {
  assert.equal(ehLockOrfao(null, AGORA), false);
});

test("lock recente não é órfão", () => {
  assert.equal(ehLockOrfao(new Date(AGORA - 10_000).toISOString(), AGORA), false);
});

test("lock mais velho que o limite é órfão", () => {
  // Container reiniciou no meio do turno e deixou a conversa travada.
  assert.equal(ehLockOrfao(new Date(AGORA - MS_LOCK_ORFAO - 1000).toISOString(), AGORA), true);
});

test("lock com data inválida é tratado como órfão", () => {
  // Melhor liberar do que deixar a conversa presa para sempre.
  assert.equal(ehLockOrfao("não é data", AGORA), true);
});
