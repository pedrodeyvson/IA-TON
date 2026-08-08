import { test } from "node:test";
import assert from "node:assert/strict";
import { detalharErroMeta, enviarEventoCapi, sincronizarEventosCapi } from "./capi.server.ts";

/**
 * Só cobre os dois caminhos testáveis sem rede: (1) config ausente degrada em
 * silêncio sem tocar no banco, e (2) dedup via eventos_capi impede reenvio.
 * O caminho de envio real (fetch para graph.facebook.com) depende de
 * credenciais que não temos neste ambiente — não é testado aqui de propósito
 * (ver capi-report.md).
 */

function criarAdminFake(linhasEventosCapi: any[] = []) {
  const tabelas: Record<string, any[]> = { eventos_capi: linhasEventosCapi };
  let chamouFrom = false;

  function builder(tabela: string) {
    chamouFrom = true;
    const filtros: Array<(row: any) => boolean> = [];
    let op: "select" | "insert" | null = null;
    let payload: any = null;

    const self: any = {
      select() { if (!op) op = "select"; return self; },
      insert(obj: any) { op = "insert"; payload = obj; return self; },
      eq(coluna: string, valor: any) { filtros.push((row) => row[coluna] === valor); return self; },
      then(resolve: any) {
        const rows = tabelas[tabela] ?? (tabelas[tabela] = []);
        if (op === "insert") {
          rows.push({ id: `row-${rows.length + 1}`, ...payload });
          resolve({ data: payload, error: null });
          return;
        }
        resolve({ data: rows.filter((r) => filtros.every((f) => f(r))), error: null });
      },
    };
    return self;
  }

  return { from: builder, _tabelas: tabelas, _chamouFrom: () => chamouFrom };
}

function limparEnvCapi() {
  delete process.env.META_PIXEL_ID;
  delete process.env.META_CAPI_TOKEN;
  delete process.env.META_PAGE_ID;
}

test("enviarEventoCapi: sem META_PIXEL_ID/META_CAPI_TOKEN, degrada em silêncio sem tocar no banco", async () => {
  const antesPixel = process.env.META_PIXEL_ID;
  const antesToken = process.env.META_CAPI_TOKEN;
  limparEnvCapi();
  try {
    const admin = criarAdminFake();
    const r = await enviarEventoCapi(admin, "lead-1", "LeadSubmitted", { ctwaClid: "clid-1" });
    assert.deepEqual(r, { ok: false, skipped: true });
    assert.equal(admin._chamouFrom(), false, "não deveria consultar/gravar no banco sem config");
  } finally {
    if (antesPixel !== undefined) process.env.META_PIXEL_ID = antesPixel;
    if (antesToken !== undefined) process.env.META_CAPI_TOKEN = antesToken;
  }
});

test("enviarEventoCapi: evento já enviado com sucesso não é reenviado (dedup)", async () => {
  const antesPixel = process.env.META_PIXEL_ID;
  const antesToken = process.env.META_CAPI_TOKEN;
  process.env.META_PIXEL_ID = "pixel-teste";
  process.env.META_CAPI_TOKEN = "token-teste";
  process.env.META_PAGE_ID = "pagina-teste";
  try {
    const admin = criarAdminFake([
      { lead_id: "lead-1", nome_evento: "LeadSubmitted", status_resposta: "ok" },
    ]);
    const r = await enviarEventoCapi(admin, "lead-1", "LeadSubmitted", { ctwaClid: "clid-1" });
    assert.deepEqual(r, { ok: true, skipped: true, duplicate: true });
    // Não inserta nova linha — só a que já existia.
    assert.equal(admin._tabelas.eventos_capi.length, 1);
  } finally {
    if (antesPixel === undefined) delete process.env.META_PIXEL_ID; else process.env.META_PIXEL_ID = antesPixel;
    if (antesToken === undefined) delete process.env.META_CAPI_TOKEN; else process.env.META_CAPI_TOKEN = antesToken;
    delete process.env.META_PAGE_ID;
  }
});

/** Substitui global.fetch por um stub síncrono controlado — sem rede
 *  nenhuma, só para exercitar os ramos de sucesso/erro do envio sem depender
 *  de credenciais reais nem de conectividade. */
