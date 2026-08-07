// Testes de regressão contra fixtures REAIS capturados de produção (UAZAPI,
// projeto CPI, rodando há semanas) — não escritos à mão. Ver
// `fixtures/reais/README` (histórico no relatório de validação em
// .superpowers/sdd/2026-08-07-fatia-1-fundacao-webhook/).
//
// Cada fixture aqui já foi anonimizado (telefones/nomes reais trocados por
// valores fictícios consistentes) preservando a FORMA exata do payload — é a
// forma, não o conteúdo pessoal, que importa para o parser.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseWebhookUazapi } from "./parse.ts";
import { classificarMensagem } from "./mensagem.ts";
import { resolverTelefoneReal } from "./identidade.ts";
import { extrairAtribuicaoAnuncio } from "./anuncio.ts";

function fixture(nome: string) {
  return JSON.parse(readFileSync(new URL(`./fixtures/reais/${nome}.json`, import.meta.url), "utf8"));
}

test("webhook-connection: evento de conexão não tem itens de mensagem", () => {
  const evento = parseWebhookUazapi(fixture("webhook-connection"));
  assert.equal(evento.evento, "connection");
  assert.equal(evento.instancia, "cpi-principal");
});

test("webhook-live-message: mensagem ao vivo com content=string plana e sender @lid", () => {
  const evento = parseWebhookUazapi(fixture("webhook-live-message"));
  assert.equal(evento.evento, "messages");
  assert.equal(evento.instancia, "teste-11549764");
  assert.equal(evento.itens.length, 1);

  const item = evento.itens[0];
  const msg = classificarMensagem(item);
  assert.equal(msg.tipo, "texto");
  assert.equal(msg.conteudo, "Oi");
  assert.equal(msg.providerMessageId, "2A5942F384A524236495");
  // messageTimestamp já vem em ms (13 dígitos) neste payload — não pode ser
  // multiplicado por 1000 de novo.
  assert.equal(msg.timestampMs, 1783707327000);

  // sender é @lid; o telefone real só existe em sender_pn (snake_case).
  const tel = resolverTelefoneReal(item, item?.key ?? {});
  assert.equal(tel.telefone, "551199990002");
  assert.equal(tel.jid, "551199990002@s.whatsapp.net");

  assert.equal(extrairAtribuicaoAnuncio(item?.content), null);
});

test("webhook-messages-ctwa: mensagem de anúncio com ctwaClid e sourceId/sourceUrl minúsculos", () => {
  const evento = parseWebhookUazapi(fixture("webhook-messages-ctwa"));
  assert.equal(evento.evento, "messages");
  assert.equal(evento.itens.length, 1);

  const item = evento.itens[0];
  const msg = classificarMensagem(item);
  assert.equal(msg.tipo, "texto");
  assert.equal(msg.conteudo, "Vim pelo anúncio");
  assert.equal(msg.providerMessageId, "3EB0CTWA99");

  const tel = resolverTelefoneReal(item, item?.key ?? {});
  assert.equal(tel.telefone, "5511911112222");

  const atribuicao = extrairAtribuicaoAnuncio(item?.content);
  assert.ok(atribuicao);
  assert.equal(atribuicao.adSourceId, "120200000000000000");
  assert.equal(atribuicao.adSourceUrl, "https://fb.me/xyz");
  assert.equal(atribuicao.adTitle, "Promoção CPI");
  assert.equal(atribuicao.ctwaClid, "AfeXAMPLE_ctwa_clid_1234567890abcdef");
});

test("webhook-messages-inbound: mensagem de texto simples sem anúncio", () => {
  const evento = parseWebhookUazapi(fixture("webhook-messages-inbound"));
  const item = evento.itens[0];
  const msg = classificarMensagem(item);
  assert.equal(msg.tipo, "texto");
  assert.equal(msg.conteudo, "Oi, tudo bem?");

  const tel = resolverTelefoneReal(item, item?.key ?? {});
  assert.equal(tel.telefone, "5511987654321");

  assert.equal(extrairAtribuicaoAnuncio(item?.content), null);
});

test("webhook-messages-sourceid-sem-ctwa: incidente real — sourceId presente, ctwaClid ausente", () => {
  const evento = parseWebhookUazapi(fixture("webhook-messages-sourceid-sem-ctwa"));
  const item = evento.itens[0];
  const msg = classificarMensagem(item);
  assert.equal(msg.tipo, "texto");
  assert.equal(msg.conteudo, "Olá! Quero informações sobre se tenho direito ao auxílio.");

  const tel = resolverTelefoneReal(item, item?.key ?? {});
  assert.equal(tel.telefone, "5511977776666");

  // Este é exatamente o incidente de produção que motivou o achado do CPI:
  // a mensagem tem sourceId (atribuição de anúncio) mas SEM ctwaClid. Um
  // parser que só olhasse ctwaClid perderia a atribuição inteira.
  const atribuicao = extrairAtribuicaoAnuncio(item?.content);
  assert.ok(atribuicao);
  assert.equal(atribuicao.adSourceId, "120254805677690311");
  assert.equal(atribuicao.adSourceUrl, "https://fb.me/abc");
  assert.equal(atribuicao.ctwaClid, null);
});

test("webhook-real-messages: lote de histórico com content=string plana e timestamp já em ms", () => {
  const evento = parseWebhookUazapi(fixture("webhook-real-messages"));
  assert.equal(evento.evento, "history");
  assert.equal(evento.instancia, "teste-11549764");
  assert.equal(evento.itens.length, 1);

  const item = evento.itens[0];
  const msg = classificarMensagem(item);
  assert.equal(msg.tipo, "texto");
  assert.equal(msg.conteudo, "Obrigadaaa");
  assert.equal(msg.providerMessageId, "2A330494828B9C34C70D");
  assert.equal(msg.timestampMs, 1777816654000);

  const tel = resolverTelefoneReal(item, item?.key ?? {});
  assert.equal(tel.telefone, "551199990001");
});
