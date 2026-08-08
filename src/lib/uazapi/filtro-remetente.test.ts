import { test } from "node:test";
import assert from "node:assert/strict";
import { deveIgnorarRemoteJid } from "./filtro-remetente.ts";

test("ignora grupo (@g.us)", () => {
  assert.equal(deveIgnorarRemoteJid("120363012345678901@g.us"), true);
});

test("ignora status (status@broadcast)", () => {
  assert.equal(deveIgnorarRemoteJid("status@broadcast"), true);
});

test("ignora broadcast list genérica (@broadcast)", () => {
  assert.equal(deveIgnorarRemoteJid("1234567890@broadcast"), true);
});

test("ignora canal de newsletter (@newsletter)", () => {
  assert.equal(deveIgnorarRemoteJid("120363012345678901@newsletter"), true);
});

test("não ignora conversa 1:1 normal", () => {
  assert.equal(deveIgnorarRemoteJid("5511987654321@s.whatsapp.net"), false);
});

test("não ignora @lid (contato privado 1:1, só sem telefone)", () => {
  assert.equal(deveIgnorarRemoteJid("264081359843075@lid"), false);
});

test("não ignora quando remoteJid ausente", () => {
  assert.equal(deveIgnorarRemoteJid(null), false);
  assert.equal(deveIgnorarRemoteJid(undefined), false);
  assert.equal(deveIgnorarRemoteJid(""), false);
});
