import { test } from "node:test";
import assert from "node:assert/strict";
import { nomeEhPlaceholder, escolherNomeDoPerfil } from "./perfil.ts";

test("nomeEhPlaceholder: null é placeholder", () => {
  assert.equal(nomeEhPlaceholder(null, "5511987654321"), true);
});

test("nomeEhPlaceholder: string vazia ou só espaço é placeholder", () => {
  assert.equal(nomeEhPlaceholder("", "5511987654321"), true);
  assert.equal(nomeEhPlaceholder("   ", "5511987654321"), true);
});

test("nomeEhPlaceholder: começa com 'WhatsApp ' é placeholder", () => {
  assert.equal(nomeEhPlaceholder("WhatsApp 5511987654321", "5511987654321"), true);
});

test("nomeEhPlaceholder: igual ao telefone é placeholder", () => {
  assert.equal(nomeEhPlaceholder("5511987654321", "5511987654321"), true);
});

test("nomeEhPlaceholder: só dígitos (mesmo que não bata com o telefone) é placeholder", () => {
  assert.equal(nomeEhPlaceholder("61006359338", "5511987654321"), true);
});

test("nomeEhPlaceholder: nome de verdade não é placeholder — preserva edição manual", () => {
  assert.equal(nomeEhPlaceholder("Ana Paula", "5511987654321"), false);
});

test("escolherNomeDoPerfil: prioriza wa_contactName sobre name e wa_name", () => {
  const nome = escolherNomeDoPerfil({ name: "Pedro", wa_name: "Pedro Deyvson", wa_contactName: "Pedrinho" });
  assert.equal(nome, "Pedrinho");
});

test("escolherNomeDoPerfil: cai para name quando falta wa_contactName", () => {
  const nome = escolherNomeDoPerfil({ name: "Pedro", wa_name: "Pedro Deyvson" });
  assert.equal(nome, "Pedro");
});

test("escolherNomeDoPerfil: cai para wa_name quando só ele existe", () => {
  const nome = escolherNomeDoPerfil({ wa_name: "Pedro Deyvson" });
  assert.equal(nome, "Pedro Deyvson");
});

test("escolherNomeDoPerfil: perfil null ou todos os campos vazios devolve null", () => {
  assert.equal(escolherNomeDoPerfil(null), null);
  assert.equal(escolherNomeDoPerfil({ name: "", wa_name: "   " }), null);
});
