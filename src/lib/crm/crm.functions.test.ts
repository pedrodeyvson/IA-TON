import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

// As server functions dependem do runtime do TanStack e não são importáveis
// aqui. O que importa verificar é estrutural, e o código-fonte basta.

const DIR_SRC = fileURLToPath(new URL("../../", import.meta.url));
const SEM_SESSAO_PERMITIDAS = ["entrar", "sair", "obterSessaoAtual"];

/** Todo *.functions.ts sob src/ — arquivo novo nasce coberto. */
function acharFunctions(dir: string): string[] {
  const achados: string[] = [];
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const caminho = join(dir, entrada.name);
    if (entrada.isDirectory()) achados.push(...acharFunctions(caminho));
    else if (entrada.name.endsWith(".functions.ts")) achados.push(caminho);
  }
  return achados;
}

/** O `[^:]` antes de `//` evita mutilar "https://..." dentro de string. */
function semComentarios(fonte: string): string {
  return fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const ARQUIVOS = acharFunctions(DIR_SRC).map((caminho) => ({
  nome: caminho.split(/[\\/]/).pop()!,
  fonte: semComentarios(readFileSync(caminho, "utf8")),
}));

/** Aceita anotação de tipo e genérico: `export const X: T = createServerFn<U>(`. */
function nomesDeServerFn(fonte: string): string[] {
  const re = /export\s+const\s+(\w+)\s*(?::[^=]+)?=\s*createServerFn\s*(?:<[^>]*>)?\s*\(/g;
  const nomes: string[] = [];
  let achado: RegExpExecArray | null;
  while ((achado = re.exec(fonte))) nomes.push(achado[1]);
  return nomes;
}

function corpoDaDeclaracao(fonte: string, nome: string): string {
  const inicio = fonte.search(new RegExp(`export\\s+const\\s+${nome}\\b`));
  assert.notEqual(inicio, -1, `não achei a declaração de ${nome}`);
  const resto = fonte.slice(inicio + 1);
  const proximo = resto.search(/export\s+const\s+\w+/);
  return proximo === -1 ? fonte.slice(inicio) : fonte.slice(inicio, inicio + 1 + proximo);
}

test("a varredura acha os arquivos de server functions", () => {
  // Se a descoberta quebrar, os testes abaixo passariam vazios.
  assert.ok(ARQUIVOS.length >= 2, "esperava ao menos auth.functions.ts e crm.functions.ts");
  assert.ok(ARQUIVOS.some((a) => a.nome === "auth.functions.ts"));
  assert.ok(ARQUIVOS.some((a) => a.nome === "crm.functions.ts"));
});

test("nenhuma declaração de createServerFn escapa do reconhecimento", () => {
  for (const { nome, fonte } of ARQUIVOS) {
    const brutas = (fonte.match(/createServerFn\s*(?:<[^>]*>)?\s*\(/g) ?? []).length;
    assert.equal(
      nomesDeServerFn(fonte).length,
      brutas,
      `${nome}: o arquivo tem ${brutas} createServerFn, mas o regex nomeou outra ` +
        "quantidade — há declaração num formato que este teste não verifica",
    );
  }
});

test("TODA server function exige sessão, exceto as três de auth", () => {
  // O client é de service role e ignora o RLS: uma função sem exigirSessao é
  // um endpoint público no banco.
  const semSessao: string[] = [];
  for (const { fonte } of ARQUIVOS) {
    for (const nome of nomesDeServerFn(fonte)) {
      const corpo = corpoDaDeclaracao(fonte, nome);
      if (!/\.middleware\(\[[^\]]*\bexigirSessao\b[^\]]*\]\)/.test(corpo)) semSessao.push(nome);
    }
  }
  assert.deepEqual(semSessao.sort(), [...SEM_SESSAO_PERMITIDAS].sort());
});

test("toda server function valida a entrada ou não recebe nenhuma", () => {
  for (const { fonte } of ARQUIVOS) {
    for (const nome of nomesDeServerFn(fonte)) {
      const corpo = corpoDaDeclaracao(fonte, nome);
      // Conta as duas formas de ler a entrada: desestruturando `{ data }` ou
      // pegando o contexto inteiro e acessando `ctx.data`.
      const desestrutura = /handler\(\s*(?:async\s*)?\(\s*\{\s*data\b/.test(corpo);
      const viaContexto = /handler\(\s*(?:async\s*)?\(\s*(\w+)[^)]*\)[^=]*=>[\s\S]*?\b\1\.data\b/.test(corpo);
      if (desestrutura || viaContexto) {
        // `.validator(` e não `.inputValidator(`: este último é alias
        // @deprecated na versão instalada do TanStack Start, e o regex recusá-lo
        // é o que impede a API antiga de voltar sem ninguém notar.
        assert.ok(
          /\.validator\(/.test(corpo),
          `${nome} lê data sem validator — entrada não validada`,
        );
      }
    }
  }
});
