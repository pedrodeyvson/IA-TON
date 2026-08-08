import { test } from "node:test";
import assert from "node:assert/strict";
import { ingerirEvento } from "./ingest.server.ts";

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
