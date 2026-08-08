import { test } from "node:test";
import assert from "node:assert/strict";
import { deveAgendarResposta } from "./deve-agendar.ts";

const PADRAO = { direcao: "in" as const, pausada: false, precisaAtencao: false, agenteAtivo: true };

test("agenda para mensagem recebida do lead", () => {
  assert.equal(deveAgendarResposta(PADRAO), true);
});

test("não agenda para mensagem enviada (eco do próprio envio)", () => {
  assert.equal(deveAgendarResposta({ ...PADRAO, direcao: "out" }), false);
});

test("não agenda com a conversa assumida pelo humano", () => {
  assert.equal(deveAgendarResposta({ ...PADRAO, pausada: true }), false);
});

test("não agenda com o lead já escalado", () => {
  assert.equal(deveAgendarResposta({ ...PADRAO, precisaAtencao: true }), false);
});

test("não agenda com o agente desligado por env", () => {
  assert.equal(deveAgendarResposta({ ...PADRAO, agenteAtivo: false }), false);
});
