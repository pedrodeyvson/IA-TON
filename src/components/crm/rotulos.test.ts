import { test } from "node:test";
import assert from "node:assert/strict";
import { rotuloDeEstagio, resumoDaLinha } from "./rotulos.ts";

test("cada estágio tem rótulo legível em português", () => {
  assert.equal(rotuloDeEstagio("apresentando_solucao"), "Apresentando solução");
  assert.equal(rotuloDeEstagio("link_enviado"), "Link enviado");
  assert.equal(rotuloDeEstagio("convertido"), "Convertido");
});

test("estágio desconhecido não quebra a tela", () => {
  assert.equal(rotuloDeEstagio("inventado"), "inventado");
});

test("lead sem nome aparece pelo telefone", () => {
  const { titulo } = resumoDaLinha({ nome: null, telefone: "5511999999999" });
  assert.equal(titulo, "5511999999999");

  // Nome só com espaço não pode "ganhar" do telefone: o .trim() existe para isso.
  const espacoEmBranco = resumoDaLinha({ nome: "   ", telefone: "5511999999999" });
  assert.equal(espacoEmBranco.titulo, "5511999999999");
});

test("lead sem nome e sem telefone ainda tem título", () => {
  // Lead que chegou só com @lid: a linha não pode ficar em branco.
  const { titulo } = resumoDaLinha({ nome: null, telefone: null });
  assert.equal(titulo, "Sem identificação");
});

test("conversa pausada pela IA é a que o Pedro assumiu", () => {
  assert.equal(resumoDaLinha({ conversas: [{ pausada_pela_ia: true }] }).assumida, true);
  assert.equal(resumoDaLinha({ conversas: [{ pausada_pela_ia: false }] }).assumida, false);
  assert.equal(resumoDaLinha({ conversas: [] }).assumida, false);
});
