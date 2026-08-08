import { test } from "node:test";
import assert from "node:assert/strict";
import { ESTAGIOS, ehEstagio, ordemEstagio, camposDeTransicao } from "./estagios.ts";

const AGORA = "2026-08-08T12:00:00.000Z";

test("conhece exatamente os 8 estágios do check do banco", () => {
  assert.deepEqual(ESTAGIOS, [
    "novo", "qualificando", "apresentando_solucao", "contornando_objecao",
    "link_enviado", "acompanhamento", "convertido", "perdido",
  ]);
});

test("ehEstagio aceita válido e rejeita inventado", () => {
  assert.equal(ehEstagio("link_enviado"), true);
  assert.equal(ehEstagio("negociando"), false);
  assert.equal(ehEstagio(null), false);
  assert.equal(ehEstagio(3), false);
});

test("ordem cresce ao longo do funil e os terminais ficam por último", () => {
  assert.ok(ordemEstagio("novo") < ordemEstagio("qualificando"));
  assert.ok(ordemEstagio("link_enviado") < ordemEstagio("acompanhamento"));
  assert.ok(ordemEstagio("acompanhamento") < ordemEstagio("convertido"));
});

test("transição carimba estagio e estagio_alterado_em", () => {
  const campos = camposDeTransicao("novo", "qualificando", AGORA);
  assert.equal(campos.estagio, "qualificando");
  assert.equal(campos.estagio_alterado_em, AGORA);
});

test("entrar em link_enviado carimba link_enviado_em", () => {
  const campos = camposDeTransicao("apresentando_solucao", "link_enviado", AGORA);
  assert.equal(campos.link_enviado_em, AGORA);
});

test("acompanhamento não recarimba link_enviado_em", () => {
  // O lead já passou por link_enviado; a data original tem que sobreviver.
  const campos = camposDeTransicao("link_enviado", "acompanhamento", AGORA);
  assert.equal("link_enviado_em" in campos, false);
});

test("voltar de link_enviado limpa link_enviado_em", () => {
  // Se o funil retrocedeu, o dashboard não pode continuar contando o link.
  const campos = camposDeTransicao("link_enviado", "qualificando", AGORA);
  assert.equal(campos.link_enviado_em, null);
});

test("sair de perdido limpa motivo_perdido", () => {
  const campos = camposDeTransicao("perdido", "qualificando", AGORA);
  assert.equal(campos.motivo_perdido, null);
});

test("transição para o mesmo estágio não devolve nada", () => {
  assert.deepEqual(camposDeTransicao("novo", "novo", AGORA), {});
});
