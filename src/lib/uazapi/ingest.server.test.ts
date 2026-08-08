import { test } from "node:test";
import assert from "node:assert/strict";
import { ingerirEvento, devePerfilSincronizar } from "./ingest.server.ts";
import { normalizarTelefoneBr } from "../telefone.ts";

/**
 * Fake mínimo do client supabase-js: cada chamada de método acumula estado
 * síncrono na cadeia (from/select/insert/update/eq/is/limit/single/maybeSingle)
 * e resolve via `.then()` — o mesmo protocolo "thenable" que o supabase-js usa,
 * então `await admin.from(...)....` funciona sem precisar simular uma Promise
 * de verdade.
 */
function criarAdminFake() {
  const tabelas: Record<string, any[]> = { leads: [], conversas: [], mensagens: [] };
  let leadSeq = 0;
  let convSeq = 0;
  let msgSeq = 0;

  function builder(tabela: string) {
    const filtros: Array<(row: any) => boolean> = [];
    let op: "select" | "insert" | "update" | null = null;
    let payload: any = null;
    let modo: "single" | "maybeSingle" | "list" | null = null;

    const self: any = {
      select() {
        if (!op) op = "select";
        return self;
      },
      insert(obj: any) {
        op = "insert";
        payload = obj;
        return self;
      },
      update(obj: any) {
        op = "update";
        payload = obj;
        return self;
      },
      eq(coluna: string, valor: any) {
        filtros.push((row) => row[coluna] === valor);
        return self;
      },
      is(coluna: string, valor: any) {
        filtros.push((row) => row[coluna] === valor);
        return self;
      },
      limit() {
        modo = "list";
        return self;
      },
      maybeSingle() {
        modo = "maybeSingle";
        return self;
      },
      single() {
        modo = "single";
        return self;
      },
      then(resolve: any) {
        const rows = tabelas[tabela];
        if (op === "insert") {
          const id =
            tabela === "leads" ? `lead-${++leadSeq}` : tabela === "conversas" ? `conv-${++convSeq}` : `msg-${++msgSeq}`;
          const row = { id, ...payload };
          if (tabela === "leads") {
            // Espelha o trigger real (`trg_leads_normalizar_telefone`, ver
            // 20260807_fundacao.sql): a coluna é gerada pelo Postgres no
            // insert/update, não pela aplicação — sem isso aqui, a busca por
            // `telefone_normalizado` em `buscarLeadExistente` nunca acha nada
            // e todo mundo vira lead duplicado neste fake.
            row.telefone_normalizado = normalizarTelefoneBr(row.telefone ?? null) || null;
          }
          rows.push(row);
          resolve({ data: modo === "single" ? { id: row.id } : row, error: null });
          return;
        }
        if (op === "update") {
          rows.filter((r) => filtros.every((f) => f(r))).forEach((r) => Object.assign(r, payload));
          resolve({ error: null });
          return;
        }
        const encontrados = rows.filter((r) => filtros.every((f) => f(r)));
        if (modo === "maybeSingle" || modo === "single") {
          resolve({ data: encontrados[0] ?? null, error: null });
        } else {
          resolve({ data: encontrados, error: null });
        }
      },
    };
    return self;
  }

  return {
    from: builder,
    storage: { from: () => ({ upload: async () => ({ error: null }) }) },
    _tabelas: tabelas,
  };
}

test("mensagem só com @lid (sem telefone) cria lead ancorado no jid, não é descartada", async () => {
  const admin = criarAdminFake();

  const payload = {
    EventType: "messages",
    instance: "instancia-teste",
    message: {
      messageid: "MSG-LID-1",
      key: { remoteJid: "264081359843075@lid" },
      content: { conversation: "oi, tenho interesse" },
      messageTimestamp: 1_700_000_000,
      pushName: "Contato Privado",
    },
  };

  const resultados = await ingerirEvento(admin, payload);

  assert.equal(resultados.length, 1);
  assert.equal(resultados[0].status, "ok");
  assert.ok(resultados[0].leadId, "esperava leadId no resultado");

  assert.equal(admin._tabelas.leads.length, 1);
  const lead = admin._tabelas.leads[0];
  assert.equal(lead.external_id, "wa-jid:264081359843075@lid");
  assert.equal(lead.telefone, null);

  assert.equal(admin._tabelas.mensagens.length, 1);
  assert.equal(admin._tabelas.mensagens[0].lead_id, lead.id);
});

