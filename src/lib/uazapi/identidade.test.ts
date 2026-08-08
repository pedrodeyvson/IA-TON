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

test("resolverTelefoneReal ancora no LID quando não há telefone real", () => {
  const r = resolverTelefoneReal({}, { remoteJid: "264081359843075@lid" });
  assert.equal(r.telefone, "");
  assert.equal(r.jid, "264081359843075@lid");
});

test("resolverTelefoneReal devolve jid null quando não há nem telefone nem lid", () => {
  const r = resolverTelefoneReal({}, {});
  assert.equal(r.telefone, "");
  assert.equal(r.jid, null);
});

test("resolverTelefoneReal não estoura com payload circular", () => {
  const circular: any = { nivel: 1 };
  circular.self = circular;
  circular.telefone = "5511987654321@s.whatsapp.net";
  const r = resolverTelefoneReal(circular, {});
  assert.equal(r.telefone, "5511987654321");
});

// Bug real de produção (08/08/2026): Pedro respondeu um cliente direto pelo
// app do WhatsApp (fora do CRM/API). O echo do webhook chegou no formato
// achatado da UAZAPI SEM `key` — só `chatid` (o cliente, certo) e `sender_pn`
// (o número da própria Ton, porque fromMe:true). O código antigo checava
// sender_pn ANTES de chatid e ancorava um lead novo no número da empresa,
// duplicando a conversa. Payload abaixo é o `raw` real gravado no banco.

test("resolverTelefoneReal usa chatid (não sender_pn) numa mensagem fromMe do formato achatado", () => {
  const item = {
    fromMe: true,
    chatid: "558293667785@s.whatsapp.net",
    sender: "110772189446389@lid",
    sender_pn: "558486855652@s.whatsapp.net",
    sender_lid: "110772189446389@lid",
    owner: "558486855652",
  };
  const r = resolverTelefoneReal(item, {});
  assert.equal(r.telefone, "558293667785", "tem que ser o cliente, não o número da Ton");
});

test("resolverTelefoneReal ainda usa sender_pn quando a mensagem é do cliente (fromMe: false)", () => {
  const item = {
    fromMe: false,
    chatid: "264081359843075@lid",
    sender_pn: "5521999887766@s.whatsapp.net",
  };
  const r = resolverTelefoneReal(item, {});
  assert.equal(r.telefone, "5521999887766");
});

test("resolverTelefoneReal ancora em chatlid (não sender_lid) numa mensagem fromMe sem telefone real", () => {
  const item = {
    fromMe: true,
    chatid: "264081359843075@lid",
    chatlid: "264081359843075@lid",
    sender_lid: "999999999999999@lid",
  };
  const r = resolverTelefoneReal(item, {});
  assert.equal(r.telefone, "");
  assert.equal(r.jid, "264081359843075@lid", "tem que ancorar no lid da conversa, não no lid de quem enviou");
});

test("resolverTelefoneReal encontra telefone em profundidade alcançável", () => {
  // Telefone aninhado em profundidade 4 (dentro do PROFUNDIDADE_MAXIMA = 5)
  const profundo: any = {
    a: {
      b: {
        c: {
          d: {
            numero: "5511987654321@s.whatsapp.net"
          }
        }
      }
    }
  };
  const r = resolverTelefoneReal(profundo, {});
  assert.equal(r.telefone, "5511987654321");
});
