import { test } from "node:test";
import assert from "node:assert/strict";
import { ehFalhaDoDestinatario } from "./erros.ts";

test("ehFalhaDoDestinatario reconhece o padrão documentado (500 + rejected this message)", () => {
  assert.equal(
    ehFalhaDoDestinatario(`UAZAPI 500: {"error":true,"message":"The WhatsApp server rejected this message"}`),
    true,
  );
});

test("ehFalhaDoDestinatario é case-insensitive na mensagem", () => {
  assert.equal(
    ehFalhaDoDestinatario(`UAZAPI 500: The whatsapp server REJECTED THIS MESSAGE`),
    true,
  );
});

test("ehFalhaDoDestinatario recusa 500 genérico sem a mensagem específica — instabilidade transitória do provedor não pode parar o envio", () => {
  assert.equal(ehFalhaDoDestinatario("UAZAPI 500: internal server error"), false);
});

test("ehFalhaDoDestinatario recusa outros status mesmo com texto parecido", () => {
  assert.equal(ehFalhaDoDestinatario("UAZAPI 429: rate limit, tente de novo"), false);
  assert.equal(ehFalhaDoDestinatario("UAZAPI 503: rejected this message (fila cheia)"), false);
});

test("ehFalhaDoDestinatario recusa erro de rede/timeout", () => {
  assert.equal(ehFalhaDoDestinatario("fetch failed"), false);
  assert.equal(ehFalhaDoDestinatario("The operation was aborted due to timeout"), false);
});

test("ehFalhaDoDestinatario recusa erro nulo/vazio", () => {
  assert.equal(ehFalhaDoDestinatario(null), false);
  assert.equal(ehFalhaDoDestinatario(undefined), false);
  assert.equal(ehFalhaDoDestinatario(""), false);
});