function stubFetch(resposta: { ok: boolean; status: number; body: any }) {
  const original = globalThis.fetch;
  (globalThis as any).fetch = async () => ({
    ok: resposta.ok,
    status: resposta.status,
    text: async () => JSON.stringify(resposta.body),
  });
  return () => { (globalThis as any).fetch = original; };
}

test("enviarEventoCapi: tentativa anterior com erro não é tratada como duplicado — chega a tentar enviar de novo", async () => {
  const antesPixel = process.env.META_PIXEL_ID;
  const antesToken = process.env.META_CAPI_TOKEN;
  process.env.META_PIXEL_ID = "pixel-teste";
  process.env.META_CAPI_TOKEN = "token-teste";
  process.env.META_PAGE_ID = "pagina-teste";
  const restaurarFetch = stubFetch({ ok: true, status: 200, body: { events_received: 1, fbtrace_id: "trace-1" } });
  try {
    const admin = criarAdminFake([
      { lead_id: "lead-1", nome_evento: "LeadSubmitted", status_resposta: "erro:500:falha" },
    ]);
    const r = await enviarEventoCapi(admin, "lead-1", "LeadSubmitted", { ctwaClid: "clid-1" });
    assert.notEqual(r.duplicate, true);
    assert.equal(r.ok, true);
    // Gravou uma segunda linha (a nova tentativa), não sobrescreveu a antiga.
    assert.equal(admin._tabelas.eventos_capi.length, 2);
  } finally {
    restaurarFetch();
    if (antesPixel === undefined) delete process.env.META_PIXEL_ID; else process.env.META_PIXEL_ID = antesPixel;
    if (antesToken === undefined) delete process.env.META_CAPI_TOKEN; else process.env.META_CAPI_TOKEN = antesToken;
    delete process.env.META_PAGE_ID;
  }
});

test("enviarEventoCapi: envio bem-sucedido grava status_resposta 'ok' em eventos_capi", async () => {
  const antesPixel = process.env.META_PIXEL_ID;
  const antesToken = process.env.META_CAPI_TOKEN;
  process.env.META_PIXEL_ID = "pixel-teste";
  process.env.META_CAPI_TOKEN = "token-teste";
  process.env.META_PAGE_ID = "pagina-teste";
  const restaurarFetch = stubFetch({ ok: true, status: 200, body: { events_received: 1, fbtrace_id: "trace-2" } });
  try {
    const admin = criarAdminFake();
    const r = await enviarEventoCapi(admin, "lead-2", "QualifiedLead", { telefone: "5511999999999", nome: "Ana" });
    assert.equal(r.ok, true);
    assert.ok(r.eventId);
    assert.equal(admin._tabelas.eventos_capi.length, 1);
    const linha = admin._tabelas.eventos_capi[0];
    assert.equal(linha.lead_id, "lead-2");
    assert.equal(linha.nome_evento, "QualifiedLead");
    assert.equal(linha.status_resposta, "ok");
    assert.equal(linha.event_id, r.eventId);
  } finally {
    restaurarFetch();
    if (antesPixel === undefined) delete process.env.META_PIXEL_ID; else process.env.META_PIXEL_ID = antesPixel;
    if (antesToken === undefined) delete process.env.META_CAPI_TOKEN; else process.env.META_CAPI_TOKEN = antesToken;
    delete process.env.META_PAGE_ID;
  }
});

