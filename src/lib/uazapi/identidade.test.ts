import { test } from "node:test";
import assert from "node:assert/strict";
import { ehLid, extrairTelefoneDeJid, resolverTelefoneReal } from "./identidade.ts";

test("ehLid detecta identificador de privacidade", () => {
  assert.equal(ehLid("264081359843075@lid"), true);
  assert.equal(ehLid("5511987654321@s.whatsapp.net"), false);
  assert.equal(ehLid(null), false);
});

test("extrairTelefoneDeJid pega o número antes do @", () => {
  assert.equal(extrairTelefoneDeJid("5511987654321@s.whatsapp.net"), "5511987654321");
  assert.equal(extrairTelefoneDeJid(""), "");
});

test("resolverTelefoneReal usa o remoteJid quando ele já é um telefone", () => {
  const r = resolverTelefoneReal({}, { remoteJid: "5511987654321@s.whatsapp.net" });
  assert.equal(r.telefone, "5511987654321");
  assert.equal(r.jid, "5511987654321@s.whatsapp.net");
});

test("resolverTelefoneReal ignora @lid e acha o telefone em senderPn", () => {
  const r = resolverTelefoneReal({}, {
    remoteJid: "264081359843075@lid",
    senderPn: "5521999887766@s.whatsapp.net",
  });
  assert.equal(r.telefone, "5521999887766");
});

test("resolverTelefoneReal encontra telefone aninhado no payload", () => {
  const r = resolverTelefoneReal(
    { chat: { participante: { id: "5531988776655@s.whatsapp.net" } } },
    { remoteJid: "264081359843075@lid" },
  );
  assert.equal(r.telefone, "5531988776655");
});

test("resolverTelefoneReal devolve vazio quando só há LID", () => {
  const r = resolverTelefoneReal({}, { remoteJid: "264081359843075@lid" });
  assert.equal(r.telefone, "");
  assert.equal(r.jid, null);
});

test("resolverTelefoneReal não estoura em payload circular ou profundo", () => {
  const profundo: any = { a: { b: { c: { d: { e: { f: { g: "5511987654321@s.whatsapp.net" } } } } } } };
  assert.doesNotThrow(() => resolverTelefoneReal(profundo, {}));
});
