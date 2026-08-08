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

// ===================== Critério de entrada por estágio =====================
// Regressão do caso real de 08/08/2026: 4 leads em "qualificando" com uma
// única mensagem, que era o texto pronto do botão do anúncio.

import {
  ehSaudacaoDeAnuncio,
  estagioMaximoPermitido,
  limitarEstagio,
  type EvidenciaDoLead,
} from "./estagios.ts";

const SEM_NADA: EvidenciaDoLead = {
  respostasDoLead: 0, temInteresse: false, linkEnviado: false, compraConfirmada: false,
};

test("saudação pronta do botão do anúncio não conta como fala do lead", () => {
  assert.equal(ehSaudacaoDeAnuncio("Olá! QUERO ADQUIRIR UMA MÁQUINA DA TON."), true);
  assert.equal(ehSaudacaoDeAnuncio("  olá!  quero adquirir uma máquina da ton.  "), true);
  assert.equal(ehSaudacaoDeAnuncio("Olá! Posso ter mais informações sobre isso?"), true);
  // Sem acento, como às vezes chega.
  assert.equal(ehSaudacaoDeAnuncio("Ola! Quero adquirir uma maquina da Ton."), true);
});

test("mensagem escrita pelo lead NÃO é confundida com a saudação do anúncio", () => {
  assert.equal(ehSaudacaoDeAnuncio("quero adquirir uma máquina, qual o valor?"), false);
  assert.equal(ehSaudacaoDeAnuncio("oi"), false);
  assert.equal(ehSaudacaoDeAnuncio("Uso a maquininha da Cielo"), false);
  assert.equal(ehSaudacaoDeAnuncio(null), false);
  assert.equal(ehSaudacaoDeAnuncio(""), false);
});

test("lead que só clicou no anúncio continua NOVO, não qualificando", () => {
  // O caso exato dos 4 leads achados no banco.
  assert.equal(estagioMaximoPermitido(SEM_NADA), "novo");
  const r = limitarEstagio("qualificando", SEM_NADA);
  assert.equal(r.estagio, "novo");
  assert.equal(r.cortado, true);
  assert.match(r.motivo!, /respostas do lead: 0/);
});

test("uma resposta de verdade libera qualificando, mas não mais que isso", () => {
  const ev = { ...SEM_NADA, respostasDoLead: 1 };
  assert.equal(estagioMaximoPermitido(ev), "qualificando");
  assert.equal(limitarEstagio("qualificando", ev).cortado, false);
  // Recomendar modelo sem o lead ter dito o que precisa continua barrado.
  assert.equal(limitarEstagio("apresentando_solucao", ev).estagio, "qualificando");
});

test("apresentar solução exige interesse informado", () => {
  const ev = { ...SEM_NADA, respostasDoLead: 2, temInteresse: true };
  assert.equal(limitarEstagio("apresentando_solucao", ev).cortado, false);
  // Mas ainda não dá para pular para acompanhamento sem link.
  assert.equal(limitarEstagio("acompanhamento", ev).estagio, "apresentando_solucao");
});

test("acompanhamento exige link enviado; convertido exige compra confirmada", () => {
  const comLink = { ...SEM_NADA, respostasDoLead: 3, temInteresse: true, linkEnviado: true };
  assert.equal(limitarEstagio("acompanhamento", comLink).cortado, false);
  // "Quero essa" não é compra: sem confirmação, convertido é cortado.
  assert.equal(limitarEstagio("convertido", comLink).estagio, "acompanhamento");
  const comprou = { ...comLink, compraConfirmada: true };
  assert.equal(limitarEstagio("convertido", comprou).cortado, false);
});

test("recuar é sempre permitido — a trava é só de teto", () => {
  const ev = { ...SEM_NADA, respostasDoLead: 5, temInteresse: true, linkEnviado: true };
  assert.equal(limitarEstagio("qualificando", ev).cortado, false);
  assert.equal(limitarEstagio("novo", ev).cortado, false);
});

test("perdido e contornando_objecao não passam por evidência", () => {
  // São leitura de intenção; travar por contagem causaria mais erro que corrige.
  assert.equal(limitarEstagio("perdido", SEM_NADA).cortado, false);
  assert.equal(limitarEstagio("contornando_objecao", SEM_NADA).cortado, false);
});
