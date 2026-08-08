import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chamarOpenAI } from "./openai.server.ts";

const DIR = new URL("./fixtures/", import.meta.url);

async function fixture(nome: string) {
  return JSON.parse(await readFile(new URL(nome, DIR), "utf8"));
}

function fetchFalso(corpo: unknown, status = 200) {
  return async () =>
    new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });
}

test("extrai texto de resposta real sem tool call", async () => {
  process.env.OPENAI_API_KEY = "sk-teste";
  const r = await chamarOpenAI([{ role: "user", content: "oi" }], [], {
    fetchImpl: fetchFalso(await fixture("openai-texto.json")),
  });
  assert.equal(typeof r.texto, "string");
  assert.ok((r.texto ?? "").length > 0);
  assert.deepEqual(r.toolCalls, []);
});

test("extrai tool call de resposta real, com argumentos já parseados", async () => {
  process.env.OPENAI_API_KEY = "sk-teste";
  const r = await chamarOpenAI([{ role: "user", content: "quero falar com humano" }], [], {
    fetchImpl: fetchFalso(await fixture("openai-tool-call.json")),
  });
  assert.equal(r.toolCalls.length, 1);
  assert.equal(r.toolCalls[0].nome, "escalar_para_humano");
  // O importante: argumentos chegam como STRING JSON da API e saem como objeto.
  assert.equal(typeof r.toolCalls[0].argumentos, "object");
  assert.ok(r.toolCalls[0].id);
});

test("argumento com JSON inválido vira objeto vazio em vez de explodir", async () => {
  process.env.OPENAI_API_KEY = "sk-teste";
  const corpo = {
    choices: [{
      message: {
        content: null,
        tool_calls: [{ id: "call_1", type: "function", function: { name: "atualizar_lead", arguments: "{quebrado" } }],
      },
    }],
  };
  const r = await chamarOpenAI([], [], { fetchImpl: fetchFalso(corpo) });
  assert.deepEqual(r.toolCalls[0].argumentos, {});
});

test("erro HTTP lança com status e trecho do corpo", async () => {
  process.env.OPENAI_API_KEY = "sk-teste";
  await assert.rejects(
    () => chamarOpenAI([], [], { fetchImpl: fetchFalso({ error: { message: "rate limit" } }, 429) }),
    /429/,
  );
});

test("sem OPENAI_API_KEY lança antes de tentar a rede", async () => {
  const original = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  let bateu = false;
  await assert.rejects(
    () => chamarOpenAI([], [], { fetchImpl: async () => { bateu = true; return new Response("{}"); } }),
    /OPENAI_API_KEY/,
  );
  assert.equal(bateu, false);
  process.env.OPENAI_API_KEY = original;
});
