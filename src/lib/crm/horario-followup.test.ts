import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FUSO_FOLLOWUP,
  HORA_INICIO_JANELA,
  HORA_FIM_JANELA,
  estaNaJanelaDeSilencio,
  proximaAberturaSeSilencio,
} from "./horario-followup.ts";
import { planejarProximoResgate } from "./resgate.ts";

test("constantes da janela batem com a decisão do dono: silêncio 21h-08h em São Paulo", () => {
  assert.equal(FUSO_FOLLOWUP, "America/Sao_Paulo");
  assert.equal(HORA_INICIO_JANELA, 8);
  assert.equal(HORA_FIM_JANELA, 21);
});

test("estaNaJanelaDeSilencio usa o fuso de São Paulo, não o do processo (regressão do bug de rotulos.ts)", () => {
  // 2026-08-09T11:00:00Z = 08:00 em SP -> abertura, não é mais silêncio.
  assert.equal(estaNaJanelaDeSilencio(Date.parse("2026-08-09T11:00:00.000Z")), false);
  // 2026-08-09T10:59:00Z = 07:59 em SP -> ainda silêncio.
  assert.equal(estaNaJanelaDeSilencio(Date.parse("2026-08-09T10:59:00.000Z")), true);
  // 2026-08-08T23:59:00Z = 20:59 em SP -> ainda dentro da janela permitida.
  assert.equal(estaNaJanelaDeSilencio(Date.parse("2026-08-08T23:59:00.000Z")), false);
  // 2026-08-09T00:00:00Z = 21:00 em SP -> silêncio começou.
  assert.equal(estaNaJanelaDeSilencio(Date.parse("2026-08-09T00:00:00.000Z")), true);
});

test("proximaAberturaSeSilencio não mexe em instante já dentro da janela permitida", () => {
  const ms = Date.parse("2026-08-08T23:00:00.000Z"); // 20:00 em SP
  assert.equal(proximaAberturaSeSilencio(ms), ms);
});

test("proximaAberturaSeSilencio desloca madrugada (0h-08h SP) para as 8h do MESMO dia civil de SP", () => {
  const madrugada = Date.parse("2026-08-09T04:00:00.000Z"); // 01:00 em SP
  assert.equal(
    new Date(proximaAberturaSeSilencio(madrugada)).toISOString(),
    "2026-08-09T11:00:00.000Z", // 08:00 SP do mesmo dia civil (09/08)
  );
});

test("proximaAberturaSeSilencio desloca noite (>=21h SP) para as 8h do dia civil SEGUINTE", () => {
  const noite = Date.parse("2026-08-09T01:00:00.000Z"); // 22:00 em SP, ainda dia 08/08
  assert.equal(
    new Date(proximaAberturaSeSilencio(noite)).toISOString(),
    "2026-08-09T11:00:00.000Z", // 08:00 SP do dia seguinte (09/08)
  );
});

// Regressão do caso real que fundamenta a spec §4: sem a janela de silêncio,
// "um lead que escreve às 22h receberia mensagem automática às 01h e 04h" —
// caminho mais rápido para denúncia e banimento do número. Os 3 primeiros
// toques da cadência de resgate (Task 2, src/lib/crm/resgate.ts) são
// exercitados aqui compostos com a janela, porque é essa composição que a
// spec pede.
test("caso real (spec §4): lead escreve 22h em SP — a cadência de resgate respeita o silêncio sem perder toque", () => {
  const PRIMEIRA_MENSAGEM = Date.parse("2026-08-08T22:00:00.000Z"); // 19:00 em SP

  // Toque de 1h cai em 20:00 SP (23:00Z) — ainda dentro da janela permitida
  // (8h-21h), não desloca.
  const toque1 = planejarProximoResgate(0, PRIMEIRA_MENSAGEM, PRIMEIRA_MENSAGEM) as any;
  assert.equal(toque1.quandoIso, "2026-08-08T23:00:00.000Z");
  const toque1Ms = Date.parse(toque1.quandoIso);
  assert.equal(proximaAberturaSeSilencio(toque1Ms), toque1Ms, "20:00 SP não é silêncio, não desloca");

  // Toque de 3h cairia em 22:00 SP do dia 08 (2026-08-09T01:00:00Z) — dentro
  // do silêncio (>=21h), desloca para as 8h de SP do dia seguinte.
  const toque2 = planejarProximoResgate(1, PRIMEIRA_MENSAGEM, toque1Ms) as any;
  assert.equal(toque2.quandoIso, "2026-08-09T01:00:00.000Z");
  const toque2Deslocado = proximaAberturaSeSilencio(Date.parse(toque2.quandoIso));
  assert.equal(new Date(toque2Deslocado).toISOString(), "2026-08-09T11:00:00.000Z"); // 08:00 SP

  // Toque de 6h: quando o worker for planejar o próximo (toque 2 já saiu às
  // 08:00 SP; o worker roda de novo 15min depois), o alvo bruto do toque de
  // 6h (01:00 SP do dia seguinte) já ficou no passado — planejarProximoResgate
  // já clampa para "agora" (08:15 SP), então cai direto dentro da janela
  // permitida, SEM precisar deslocar duas vezes.
  const agoraDepoisDoToque2 = toque2Deslocado + 15 * 60_000; // 2026-08-09T11:15:00.000Z = 08:15 SP
  const toque3 = planejarProximoResgate(2, PRIMEIRA_MENSAGEM, agoraDepoisDoToque2) as any;
  assert.equal(toque3.quandoIso, "2026-08-09T11:15:00.000Z");
  const toque3Ms = Date.parse(toque3.quandoIso);
  assert.equal(proximaAberturaSeSilencio(toque3Ms), toque3Ms, "08:15 SP já está aberto, não precisa deslocar de novo");
});
