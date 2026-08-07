import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EVENTOS_CAPI_VALIDOS,
  ESTAGIO_EVENTO_MAP,
  ORDEM_FUNIL,
  resolverEventoEstagio,
  resolverCascataEventos,
  eventosParaDisparar,
  jaFoiEnviado,
} from "./capi.constants.ts";

/** Catálogo fechado de business_messaging confirmado lendo o CPI
 *  (meta-capi.constants.ts): `Lead`, `Contact`, `Schedule`,
 *  `CompleteRegistration` e `SubmitApplication` são recusados pela Meta
 *  nesse modo — só nomes específicos (custom, como LeadSubmitted) ou os
 *  padrão abaixo valem. */
const EVENTOS_BUSINESS_MESSAGING_VALIDOS = [
  "Purchase", "LeadSubmitted", "InitiateCheckout", "AddToCart", "ViewContent",
  "OrderCreated", "OrderShipped", "OrderDelivered", "OrderCanceled", "OrderReturned",
  "CartAbandoned", "QualifiedLead", "RatingProvided", "ReviewProvided",
];

test("ORDEM_FUNIL é a ordem esperada dos 7 estágios que participam do funil (perdido fica de fora)", () => {
  assert.deepEqual(ORDEM_FUNIL, [
    "novo", "qualificando", "apresentando_solucao", "contornando_objecao",
    "link_enviado", "acompanhamento", "convertido",
  ]);
});

test("ESTAGIO_EVENTO_MAP mapeia só 4 estágios para evento, igual à constraint de eventos_capi", () => {
  assert.equal(ESTAGIO_EVENTO_MAP["novo"], "LeadSubmitted");
  assert.equal(ESTAGIO_EVENTO_MAP["qualificando"], "QualifiedLead");
  assert.equal(ESTAGIO_EVENTO_MAP["apresentando_solucao"], null);
  assert.equal(ESTAGIO_EVENTO_MAP["contornando_objecao"], null);
  assert.equal(ESTAGIO_EVENTO_MAP["link_enviado"], "InitiateCheckout");
  assert.equal(ESTAGIO_EVENTO_MAP["acompanhamento"], null);
  assert.equal(ESTAGIO_EVENTO_MAP["convertido"], "Purchase");
  assert.equal(ESTAGIO_EVENTO_MAP["perdido"], null);
});

test("EVENTOS_CAPI_VALIDOS bate exatamente com a constraint check de eventos_capi.nome_evento", () => {
  assert.deepEqual([...EVENTOS_CAPI_VALIDOS], ["LeadSubmitted", "QualifiedLead", "InitiateCheckout", "Purchase"]);
});

test("todo evento do mapeamento é aceito em business_messaging", () => {
  for (const [estagio, evento] of Object.entries(ESTAGIO_EVENTO_MAP)) {
    if (evento == null) continue;
    assert.ok(EVENTOS_BUSINESS_MESSAGING_VALIDOS.includes(evento), `${estagio} -> ${evento} inválido em business_messaging`);
  }
});

test("resolverEventoEstagio: estágio fora do funil ou desconhecido não tem evento", () => {
  assert.equal(resolverEventoEstagio("perdido"), null);
  assert.equal(resolverEventoEstagio("apresentando_solucao"), null);
  assert.equal(resolverEventoEstagio("xpto"), null);
});

test("resolverEventoEstagio: estágios mapeados resolvem o evento certo", () => {
  assert.equal(resolverEventoEstagio("novo"), "LeadSubmitted");
  assert.equal(resolverEventoEstagio("convertido"), "Purchase");
});

test("resolverCascataEventos: novo->link_enviado inclui LeadSubmitted, QualifiedLead e InitiateCheckout", () => {
  assert.deepEqual(resolverCascataEventos("link_enviado"), [
    { estagio: "novo", evento: "LeadSubmitted" },
    { estagio: "qualificando", evento: "QualifiedLead" },
    { estagio: "link_enviado", evento: "InitiateCheckout" },
  ]);
});

test("resolverCascataEventos: cascata completa novo->convertido dispara os 4 eventos em ordem", () => {
  assert.deepEqual(resolverCascataEventos("convertido").map((x) => x.evento), [
    "LeadSubmitted", "QualifiedLead", "InitiateCheckout", "Purchase",
  ]);
});

test("resolverCascataEventos: destino fora do funil (perdido/desconhecido) => []", () => {
  assert.deepEqual(resolverCascataEventos("perdido"), []);
  assert.deepEqual(resolverCascataEventos("xpto"), []);
});

test("eventosParaDisparar: pula evento já enviado por nome (LeadSubmitted do ingest)", () => {
  const r = eventosParaDisparar("link_enviado", ["LeadSubmitted"]);
  assert.deepEqual(r, [
    { estagio: "qualificando", evento: "QualifiedLead" },
    { estagio: "link_enviado", evento: "InitiateCheckout" },
  ]);
});

test("eventosParaDisparar: lead que pula direto para convertido dispara a cascata inteira", () => {
  const r = eventosParaDisparar("convertido", []);
  assert.deepEqual(r.map((x) => x.evento), ["LeadSubmitted", "QualifiedLead", "InitiateCheckout", "Purchase"]);
});

test("eventosParaDisparar: nada a disparar quando a cascata inteira já saiu", () => {
  const r = eventosParaDisparar("convertido", ["LeadSubmitted", "QualifiedLead", "InitiateCheckout", "Purchase"]);
  assert.deepEqual(r, []);
});

test("eventosParaDisparar: null/undefined em eventosJaEnviados equivale a lista vazia", () => {
  assert.deepEqual(eventosParaDisparar("novo", null), [{ estagio: "novo", evento: "LeadSubmitted" }]);
  assert.deepEqual(eventosParaDisparar("novo", undefined), [{ estagio: "novo", evento: "LeadSubmitted" }]);
});

test("jaFoiEnviado: true só quando há registro do mesmo nome_evento com status_resposta 'ok'", () => {
  assert.equal(jaFoiEnviado([{ nome_evento: "LeadSubmitted", status_resposta: "ok" }], "LeadSubmitted"), true);
});

test("jaFoiEnviado: tentativa com erro não conta como já enviado", () => {
  assert.equal(jaFoiEnviado([{ nome_evento: "LeadSubmitted", status_resposta: "erro:500:x" }], "LeadSubmitted"), false);
});

test("jaFoiEnviado: registro pendente (status_resposta null) não conta como já enviado", () => {
  assert.equal(jaFoiEnviado([{ nome_evento: "LeadSubmitted", status_resposta: null }], "LeadSubmitted"), false);
});

test("jaFoiEnviado: nome de evento diferente não conta", () => {
  assert.equal(jaFoiEnviado([{ nome_evento: "QualifiedLead", status_resposta: "ok" }], "LeadSubmitted"), false);
});

test("jaFoiEnviado: lista vazia/null/undefined -> false", () => {
  assert.equal(jaFoiEnviado([], "LeadSubmitted"), false);
  assert.equal(jaFoiEnviado(null, "LeadSubmitted"), false);
  assert.equal(jaFoiEnviado(undefined, "LeadSubmitted"), false);
});
