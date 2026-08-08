import { test } from "node:test";
import assert from "node:assert/strict";
import { conversaEmbutida, rotuloDeEstagio, resumoDaLinha } from "./rotulos.ts";

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

// A forma que a API DE VERDADE devolve. Conferido contra o PostgREST do
// projeto em 08/08/2026: como conversas.lead_id é UNIQUE, o embed vem como
// OBJETO. O teste antigo só usava array, forma que a API nunca mandou — por
// isso ficou verde enquanto todo link do inbox saía desabilitado.
test("embed to-one do PostgREST (objeto) é a forma real e precisa ser lida", () => {
  assert.deepEqual(
    conversaEmbutida({ conversas: { id: "C1", pausada_pela_ia: true } }),
    { id: "C1", pausada_pela_ia: true },
  );
  assert.equal(resumoDaLinha({ conversas: { pausada_pela_ia: true } }).assumida, true);
  assert.equal(resumoDaLinha({ conversas: { pausada_pela_ia: false } }).assumida, false);
});

// Se alguém remover o índice único de conversas.lead_id, o PostgREST volta a
// mandar array. As duas formas têm que funcionar.
test("embed to-many (array) continua funcionando", () => {
  assert.deepEqual(conversaEmbutida({ conversas: [{ id: "C1" }] }), { id: "C1" });
  assert.equal(resumoDaLinha({ conversas: [{ pausada_pela_ia: true }] }).assumida, true);
  assert.equal(resumoDaLinha({ conversas: [{ pausada_pela_ia: false }] }).assumida, false);
});

test("lead sem conversa nenhuma não vira 'assumida' nem estoura", () => {
  assert.equal(conversaEmbutida({ conversas: [] }), null);
  assert.equal(conversaEmbutida({ conversas: null }), null);
  assert.equal(conversaEmbutida({}), null);
  assert.equal(conversaEmbutida(null), null);
  assert.equal(resumoDaLinha({ conversas: [] }).assumida, false);
  assert.equal(resumoDaLinha({ conversas: null }).assumida, false);
});