test("enviarEventoCapi: Meta recusa o evento -> ok:false e status_resposta começa com 'erro:'", async () => {
  const antesPixel = process.env.META_PIXEL_ID;
  const antesToken = process.env.META_CAPI_TOKEN;
  process.env.META_PIXEL_ID = "pixel-teste";
  process.env.META_CAPI_TOKEN = "token-teste";
  process.env.META_PAGE_ID = "pagina-teste";
  const restaurarFetch = stubFetch({ ok: false, status: 400, body: { error: { message: "Invalid parameter" } } });
  try {
    const admin = criarAdminFake();
    const r = await enviarEventoCapi(admin, "lead-3", "LeadSubmitted", { ctwaClid: "clid-3" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "Invalid parameter");
    const linha = admin._tabelas.eventos_capi[0];
    assert.ok(linha.status_resposta.startsWith("erro:400:"));
  } finally {
    restaurarFetch();
    if (antesPixel === undefined) delete process.env.META_PIXEL_ID; else process.env.META_PIXEL_ID = antesPixel;
    if (antesToken === undefined) delete process.env.META_CAPI_TOKEN; else process.env.META_CAPI_TOKEN = antesToken;
    delete process.env.META_PAGE_ID;
  }
});

test("sincronizarEventosCapi: lead sem atribuição de anúncio não dispara nada", async () => {
  process.env.META_PIXEL_ID = "pixel-teste";
  process.env.META_CAPI_TOKEN = "token-teste";
  process.env.META_PAGE_ID = "pagina-teste";
  try {
    const admin = criarAdminFake();
    await sincronizarEventosCapi(admin, "lead-organico", "convertido", {
      ctwaClid: null, adSourceId: null, telefone: "5511999999999", nome: "Ana",
    });
    assert.equal(admin._chamouFrom(), false, "lead orgânico não deveria nem consultar eventos_capi");
  } finally {
    delete process.env.META_PIXEL_ID;
    delete process.env.META_CAPI_TOKEN;
    delete process.env.META_PAGE_ID;
  }
});

test("sincronizarEventosCapi: dispara em ordem os eventos que faltam para o estágio", async () => {
  process.env.META_PIXEL_ID = "pixel-teste";
  process.env.META_CAPI_TOKEN = "token-teste";
  process.env.META_PAGE_ID = "pagina-teste";
  const restaurarFetch = stubFetch({ ok: true, status: 200, body: { events_received: 1 } });
  try {
    const admin = criarAdminFake([
      { lead_id: "lead-1", nome_evento: "LeadSubmitted", status_resposta: "ok" },
    ]);
    await sincronizarEventosCapi(admin, "lead-1", "link_enviado", {
      ctwaClid: "clid-1", adSourceId: null, telefone: "5511999999999", nome: "Ana",
    });
    const enviados = admin._tabelas.eventos_capi
      .filter((r: any) => r.status_resposta === "ok")
      .map((r: any) => r.nome_evento);
    // LeadSubmitted já estava ok (não reenviado); dispara AddToCart e InitiateCheckout.
    assert.deepEqual(enviados.filter((e: string) => e !== "LeadSubmitted"), ["AddToCart", "InitiateCheckout"]);
  } finally {
    restaurarFetch();
    delete process.env.META_PIXEL_ID;
    delete process.env.META_CAPI_TOKEN;
    delete process.env.META_PAGE_ID;
  }
});

test("sincronizarEventosCapi: para na cascata quando um evento falha, não pula pro próximo", async () => {
  process.env.META_PIXEL_ID = "pixel-teste";
  process.env.META_CAPI_TOKEN = "token-teste";
  process.env.META_PAGE_ID = "pagina-teste";
  const restaurarFetch = stubFetch({ ok: false, status: 400, body: { error: { message: "Invalid parameter" } } });
  try {
    const admin = criarAdminFake();
    await sincronizarEventosCapi(admin, "lead-1", "convertido", {
      ctwaClid: "clid-1", adSourceId: null, telefone: null, nome: null,
    });
    const nomes = admin._tabelas.eventos_capi.map((r: any) => r.nome_evento);
    // Só tentou o primeiro (LeadSubmitted) e parou — não tentou AddToCart/InitiateCheckout/Purchase.
    assert.deepEqual(nomes, ["LeadSubmitted"]);
  } finally {
    restaurarFetch();
    delete process.env.META_PIXEL_ID;
    delete process.env.META_CAPI_TOKEN;
    delete process.env.META_PAGE_ID;
  }
});

test("sincronizarEventosCapi: Purchase leva a comissão estimada como value em BRL", async () => {
  process.env.META_PIXEL_ID = "pixel-teste";
  process.env.META_CAPI_TOKEN = "token-teste";
  process.env.META_PAGE_ID = "pagina-teste";
  let payloadCapturado: any = null;
  const original = globalThis.fetch;
  (globalThis as any).fetch = async (_url: string, opts: any) => {
    payloadCapturado = JSON.parse(opts.body);
    return { ok: true, status: 200, text: async () => JSON.stringify({ events_received: 1 }) };
  };
  try {
    const admin = criarAdminFake([
      { lead_id: "lead-1", nome_evento: "LeadSubmitted", status_resposta: "ok" },
      { lead_id: "lead-1", nome_evento: "AddToCart", status_resposta: "ok" },
      { lead_id: "lead-1", nome_evento: "InitiateCheckout", status_resposta: "ok" },
    ]);
    await sincronizarEventosCapi(admin, "lead-1", "convertido", {
      ctwaClid: "clid-1", adSourceId: "AD1", telefone: null, nome: null, comissaoEstimada: 590,
    });
    assert.equal(payloadCapturado.data[0].event_name, "Purchase");
    assert.equal(payloadCapturado.data[0].custom_data.value, 590);
    assert.equal(payloadCapturado.data[0].custom_data.currency, "BRL");
  } finally {
    (globalThis as any).fetch = original;
    delete process.env.META_PIXEL_ID;
    delete process.env.META_CAPI_TOKEN;
    delete process.env.META_PAGE_ID;
  }
});

test("sincronizarEventosCapi: Purchase sem comissão gravada usa COMISSAO_PADRAO_BRL", async () => {
  process.env.META_PIXEL_ID = "pixel-teste";
  process.env.META_CAPI_TOKEN = "token-teste";
  process.env.META_PAGE_ID = "pagina-teste";
  process.env.COMISSAO_PADRAO_BRL = "500";
  let payloadCapturado: any = null;
  const original = globalThis.fetch;
  (globalThis as any).fetch = async (_url: string, opts: any) => {
    payloadCapturado = JSON.parse(opts.body);
    return { ok: true, status: 200, text: async () => JSON.stringify({ events_received: 1 }) };
  };
  try {
    const admin = criarAdminFake([
      { lead_id: "lead-1", nome_evento: "LeadSubmitted", status_resposta: "ok" },
      { lead_id: "lead-1", nome_evento: "AddToCart", status_resposta: "ok" },
      { lead_id: "lead-1", nome_evento: "InitiateCheckout", status_resposta: "ok" },
    ]);
    await sincronizarEventosCapi(admin, "lead-1", "convertido", {
      ctwaClid: "clid-1", adSourceId: null, telefone: null, nome: null, comissaoEstimada: null,
    });
    assert.equal(payloadCapturado.data[0].custom_data.value, 500);
  } finally {
    (globalThis as any).fetch = original;
    delete process.env.META_PIXEL_ID;
    delete process.env.META_CAPI_TOKEN;
    delete process.env.META_PAGE_ID;
    delete process.env.COMISSAO_PADRAO_BRL;
  }
});

test("sincronizarEventosCapi: nunca lança, mesmo se a consulta a eventos_capi falhar", async () => {
  process.env.META_PIXEL_ID = "pixel-teste";
  process.env.META_CAPI_TOKEN = "token-teste";
  process.env.META_PAGE_ID = "pagina-teste";
  try {
    const adminQuebrado = { from() { throw new Error("conexão caiu"); } };
    await assert.doesNotReject(() =>
      sincronizarEventosCapi(adminQuebrado, "lead-1", "convertido", { ctwaClid: "clid-1" }),
    );
  } finally {
    delete process.env.META_PIXEL_ID;
    delete process.env.META_CAPI_TOKEN;
    delete process.env.META_PAGE_ID;
  }
});

// --- page_id: o parâmetro cuja ausência derrubou 100% dos eventos em
// 08/08/2026 (400, code 100, subcode 2804116). A Meta exige page_id ou
// whatsapp_business_account_id em action_source=business_messaging.

test("enviarEventoCapi: pixel+token sem META_PAGE_ID pula em vez de enviar um evento que a Meta recusa", async () => {
  process.env.META_PIXEL_ID = "pixel-teste";
  process.env.META_CAPI_TOKEN = "token-teste";
  delete process.env.META_PAGE_ID;
  const originalFetch = globalThis.fetch;
  let chamouFetch = false;
  (globalThis as any).fetch = async () => { chamouFetch = true; return new Response("{}", { status: 200 }); };
  try {
    const admin = criarAdminFake();
    const r = await enviarEventoCapi(admin, "lead-1", "LeadSubmitted", { ctwaClid: "clid-1" });
    assert.equal(r.ok, false);
    assert.equal(r.skipped, true);
    assert.equal(chamouFetch, false, "não pode gastar chamada num payload que a Meta rejeita por contrato");
    assert.equal(admin._chamouFrom(), false, "não pode encher eventos_capi de erro previsível");
  } finally {
    (globalThis as any).fetch = originalFetch;
    limparEnvCapi();
  }
});

test("enviarEventoCapi: page_id vai em user_data, em texto puro, junto do ctwa_clid", async () => {
  process.env.META_PIXEL_ID = "pixel-teste";
  process.env.META_CAPI_TOKEN = "token-teste";
  process.env.META_PAGE_ID = "374875799033778";
  const originalFetch = globalThis.fetch;
  let corpo: any = null;
  (globalThis as any).fetch = async (_url: string, init: any) => {
    corpo = JSON.parse(init.body);
    return new Response(JSON.stringify({ events_received: 1 }), { status: 200 });
  };
  try {
    const admin = criarAdminFake();
    const r = await enviarEventoCapi(admin, "lead-1", "LeadSubmitted", { ctwaClid: "clid-1" });
    assert.equal(r.ok, true);
    const ud = corpo.data[0].user_data;
    assert.equal(ud.page_id, "374875799033778", "page_id ausente = 100% dos eventos recusados");
    assert.equal(ud.ctwa_clid, "clid-1");
    assert.equal(corpo.data[0].action_source, "business_messaging");
  } finally {
    (globalThis as any).fetch = originalFetch;
    limparEnvCapi();
  }
});

test("detalharErroMeta: guarda o subcode e o error_user_msg, não só a mensagem genérica", () => {
  const resposta = {
    error: {
      message: "Invalid parameter",
      code: 100,
      error_subcode: 2804116,
      error_user_title: "Falta a identificação da Página",
      error_user_msg: "Seu evento LeadSubmitted ... não tem um parâmetro page_id ou whatsapp_business_account_id.",
    },
  };
  const detalhe = detalharErroMeta(resposta, "corpo cru");
  // "Invalid parameter" sozinho é o que escondeu a causa raiz por um dia.
  assert.ok(detalhe.includes("2804116"), "sem o subcode a linha de erro não diagnostica nada");
  assert.ok(detalhe.includes("page_id"), "sem o error_user_msg não dá para saber qual parâmetro falhou");
  assert.ok(detalhe.slice(0, 200).includes("2804116"), "o detalhe precisa sobreviver ao truncamento de 200 chars");
});

test("detalharErroMeta: resposta sem bloco de erro cai para o corpo cru", () => {
  assert.equal(detalharErroMeta(null, "<html>502</html>"), "<html>502</html>");
  assert.equal(detalharErroMeta({ algo: 1 }, "corpo"), "corpo");
});

test("sincronizarEventosCapi: adSourceId sem ctwaClid não dispara — a Meta recusa por contrato (2804071)", async () => {
  process.env.META_PIXEL_ID = "pixel-teste";
  process.env.META_CAPI_TOKEN = "token-teste";
  process.env.META_PAGE_ID = "pagina-teste";
  const originalFetch = globalThis.fetch;
  let chamouFetch = false;
  (globalThis as any).fetch = async () => { chamouFetch = true; return new Response("{}", { status: 200 }); };
  try {
    const admin = criarAdminFake();
    await sincronizarEventosCapi(admin, "lead-1", "convertido", {
      ctwaClid: null, adSourceId: "120999888777666", telefone: "5511999999999", nome: "Ana",
    });
    assert.equal(chamouFetch, false, "sem ctwa_clid o evento volta 400 sempre — não pode nem tentar");
    assert.equal(admin._chamouFrom(), false);
  } finally {
    (globalThis as any).fetch = originalFetch;
    limparEnvCapi();
  }
});
