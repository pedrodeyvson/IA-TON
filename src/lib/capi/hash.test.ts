import { test } from "node:test";
import assert from "node:assert/strict";
import { sha256Hex, normalizarNome, construirUserDataHasheado, montarPayloadEvento } from "./hash.ts";

// Vetores conhecidos (sha256 hex de node:crypto, calculado fora do módulo sob
// teste — createHash("sha256").update(s).digest("hex")).
const SHA_PHONE_5511999999999 = "a869177964cc68954ffec997bbad30769f8a5a6fdc60f296ddbc60b9347dc416".slice(0, 64);
const SHA_JOAO = "ed2befb11499489e2570cb053f774b8ed93e89eddab3f78867a2a5f32c58845e".slice(0, 64);
const SHA_SILVA = "d24e913a4107af875dc2ac3d419798f3794d00434e5059fbb68ac8d33626eaee".slice(0, 64);
const SHA_LEAD_123 = "2f6f3ee1e84eb0de6948acc7ce87a493b4db833b878cd0c72e09bf701220ed63".slice(0, 64);

test("sha256Hex: vetor conhecido de telefone", async () => {
  assert.equal(await sha256Hex("5511999999999"), SHA_PHONE_5511999999999);
});

test("sha256Hex: vetor conhecido de external_id", async () => {
  assert.equal(await sha256Hex("lead-123"), SHA_LEAD_123);
});

test("sha256Hex: produz sempre 64 caracteres hex, mesmo para string vazia", async () => {
  const h = await sha256Hex("");
  assert.equal(h.length, 64);
  assert.match(h, /^[0-9a-f]{64}$/);
});

test("normalizarNome: minúsculo, sem acento, só letras/espaço", () => {
  assert.equal(normalizarNome("João Silva"), "joao silva");
  // Apóstrofo é removido (não é letra nem espaço); espaços internos extras
  // não são colapsados, só as pontas são cortadas (trim).
  assert.equal(normalizarNome("MARIA JOSÉ  D'ÁVILA"), "maria jose  davila");
  assert.equal(normalizarNome("  Ana   "), "ana");
});

test("construirUserDataHasheado: ctwa_clid vai em texto puro, nunca hasheado", async () => {
  const ud = await construirUserDataHasheado({ ctwa_clid: "AbCdEf123==" });
  assert.equal(ud.ctwa_clid, "AbCdEf123==");
  assert.equal(ud.ph, undefined);
});

test("construirUserDataHasheado: telefone é normalizado (só dígitos) e hasheado", async () => {
  const ud = await construirUserDataHasheado({ telefone: "+55 (11) 99999-9999" });
  assert.equal(ud.ph, SHA_PHONE_5511999999999);
});

test("construirUserDataHasheado: nome vira fn/ln hasheados a partir do nome normalizado", async () => {
  const ud = await construirUserDataHasheado({ nome: "João Silva" });
  assert.equal(ud.fn, SHA_JOAO);
  assert.equal(ud.ln, SHA_SILVA);
});

test("construirUserDataHasheado: nome só com um termo gera fn mas não ln", async () => {
  const ud = await construirUserDataHasheado({ nome: "Cher" });
  assert.equal(ud.fn, await sha256Hex("cher"));
  assert.equal(ud.ln, undefined);
});

test("construirUserDataHasheado: nome com sobrenome composto concatena sem espaço em ln", async () => {
  const ud = await construirUserDataHasheado({ nome: "Maria José D'Avila" });
  assert.equal(ud.ln, await sha256Hex("josedavila"));
});

test("construirUserDataHasheado: external_id (id do lead) é hasheado", async () => {
  const ud = await construirUserDataHasheado({ externalId: "lead-123" });
  assert.equal(ud.external_id, SHA_LEAD_123);
});

test("construirUserDataHasheado: campos ausentes/vazios não entram no objeto", async () => {
  const ud = await construirUserDataHasheado({ ctwa_clid: null, telefone: null, nome: null, externalId: null });
  assert.deepEqual(ud, {});
});

test("construirUserDataHasheado: monta todos os campos juntos", async () => {
  const ud = await construirUserDataHasheado({
    ctwa_clid: "clid-1",
    page_id: "374875799033778",
    telefone: "5511999999999",
    nome: "João Silva",
    externalId: "lead-123",
  });
  assert.deepEqual(ud, {
    ctwa_clid: "clid-1",
    page_id: "374875799033778",
    ph: SHA_PHONE_5511999999999,
    fn: SHA_JOAO,
    ln: SHA_SILVA,
    external_id: SHA_LEAD_123,
  });
});

test("construirUserDataHasheado: page_id vai em texto puro — hashear derruba o evento", async () => {
  // A Meta valida o page_id contra a Página real; hasheado ele é "inválido"
  // (subcode 2804070) e o evento é recusado igual a não mandar nada.
  const ud = await construirUserDataHasheado({ page_id: "374875799033778" });
  assert.deepEqual(ud, { page_id: "374875799033778" });
});

test("montarPayloadEvento: monta o formato exigido pela Meta (action_source/messaging_channel fixos)", () => {
  const payload = montarPayloadEvento({
    eventName: "LeadSubmitted",
    eventId: "evt-1",
    eventTime: 1_700_000_000,
    userData: { ctwa_clid: "clid-1" },
  });
  assert.deepEqual(payload, {
    data: [
      {
        event_name: "LeadSubmitted",
        event_time: 1_700_000_000,
        event_id: "evt-1",
        action_source: "business_messaging",
        messaging_channel: "whatsapp",
        user_data: { ctwa_clid: "clid-1" },
      },
    ],
  });
});

test("montarPayloadEvento: custom_data com value implica currency BRL por padrão", () => {
  const payload = montarPayloadEvento({
    eventName: "Purchase",
    eventId: "evt-2",
    eventTime: 1_700_000_000,
    userData: {},
    customData: { value: 500 },
  });
  assert.deepEqual(payload.data[0].custom_data, { value: 500, currency: "BRL" });
});

test("montarPayloadEvento: source_id vai em custom_data quando presente", () => {
  const payload = montarPayloadEvento({
    eventName: "LeadSubmitted",
    eventId: "evt-3",
    eventTime: 1_700_000_000,
    userData: {},
    customData: { source_id: "ad-123" },
  });
  assert.deepEqual(payload.data[0].custom_data, { source_id: "ad-123" });
});

test("montarPayloadEvento: sem custom_data e sem test_event_code, não inclui as chaves", () => {
  const payload = montarPayloadEvento({
    eventName: "LeadSubmitted",
    eventId: "evt-4",
    eventTime: 1_700_000_000,
    userData: {},
  });
  assert.equal(payload.data[0].custom_data, undefined);
  assert.equal(payload.test_event_code, undefined);
});

test("montarPayloadEvento: test_event_code entra só quando informado", () => {
  const payload = montarPayloadEvento({
    eventName: "LeadSubmitted",
    eventId: "evt-5",
    eventTime: 1_700_000_000,
    userData: {},
    testEventCode: "TEST12345",
  });
  assert.equal(payload.test_event_code, "TEST12345");
});
