import { test } from "node:test";
import assert from "node:assert/strict";
import { conversaEmbutida, rotuloDeEstagio, rotuloDeHorario, resumoDaLinha } from "./rotulos.ts";

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

// Fuso fixo em America/Sao_Paulo: sem isso o SSR (UTC) e o navegador (-03)
// renderizariam textos diferentes na mesma linha.
const AGORA = new Date("2026-08-08T18:00:00Z"); // 15:00 em São Paulo

test("mensagem de hoje mostra só a hora, no fuso de São Paulo", () => {
  // 14:33 UTC = 11:33 em São Paulo. Se o fuso vazasse, sairia "14:33".
  assert.equal(rotuloDeHorario("2026-08-08T14:33:45Z", AGORA), "11:33");
});

test("a virada do dia é a de São Paulo, não a do UTC", () => {
  // 02:00 UTC do dia 9 ainda é 23:00 do dia 8 em São Paulo — é "hoje".
  assert.equal(rotuloDeHorario("2026-08-09T02:00:00Z", AGORA), "23:00");
  // 03:30 UTC do dia 8 é 00:30 do dia 8 em São Paulo — também "hoje".
  assert.equal(rotuloDeHorario("2026-08-08T03:30:00Z", AGORA), "00:30");
});

test("véspera vira 'ontem' e o resto vira data", () => {
  assert.equal(rotuloDeHorario("2026-08-07T14:00:00Z", AGORA), "ontem");
  assert.equal(rotuloDeHorario("2026-08-05T14:00:00Z", AGORA), "05/08");
});

test("ano diferente aparece, para não confundir com o mês corrente", () => {
  assert.equal(rotuloDeHorario("2025-12-30T14:00:00Z", AGORA), "30/12/25");
});

test("horário ausente ou inválido não quebra a linha", () => {
  assert.equal(rotuloDeHorario(null), "");
  assert.equal(rotuloDeHorario(undefined), "");
  assert.equal(rotuloDeHorario(""), "");
  assert.equal(rotuloDeHorario("nao é data", AGORA), "");
});
