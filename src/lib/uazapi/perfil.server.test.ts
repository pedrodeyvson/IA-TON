import { test } from "node:test";
import assert from "node:assert/strict";
import { criarAdminFake } from "../crm/admin-fake.ts";
import { sincronizarPerfil } from "./perfil.server.ts";

const TELEFONE = "5511987654321";

function adminComLead(overrides: Record<string, any> = {}) {
  return criarAdminFake({
    "leads.select": {
      data: { id: "L1", nome: null, foto_path: null, ...overrides },
      error: null,
    },
  });
}

test("sincronizarPerfil sem telefone não faz nada", async () => {
  const admin = adminComLead();
  const r = await sincronizarPerfil(admin, "L1", null);
  assert.deepEqual(r, { atualizouNome: false, atualizouFoto: false });
  assert.equal(admin.chamadas.some((c) => c.operacao === "update"), false);
});

test("sincronizarPerfil: nome e foto já preenchidos e não-placeholder não chama a UAZAPI", async () => {
  const admin = adminComLead({ nome: "Ana Paula", foto_path: "L1.jpg" });
  let chamouBusca = false;
  const r = await sincronizarPerfil(admin, "L1", TELEFONE, {
    buscarPerfil: async () => { chamouBusca = true; return null; },
  });
  assert.equal(chamouBusca, false, "nada a atualizar não deveria custar uma chamada externa");
  assert.deepEqual(r, { atualizouNome: false, atualizouFoto: false });
});

test("sincronizarPerfil atualiza nome placeholder e grava foto nova", async () => {
  const admin = adminComLead({ nome: null, foto_path: null });
  const r = await sincronizarPerfil(admin, "L1", TELEFONE, {
    buscarPerfil: async () => ({ wa_contactName: "Pedrinho", image: "https://pps.whatsapp.net/foo.jpg" }),
    baixarImagem: async () => ({ bytes: new Uint8Array([1, 2, 3]), mime: "image/jpeg" }),
    enviarImagem: async () => ({ ok: true }),
  });
  assert.deepEqual(r, { atualizouNome: true, atualizouFoto: true });

  const updates = admin.chamadas.filter((c) => c.tabela === "leads" && c.operacao === "update");
  const nomeGravado = updates.find((u) => u.payload.nome !== undefined);
  assert.equal(nomeGravado?.payload.nome, "Pedrinho");
  const fotoGravada = updates.find((u) => u.payload.foto_path !== undefined);
  assert.equal(fotoGravada?.payload.foto_path, "L1.jpg");
});

test("sincronizarPerfil não sobrescreve nome editado manualmente", async () => {
  const admin = adminComLead({ nome: "Ana Paula (cliente confirmado)", foto_path: null });
  const r = await sincronizarPerfil(admin, "L1", TELEFONE, {
    buscarPerfil: async () => ({ name: "outro nome qualquer" }),
  });
  assert.equal(r.atualizouNome, false);
  const updates = admin.chamadas.filter((c) => c.tabela === "leads" && c.operacao === "update");
  assert.equal(updates.some((u) => u.payload.nome !== undefined), false);
});

test("sincronizarPerfil sem foto no perfil não tenta baixar nada", async () => {
  const admin = adminComLead({ nome: null, foto_path: null });
  let chamouBaixar = false;
  const r = await sincronizarPerfil(admin, "L1", TELEFONE, {
    buscarPerfil: async () => ({ name: "Pedro" }),
    baixarImagem: async () => { chamouBaixar = true; return null; },
  });
  assert.equal(r.atualizouFoto, false);
  assert.equal(chamouBaixar, false);
});

test("sincronizarPerfil nunca lança — falha da UAZAPI vira resultado sem update", async () => {
  const admin = adminComLead({ nome: null, foto_path: null });
  const r = await sincronizarPerfil(admin, "L1", TELEFONE, {
    buscarPerfil: async () => { throw new Error("UAZAPI 500"); },
  });
  assert.deepEqual(r, { atualizouNome: false, atualizouFoto: false });
});

test("sincronizarPerfil: falha ao baixar a imagem não impede o nome de ser gravado", async () => {
  const admin = adminComLead({ nome: null, foto_path: null });
  const r = await sincronizarPerfil(admin, "L1", TELEFONE, {
    buscarPerfil: async () => ({ name: "Pedro", image: "https://pps.whatsapp.net/foo.jpg" }),
    baixarImagem: async () => null,
  });
  assert.equal(r.atualizouNome, true);
  assert.equal(r.atualizouFoto, false);
});
