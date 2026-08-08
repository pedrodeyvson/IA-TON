// Golden set: roda contra a OpenAI REAL. Custa dinheiro e não é determinístico,
// então fica fora da suíte padrão.
//
//   AGENTE_GOLDEN=1 bun --env-file=.env run node --test \
//     --experimental-strip-types src/lib/agente/golden.test.ts
//
// Rode a cada mudança de prompt, de conhecimento ou de modelo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CASOS_GOLDEN } from "./casos-golden.ts";
import { montarMensagens, montarSystemPrompt } from "./prompt.ts";
import { DEFINICOES_TOOLS } from "./tools.ts";
import { chamarOpenAI } from "./openai.server.ts";

const LIGADO = process.env.AGENTE_GOLDEN === "1";

for (const caso of CASOS_GOLDEN) {
  test(`golden: ${caso.nome}`, { skip: LIGADO ? false : "defina AGENTE_GOLDEN=1" }, async () => {
    const systemPrompt = montarSystemPrompt({
      lead: { nome: null, estagio: caso.estagio ?? "qualificando", maquina_interesse: null },
      modo: caso.modo ?? "venda",
    });
    const mensagens = montarMensagens(
      systemPrompt,
      caso.fala.map((texto) => ({ remetente: "lead", tipo: "texto", conteudo: texto })),
    );

    const resposta = await chamarOpenAI(mensagens as any, DEFINICOES_TOOLS);
    const nomes = resposta.toolCalls.map((t) => t.nome);
    const contexto =
      `\n--- resposta ---\n${resposta.texto}\n--- tools ---\n` +
      resposta.toolCalls.map((t) => `${t.nome} ${JSON.stringify(t.argumentos)}`).join("\n");

    if (caso.toolEsperada) {
      assert.ok(nomes.includes(caso.toolEsperada), `esperava a tool ${caso.toolEsperada}${contexto}`);
    }

    if (caso.argumentoEsperado) {
      const chamada = resposta.toolCalls.find((t) => t.nome === caso.toolEsperada);
      const valor = String(chamada?.argumentos?.[caso.argumentoEsperado.chave] ?? "");
      assert.match(valor, caso.argumentoEsperado.padrao, `argumento errado${contexto}`);
    }

    if (caso.toolProibida) {
      assert.equal(
        nomes.includes(caso.toolProibida),
        false,
        `não podia chamar ${caso.toolProibida}${contexto}`,
      );
    }

    for (const padrao of caso.exigido ?? []) {
      assert.match(resposta.texto ?? "", padrao, `faltou ${padrao} na resposta${contexto}`);
    }

    for (const padrao of caso.proibido ?? []) {
      assert.doesNotMatch(resposta.texto ?? "", padrao, `resposta contém o proibido ${padrao}${contexto}`);
    }
  });
}
