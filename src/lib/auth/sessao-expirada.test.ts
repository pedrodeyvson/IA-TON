import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ehNaoAutenticado,
  guardarRascunho,
  lerRascunho,
  limparRascunho,
  type ArmazenamentoRascunho,
} from "./sessao-expirada.ts";

/** sessionStorage de mentira, com o mínimo que o módulo usa. É o que permite
 *  exercitar o caminho COM armazenamento sob `node --test`, que não tem DOM. */
function armazenamentoFalso(): ArmazenamentoRascunho & { dados: Map<string, string> } {
  const dados = new Map<string, string>();
  return {
    dados,
    getItem: (chave) => dados.get(chave) ?? null,
    setItem: (chave, valor) => {
      dados.set(chave, valor);
    },
    removeItem: (chave) => {
      dados.delete(chave);
    },
  };
}

test("reconhece o 401 do middleware", () => {
  // Caminho REAL, conferido no navegador com o cookie de sessão apagado: o
  // middleware lança `new Response("nao_autenticado", { status: 401 })`, o
  // handler do TanStack devolve essa Response com `x-tss-raw: true`, e o
  // fetcher do cliente a REPASSA CRUA — resolvendo a promise em vez de lançar.
  // Ou seja: isto chega como valor de sucesso da mutation, não como erro.
  assert.equal(ehNaoAutenticado(new Response("nao_autenticado", { status: 401 })), true);
  // Capturado antes de virar Response, chega como objeto com status.
  assert.equal(ehNaoAutenticado({ status: 401 }), true);
  // E se algum dia o `x-tss-raw` sumir, o fetcher faz
  // `new Error(await response.text())` — o corpo vira a mensagem.
  assert.equal(ehNaoAutenticado(new Error("nao_autenticado")), true);
});

test("não confunde outros erros com sessão expirada", () => {
  // Se isto der `true`, uma falha de rede manda o operador para o login e ele
  // perde o contexto da conversa. O custo do falso positivo é alto.
  assert.equal(ehNaoAutenticado(new Response("erro", { status: 500 })), false);
  assert.equal(ehNaoAutenticado(new Response("proibido", { status: 403 })), false);
  assert.equal(ehNaoAutenticado({ status: 500 }), false);
  assert.equal(ehNaoAutenticado({ status: 403 }), false);
  assert.equal(ehNaoAutenticado(new Error("uazapi fora do ar")), false);
  // Falha de rede do fetch é exatamente isto no browser.
  assert.equal(ehNaoAutenticado(new TypeError("Failed to fetch")), false);
  assert.equal(ehNaoAutenticado(new Response("ok", { status: 200 })), false);
  assert.equal(ehNaoAutenticado(null), false);
  assert.equal(ehNaoAutenticado(undefined), false);
  assert.equal(ehNaoAutenticado(""), false);
  assert.equal(ehNaoAutenticado({}), false);
  assert.equal(ehNaoAutenticado(401), false);
  assert.equal(ehNaoAutenticado("nao_autenticado"), false);
  // Como o 401 chega pelo caminho de sucesso, `ehNaoAutenticado` também roda
  // sobre o retorno normal de `responderNoInbox`. Uma falha de envio comum
  // NÃO pode ser confundida com sessão expirada.
  assert.equal(ehNaoAutenticado({ ok: true }), false);
  assert.equal(ehNaoAutenticado({ ok: false, erro: "uazapi recusou o envio" }), false);
});

test("sem sessionStorage (SSR), rascunho não quebra nem inventa texto", () => {
  // Rodando no node, globalThis.sessionStorage não existe.
  assert.equal("sessionStorage" in globalThis, false);
  guardarRascunho("conv-1", "oi");
  assert.equal(lerRascunho("conv-1"), "");
  limparRascunho("conv-1");
});

test("com armazenamento, o rascunho realmente vai e volta", () => {
  // Sem este teste, o anterior passaria mesmo se tudo virasse no-op silencioso.
  const armazenamento = armazenamentoFalso();
  guardarRascunho("conv-1", "texto que o operador digitou", armazenamento);
  assert.equal(armazenamento.dados.size, 1);
  assert.equal(lerRascunho("conv-1", armazenamento), "texto que o operador digitou");
  limparRascunho("conv-1", armazenamento);
  assert.equal(lerRascunho("conv-1", armazenamento), "");
  assert.equal(armazenamento.dados.size, 0);
});

test("o rascunho é por conversa e não vaza de uma para outra", () => {
  const armazenamento = armazenamentoFalso();
  guardarRascunho("conv-1", "resposta da Ana", armazenamento);
  guardarRascunho("conv-2", "resposta do Bruno", armazenamento);
  assert.equal(lerRascunho("conv-1", armazenamento), "resposta da Ana");
  assert.equal(lerRascunho("conv-2", armazenamento), "resposta do Bruno");
  assert.equal(lerRascunho("conv-3", armazenamento), "");
  // Limpar uma não pode apagar a outra.
  limparRascunho("conv-1", armazenamento);
  assert.equal(lerRascunho("conv-1", armazenamento), "");
  assert.equal(lerRascunho("conv-2", armazenamento), "resposta do Bruno");
});

test("texto vazio ou só espaço apaga a chave em vez de guardar lixo", () => {
  // Senão um rascunho vazio fica para trás e a caixa "restaura" nada para sempre.
  const armazenamento = armazenamentoFalso();
  guardarRascunho("conv-1", "algo", armazenamento);
  guardarRascunho("conv-1", "   ", armazenamento);
  assert.equal(armazenamento.dados.size, 0);
  assert.equal(lerRascunho("conv-1", armazenamento), "");
});

test("armazenamento que lança (cota cheia, modo privado) não derruba a caixa", () => {
  const explosivo: ArmazenamentoRascunho = {
    getItem: () => {
      throw new Error("SecurityError");
    },
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
    removeItem: () => {
      throw new Error("SecurityError");
    },
  };
  guardarRascunho("conv-1", "oi", explosivo);
  assert.equal(lerRascunho("conv-1", explosivo), "");
  limparRascunho("conv-1", explosivo);
});

test("sem injeção, usa o sessionStorage global — o caminho do browser", () => {
  // Prova que a resolução padrão não está morta: é ela que roda em produção.
  const armazenamento = armazenamentoFalso();
  (globalThis as { sessionStorage?: ArmazenamentoRascunho }).sessionStorage = armazenamento;
  try {
    guardarRascunho("conv-9", "escrito no browser");
    assert.equal(lerRascunho("conv-9"), "escrito no browser");
    assert.equal(armazenamento.dados.size, 1);
    limparRascunho("conv-9");
    assert.equal(lerRascunho("conv-9"), "");
  } finally {
    delete (globalThis as { sessionStorage?: ArmazenamentoRascunho }).sessionStorage;
  }
});
