import { test } from "node:test";
import assert from "node:assert/strict";
import { classificarMensagem } from "./mensagem.ts";

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
