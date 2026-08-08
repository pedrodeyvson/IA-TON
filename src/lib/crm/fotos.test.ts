import { test } from "node:test";
import assert from "node:assert/strict";
import { anexarFotosAssinadas } from "./fotos.ts";

test("anexarFotosAssinadas não toca a lista quando nenhum lead tem foto", async () => {
  const leads = [{ id: "L1", foto_path: null }, { id: "L2" }];
  const r = await anexarFotosAssinadas({}, leads);
  assert.deepEqual(r, leads);
});

test("anexarFotosAssinadas assina em UMA chamada em lote, não uma por lead", async () => {
  const leads = [
    { id: "L1", foto_path: "L1.jpg" },
    { id: "L2", foto_path: "L2.jpg" },
    { id: "L3", foto_path: null },
  ];
  let chamadas = 0;
  const r = await anexarFotosAssinadas({}, leads, {
    assinarEmLote: async (_admin, caminhos) => {
      chamadas++;
      assert.deepEqual(caminhos, ["L1.jpg", "L2.jpg"]);
      return new Map([["L1.jpg", "https://signed/L1"], ["L2.jpg", "https://signed/L2"]]);
    },
  });
  assert.equal(chamadas, 1);
  assert.equal(r[0].foto_url, "https://signed/L1");
  assert.equal(r[1].foto_url, "https://signed/L2");
  assert.equal(r[2].foto_url, undefined);
});

test("anexarFotosAssinadas preserva os outros campos do lead", async () => {
  const leads = [{ id: "L1", foto_path: "L1.jpg", nome: "Ana" }];
  const r = await anexarFotosAssinadas({}, leads, {
    assinarEmLote: async () => new Map([["L1.jpg", "https://signed/L1"]]),
  });
  assert.equal(r[0].nome, "Ana");
  assert.equal(r[0].id, "L1");
});

test("anexarFotosAssinadas: caminho sem URL assinada (falha do storage) não quebra, só fica sem foto_url", async () => {
  const leads = [{ id: "L1", foto_path: "L1.jpg" }];
  const r = await anexarFotosAssinadas({}, leads, {
    assinarEmLote: async () => new Map(),
  });
  assert.equal(r[0].foto_url, null);
});
