import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { anexarFotosAssinadas, resetCacheDeFotosParaTeste } from "./fotos.ts";

// O cache de URLs assinadas é module-level (de propósito — precisa sobreviver
// entre chamadas de anexarFotosAssinadas no processo real). Sem resetar entre
// testes, um path reusado num teste anterior (ex.: "L1.jpg") continuaria
// cacheado e mascararia o comportamento que o teste seguinte quer provar.
beforeEach(() => {
  resetCacheDeFotosParaTeste();
});

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

test("anexarFotosAssinadas: assinarEmLote lançando exceção (rede caiu, client explodiu) não quebra a listagem", async () => {
  const leads = [
    { id: "L1", foto_path: "L1.jpg" },
    { id: "L2", foto_path: null },
  ];
  const r = await anexarFotosAssinadas({}, leads, {
    assinarEmLote: async () => {
      throw new Error("falha de rede simulada");
    },
  });
  assert.equal(r[0].foto_url, null);
  assert.equal(r[1].foto_url, undefined);
});

test("anexarFotosAssinadas: cache dentro do TTL reusa a URL sem re-assinar; fora do TTL, re-assina", async () => {
  const leads = [{ id: "L1", foto_path: "L1.jpg" }];
  let chamadas = 0;
  let agoraSimulado = 1_700_000_000_000;
  const deps = {
    agora: () => agoraSimulado,
    assinarEmLote: async (_admin: any, caminhos: string[]) => {
      chamadas++;
      return new Map(caminhos.map((c) => [c, `https://signed/${c}?assinatura=${agoraSimulado}`]));
    },
  };

  // 1ª chamada: nada em cache ainda, assina de verdade.
  const r1 = await anexarFotosAssinadas({}, leads, deps);
  assert.equal(chamadas, 1);
  const urlPrimeira = r1[0].foto_url;
  assert.ok(urlPrimeira);

  // 2ª chamada, 1 minuto depois — dentro do TTL de 4min (240_000ms): reusa o
  // cache, NÃO chama assinarEmLote de novo, e devolve a MESMA URL (o <img
  // src> não deve mudar, senão o navegador rebaixa a imagem à toa).
  agoraSimulado += 60_000;
  const r2 = await anexarFotosAssinadas({}, leads, deps);
  assert.equal(chamadas, 1, "dentro do TTL não deveria chamar assinarEmLote de novo");
  assert.equal(r2[0].foto_url, urlPrimeira, "mesma URL enquanto o cache for válido");

  // 3ª chamada, depois do TTL vencer: reassina de verdade.
  agoraSimulado += 4 * 60 * 1000 + 1;
  const r3 = await anexarFotosAssinadas({}, leads, deps);
  assert.equal(chamadas, 2, "depois do TTL vencer deveria reassinar");
  assert.notEqual(r3[0].foto_url, urlPrimeira, "URL nova depois de expirar o cache");
});

test("anexarFotosAssinadas: cache é por path — um lead novo com path diferente não reusa a URL de outro", async () => {
  let agoraSimulado = 1_700_000_000_000;
  const chamadasPorLote: string[][] = [];
  const deps = {
    agora: () => agoraSimulado,
    assinarEmLote: async (_admin: any, caminhos: string[]) => {
      chamadasPorLote.push(caminhos);
      return new Map(caminhos.map((c) => [c, `https://signed/${c}`]));
    },
  };

  await anexarFotosAssinadas({}, [{ id: "L1", foto_path: "L1.jpg" }], deps);
  const r2 = await anexarFotosAssinadas({}, [{ id: "L2", foto_path: "L2.jpg" }], deps);

  assert.equal(chamadasPorLote.length, 2, "path novo não estava em cache, precisa assinar");
  assert.equal(r2[0].foto_url, "https://signed/L2.jpg");
});