test("mensagem de grupo é ignorada mesmo achando telefone do participante no payload", async () => {
  const admin = criarAdminFake();

  const payload = {
    EventType: "messages",
    instance: "instancia-teste",
    message: {
      messageid: "MSG-GRUPO-1",
      key: {
        remoteJid: "120363012345678901@g.us",
        participant: "5511987654321@s.whatsapp.net",
      },
      participant: "5511987654321@s.whatsapp.net",
      content: { conversation: "mensagem dentro de um grupo" },
      messageTimestamp: 1_700_000_100,
      pushName: "Alguém do grupo",
    },
  };

  const resultados = await ingerirEvento(admin, payload);

  assert.equal(resultados.length, 1);
  assert.equal(resultados[0].status, "ignored");
  assert.equal(admin._tabelas.leads.length, 0);
  assert.equal(admin._tabelas.mensagens.length, 0);
});

test("status@broadcast e @newsletter também são ignorados", async () => {
  for (const remoteJid of ["status@broadcast", "120363099999999999@newsletter"]) {
    const admin = criarAdminFake();
    const resultados = await ingerirEvento(admin, {
      EventType: "messages",
      instance: "instancia-teste",
      message: {
        messageid: `MSG-${remoteJid}`,
        key: { remoteJid },
        content: { conversation: "oi" },
        messageTimestamp: 1_700_000_200,
      },
    });
    assert.equal(resultados[0].status, "ignored");
    assert.equal(admin._tabelas.leads.length, 0);
  }
});

test("mensagem de lead novo é processada normalmente com a sincronização de perfil ligada (sem UAZAPI_TOKEN, é no-op)", async () => {
  const tokenOriginal = process.env.UAZAPI_TOKEN;
  delete process.env.UAZAPI_TOKEN;
  try {
    const admin = criarAdminFake();
    const payload = {
      EventType: "messages",
      instance: "instancia-teste",
      message: {
        messageid: "MSG-PERFIL-1",
        key: { remoteJid: "5511987654321@s.whatsapp.net" },
        content: { conversation: "quero saber mais" },
        messageTimestamp: 1_700_000_100,
        pushName: "Cliente Teste",
      },
    };

    const resultados = await ingerirEvento(admin, payload);

    assert.equal(resultados.length, 1);
    assert.equal(resultados[0].status, "ok");
    assert.equal(admin._tabelas.leads.length, 1, "o lead foi criado normalmente");
    assert.equal(admin._tabelas.mensagens.length, 1, "a mensagem foi gravada normalmente");
    // Sem UAZAPI_TOKEN, sincronizarPerfil não tem como ter mudado nada —
    // confirma que ela rodou (não quebrou o fluxo) e não sujou o lead.
    assert.equal(admin._tabelas.leads[0].foto_path, undefined);
  } finally {
    if (tokenOriginal !== undefined) process.env.UAZAPI_TOKEN = tokenOriginal;
  }
});

test("uma segunda mensagem de entrada do mesmo lead continua sendo processada com a sincronização de perfil ligada", async () => {
  const tokenOriginal = process.env.UAZAPI_TOKEN;
  delete process.env.UAZAPI_TOKEN;
  try {
    const admin = criarAdminFake();
    const base = {
      EventType: "messages",
      instance: "instancia-teste",
      message: {
        key: { remoteJid: "5511987654321@s.whatsapp.net" },
        messageTimestamp: 1_700_000_100,
      },
    };
    await ingerirEvento(admin, { ...base, message: { ...base.message, messageid: "MSG-A", content: { conversation: "oi" } } });
    const resultados = await ingerirEvento(admin, { ...base, message: { ...base.message, messageid: "MSG-B", content: { conversation: "tudo bem?" } } });

    assert.equal(resultados[0].status, "ok");
    assert.equal(admin._tabelas.leads.length, 1, "mesma pessoa, não duplica o lead");
    assert.equal(admin._tabelas.mensagens.length, 2);
  } finally {
    if (tokenOriginal !== undefined) process.env.UAZAPI_TOKEN = tokenOriginal;
  }
});

// `devePerfilSincronizar` é o gate puro que decide se vale a pena buscar
// nome/foto do perfil no WhatsApp. Testado direto, sem fake de banco: com
// UAZAPI_TOKEN ausente no ambiente de teste, sincronizarPerfil é no-op, então
// não dá pra distinguir "chamado mas não fez nada" de "nunca chamado" via
// efeito no banco (os dois caminhos deixam o mesmo estado no fake local
// acima). Estas 4 chamadas cobrem leadNovo × direção diretamente.
test("devePerfilSincronizar: lead novo, mensagem de entrada -> true", () => {
  assert.equal(devePerfilSincronizar(true, "in"), true);
});

test("devePerfilSincronizar: lead novo, mensagem de saída -> true", () => {
  assert.equal(devePerfilSincronizar(true, "out"), true);
});

test("devePerfilSincronizar: lead existente, mensagem de entrada -> true", () => {
  assert.equal(devePerfilSincronizar(false, "in"), true);
});

test("devePerfilSincronizar: lead existente, mensagem de saída -> false", () => {
  assert.equal(devePerfilSincronizar(false, "out"), false);
});
