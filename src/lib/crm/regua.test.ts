import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DIAS_DO_TOQUE,
  TOTAL_DE_TOQUES,
  DIAS_DE_PAUSA,
  MS_POR_DIA,
  planejarProximoToque,
  cicloEstaPausado,
} from "./regua.ts";

const LINK = Date.parse("2026-08-08T12:00:00.000Z");

test("a cadência é a oficial: 4 toques em 1, 2, 5 e 10 dias do link", () => {
  assert.deepEqual([...DIAS_DO_TOQUE], [1, 2, 5, 10]);
  assert.equal(TOTAL_DE_TOQUES, 4);
  assert.equal(DIAS_DE_PAUSA, 30);
});

test("do zero, o primeiro toque cai 24h depois do link", () => {
  const plano = planejarProximoToque(0, LINK, LINK);
  assert.deepEqual(plano, {
    tipo: "toque",
    toque: 1,
    quandoIso: new Date(LINK + 1 * MS_POR_DIA).toISOString(),
  });
});

test("cada toque seguinte usa o offset absoluto do link", () => {
  assert.equal(
    (planejarProximoToque(1, LINK, LINK + MS_POR_DIA) as any).quandoIso,
    new Date(LINK + 2 * MS_POR_DIA).toISOString(),
  );
  assert.equal(
    (planejarProximoToque(2, LINK, LINK + 2 * MS_POR_DIA) as any).quandoIso,
    new Date(LINK + 5 * MS_POR_DIA).toISOString(),
  );
  assert.equal(
    (planejarProximoToque(3, LINK, LINK + 5 * MS_POR_DIA) as any).quandoIso,
    new Date(LINK + 10 * MS_POR_DIA).toISOString(),
  );
});

test("depois do 4º toque vem pausa obrigatória de 30 dias, não um 5º", () => {
  const agora = LINK + 10 * MS_POR_DIA;
  const plano = planejarProximoToque(4, LINK, agora);
  assert.deepEqual(plano, {
    tipo: "pausa",
    ateIso: new Date(agora + DIAS_DE_PAUSA * MS_POR_DIA).toISOString(),
  });
});

test("toque fora da faixa também vira pausa, nunca um toque extra", () => {
  // Defesa contra dado sujo no banco: o que não é 0..3 não gera toque.
  assert.equal(planejarProximoToque(9, LINK, LINK).tipo, "pausa");
  assert.equal(planejarProximoToque(-1, LINK, LINK).tipo, "pausa");
});

test("worker atrasado não agenda toque no passado", () => {
  // O container ficou fora do ar uma semana; o toque 1 já venceu há dias.
  const agora = LINK + 7 * MS_POR_DIA;
  const plano = planejarProximoToque(0, LINK, agora) as any;
  assert.equal(plano.toque, 1);
  assert.equal(plano.quandoIso, new Date(agora).toISOString(), "agenda para agora, não para o passado");
});

test("link com data ilegível não trava a régua", () => {
  const agora = Date.parse("2026-09-01T00:00:00.000Z");
  const plano = planejarProximoToque(0, Number.NaN, agora) as any;
  assert.equal(plano.tipo, "toque");
  assert.equal(plano.quandoIso, new Date(agora + MS_POR_DIA).toISOString());
});

test("cicloEstaPausado só é verdade enquanto a pausa não venceu", () => {
  const agora = Date.parse("2026-09-01T00:00:00.000Z");
  assert.equal(cicloEstaPausado(null, agora), false);
  assert.equal(cicloEstaPausado("2026-09-10T00:00:00.000Z", agora), true);
  assert.equal(cicloEstaPausado("2026-08-31T23:59:59.000Z", agora), false);
  // Data ilegível: não pausa. Prender o lead para sempre é pior do que um toque.
  assert.equal(cicloEstaPausado("não é data", agora), false);
});
