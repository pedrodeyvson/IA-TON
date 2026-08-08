import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { classificarMensagem } from "./mensagem.ts";

function fixtureReal(nome: string): any {
  const caminho = fileURLToPath(new URL(`./fixtures/reais/${nome}`, import.meta.url));
  return JSON.parse(readFileSync(caminho, "utf8"));
}

test("classifica áudio de voz (PTT) no formato achatado real da UAZAPI", () => {
  // Payload real de produção (anonimizado) — Fatia 1 só tinha testado mídia
  // com dado inventado; este confirma o formato real, que não bate com o
  // envelope Baileys (`content.message.audioMessage`) usado pelos outros
  // tipos de mídia: aqui `content` já É o descritor de mídia direto.
  const item = fixtureReal("webhook-audio-ptt.json");
  const m = classificarMensagem(item);
  assert.equal(m.tipo, "audio");
  assert.equal(m.mediaMime, "audio/ogg; codecs=opus");
  assert.equal(m.providerMessageId, "3ACA7548F2BB73918E17");
  assert.equal(m.direcao, "in");
});

test("classifica imagem com legenda no formato achatado, sem deixar a legenda virar texto", () => {
  // Payload real (anonimizado): a UAZAPI expõe a legenda solta em item.text
  // ("essa aqui?"). Sem checar mídia achatada ANTES de texto, isso virava
  // mensagem de texto comum e a imagem inteira era perdida — bug real,
  // confirmado em produção na validação da Fatia 2.
  const item = fixtureReal("webhook-imagem-legenda.json");
  const m = classificarMensagem(item);
  assert.equal(m.tipo, "imagem");
  assert.equal(m.conteudo, "essa aqui?");
  assert.equal(m.mediaMime, "image/jpeg");
  assert.equal(m.providerMessageId, "3ACA7548F2BB73918E18");
});

test("classifica mensagem de texto simples", () => {
  const m = classificarMensagem({
    messageid: "abc",
    fromMe: false,
    messageTimestamp: 1754582400,
    content: { conversation: "Oi" },
  });
  assert.equal(m.tipo, "texto");
  assert.equal(m.conteudo, "Oi");
  assert.equal(m.direcao, "in");
  assert.equal(m.providerMessageId, "abc");
  assert.equal(m.timestampMs, 1754582400000);
});

test("marca direção out quando fromMe", () => {
  const m = classificarMensagem({ messageid: "a", fromMe: true, content: { conversation: "x" } });
  assert.equal(m.direcao, "out");
});

test("classifica áudio e guarda a legenda quando houver", () => {
  const m = classificarMensagem({
    messageid: "a",
    content: { audioMessage: { mimetype: "audio/ogg; codecs=opus" } },
  });
  assert.equal(m.tipo, "audio");
  assert.equal(m.mediaMime, "audio/ogg; codecs=opus");
});

test("classifica imagem com legenda", () => {
  const m = classificarMensagem({
    messageid: "a",
    content: { imageMessage: { mimetype: "image/jpeg", caption: "olha aqui" } },
  });
  assert.equal(m.tipo, "imagem");
  assert.equal(m.conteudo, "olha aqui");
});

test("extendedTextMessage também é texto", () => {
  const m = classificarMensagem({ messageid: "a", content: { extendedTextMessage: { text: "link" } } });
  assert.equal(m.tipo, "texto");
  assert.equal(m.conteudo, "link");
});

test("tipo desconhecido vira 'outro' sem quebrar", () => {
  const m = classificarMensagem({ messageid: "a", content: { pollCreationMessage: {} } });
  assert.equal(m.tipo, "outro");
});

test("timestamp ausente vira null e não NaN", () => {
  const m = classificarMensagem({ messageid: "a", content: { conversation: "x" } });
  assert.equal(m.timestampMs, null);
});
