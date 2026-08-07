import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseWebhookUazapi } from "./parse.ts";

function fixture(nome: string) {
  return JSON.parse(readFileSync(new URL(`./fixtures/${nome}.json`, import.meta.url), "utf8"));
}

test("normaliza mensagem ao vivo (message singular, sem campo event)", () => {
  const r = parseWebhookUazapi(fixture("mensagem-texto"));
  assert.equal(r.evento, "messages");
  assert.equal(r.instancia, "ton-consultor");
  assert.equal(r.itens.length, 1);
  assert.equal(r.itens[0].messageid, "3EB0C767D26A8B4F1A2B");
});

test("normaliza lote de histórico (messages plural)", () => {
  const r = parseWebhookUazapi({
    event: "messages",
    EventType: "history",
    instance: "ton-consultor",
    messages: [{ messageid: "a" }, { messageid: "b" }],
  });
  assert.equal(r.evento, "history");
  assert.equal(r.itens.length, 2);
});

test("reconhece evento de conexão sem itens", () => {
  const r = parseWebhookUazapi({ event: "connection", instance: "ton-consultor" });
  assert.equal(r.evento, "connection");
  assert.deepEqual(r.itens, []);
});

test("aceita body vazio sem lançar", () => {
  const r = parseWebhookUazapi({});
  assert.equal(r.instancia, "");
  assert.deepEqual(r.itens, []);
});

test("aceita instanceName ou instance", () => {
  assert.equal(parseWebhookUazapi({ instance: "x" }).instancia, "x");
  assert.equal(parseWebhookUazapi({ instanceName: "y" }).instancia, "y");
});
