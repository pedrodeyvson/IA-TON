import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MINUTOS_DO_TOQUE_RESGATE,
  TOTAL_DE_TOQUES_RESGATE,
  MS_POR_MINUTO,
  planejarProximoResgate,
} from "./resgate.ts";

const PRIMEIRA_MENSAGEM = Date.parse("2026-08-08T12:00:00.000Z");

test("a cadência de resgate é 1h, 3h, 6h e 12h da primeira mensagem do lead", () => {
  assert.deepEqual([...MINUTOS_DO_TOQUE_RESGATE], [60, 180, 360, 720]);
  assert.equal(TOTAL_DE_TOQUES_RESGATE, 4);
});

test("do zero, o primeiro toque cai 1h depois da primeira mensagem do lead", () => {
  const plano = planejarProximoResgate(0, PRIMEIRA_MENSAGEM, PRIMEIRA_MENSAGEM);
  assert.deepEqual(plano, {
    tipo: "toque",
    toque: 1,
    quandoIso: new Date(PRIMEIRA_MENSAGEM + 60 * MS_POR_MINUTO).toISOString(),
  });
});

test("cada toque seguinte usa o offset absoluto da primeira mensagem, não do último toque", () => {
  assert.equal(
    (planejarProximoResgate(1, PRIMEIRA_MENSAGEM, PRIMEIRA_MENSAGEM + 60 * MS_POR_MINUTO) as any).quandoIso,
    new Date(PRIMEIRA_MENSAGEM + 180 * MS_POR_MINUTO).toISOString(),
  );
  assert.equal(
    (planejarProximoResgate(2, PRIMEIRA_MENSAGEM, PRIMEIRA_MENSAGEM + 180 * MS_POR_MINUTO) as any).quandoIso,
    new Date(PRIMEIRA_MENSAGEM + 360 * MS_POR_MINUTO).toISOString(),
  );
  assert.equal(
    (planejarProximoResgate(3, PRIMEIRA_MENSAGEM, PRIMEIRA_MENSAGEM + 360 * MS_POR_MINUTO) as any).quandoIso,
    new Date(PRIMEIRA_MENSAGEM + 720 * MS_POR_MINUTO).toISOString(),
  );
});

test("4º toque sem resposta encerra o resgate, SEM pausa de 30 dias (decisão §9, diferente da régua oficial)", () => {
  const agora = PRIMEIRA_MENSAGEM + 720 * MS_POR_MINUTO;
  const plano = planejarProximoResgate(4, PRIMEIRA_MENSAGEM, agora);
  assert.deepEqual(plano, { tipo: "encerrado" });
});

test("toque fora da faixa também encerra, nunca gera um 5º toque", () => {
  // Defesa contra dado sujo no banco: o que não é 0..3 não gera toque.
  assert.deepEqual(planejarProximoResgate(9, PRIMEIRA_MENSAGEM, PRIMEIRA_MENSAGEM), { tipo: "encerrado" });
  assert.deepEqual(planejarProximoResgate(-1, PRIMEIRA_MENSAGEM, PRIMEIRA_MENSAGEM), { tipo: "encerrado" });
});

test("worker atrasado não agenda toque de resgate no passado", () => {
  // O container ficou fora do ar; o toque 1 (1h) já venceu há dias.
  const agora = PRIMEIRA_MENSAGEM + 3 * 24 * 60 * MS_POR_MINUTO;
  const plano = planejarProximoResgate(0, PRIMEIRA_MENSAGEM, agora) as any;
  assert.equal(plano.toque, 1);
  assert.equal(plano.quandoIso, new Date(agora).toISOString(), "agenda para agora, não para o passado");
});

test("primeira mensagem com data ilegível não trava o resgate", () => {
  const agora = Date.parse("2026-09-01T00:00:00.000Z");
  const plano = planejarProximoResgate(0, Number.NaN, agora) as any;
  assert.equal(plano.tipo, "toque");
  assert.equal(plano.quandoIso, new Date(agora + 60 * MS_POR_MINUTO).toISOString());
});
